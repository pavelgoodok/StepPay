import { expect, test } from "@playwright/test";
import { callApi, loginAs, resetDemo, tokenOf } from "./helpers";

type DealItem = { id: string; status: string; title: string };

/** Сделка после шага 3 сценария: условия отправлены, заказчик может зарезервировать средства. */
async function dealId(request: Parameters<typeof tokenOf>[0]): Promise<string> {
  const anna = await tokenOf(request, "anna");
  const list = await callApi<DealItem[]>(request, anna, "GET", "/deals");
  return list.find((d) => d.status === "funding")!.id;
}

test.beforeEach(async ({ request }) => resetDemo(request, 3));

test("оплата по шагам: резерв, сдача этапа, приемка, выплата исполнителю", async ({ browser, request }) => {
  const id = await dealId(request);
  const walletOf = async (user: string) => (await callApi<{ wallet: { free: number; reserved: number } }>(request, await tokenOf(request, user), "GET", "/me")).wallet;
  const before = await walletOf("ivan");

  // заказчик резервирует средства
  const annaCtx = await browser.newContext();
  const anna = await annaCtx.newPage();
  await loginAs(anna, request, "anna");
  await anna.goto(`/deals/${id}`);
  await anna.getByRole("button", { name: /зарезервировать/i }).click();
  await expect(anna.getByText("Сдать этап").first()).toBeHidden(); // заказчику кнопка сдачи не показывается
  await expect.poll(async () => (await walletOf("anna")).reserved).toBeGreaterThan(0);
  expect((await walletOf("ivan")).free).toBe(before.free); // у исполнителя деньги пока не появились

  // исполнитель сдает первый этап
  const ivanCtx = await browser.newContext();
  const ivan = await ivanCtx.newPage();
  await loginAs(ivan, request, "ivan");
  await ivan.goto(`/deals/${id}`);
  await ivan.getByRole("button", { name: /Сдать этап/ }).first().click();
  await ivan.getByPlaceholder("Результат работ и примечания").fill("Плитка уложена, швы ровные");
  await ivan.getByRole("button", { name: "Сдать на приемку" }).click();
  await expect(ivan.getByText("Сдан, ждет приемки")).toBeVisible();
  expect((await walletOf("ivan")).free).toBe(before.free); // до приемки выплаты нет

  // заказчик принимает этап
  await anna.reload();
  await anna.getByRole("button", { name: "Принял" }).click();
  await expect(anna.getByText("Принят, оплачен").first()).toBeVisible();

  // исполнитель получил выплату за этап «Плитка»
  await expect.poll(async () => (await walletOf("ivan")).free).toBe(before.free + 120_000 * 100);
  await ivan.goto("/wallet");
  await expect(ivan.locator("body")).toContainText("120");
  await annaCtx.close();
  await ivanCtx.close();
});

test("отказ по этапу открывает спор, спор виден администратору", async ({ browser, request }) => {
  const id = await dealId(request);
  const anna = await tokenOf(request, "anna");
  const ivan = await tokenOf(request, "ivan");
  await callApi(request, anna, "POST", `/deals/${id}/fund`, {});
  for (const t of [anna, ivan]) await callApi(request, t, "POST", `/deals/${id}/sign`, {}); // повторная подпись безопасна: ошибка игнорируется
  const deal = await callApi<{ stages: { id: string }[] }>(request, anna, "GET", `/deals/${id}`);
  const stage = deal.stages[0]!.id;
  await callApi(request, ivan, "POST", `/deals/${id}/stages/${stage}/submit`, { note: "Готово" });

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, request, "anna");
  await page.goto(`/deals/${id}`);
  await page.getByRole("button", { name: "Отказать" }).click();
  const reason = page.locator("textarea");
  await expect(reason).toBeVisible();
  await reason.fill("Плитка уложена с перекосом");
  await page.getByRole("button", { name: "Отправить отказ" }).click();
  await expect(page.locator(".thread")).toContainText("Плитка уложена с перекосом");

  const adm = await browser.newContext();
  const admin = await adm.newPage();
  await loginAs(admin, request, "admin");
  await admin.goto("/admin/disputes");
  await expect(admin.getByRole("heading", { name: "Споры" })).toBeVisible();
  await expect(admin.locator("table")).toContainText("Плитка");
  await expect(admin.locator("table")).toContainText("Плитка уложена с перекосом");
  await ctx.close();
  await adm.close();
});
