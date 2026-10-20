import { expect, test } from "@playwright/test";
import { callApi, demoStep, loginAs, resetDemo, tokenOf, walletOf } from "./helpers";

const R = 100;

test.beforeEach(async ({ request }) => {
  await resetDemo(request);
  await demoStep(request, 7); // автор подал проект «Тираж настольной игры» на проверку
});

test("краудфандинг: проверка проекта, взносы спонсоров, приемка этапа голосованием, возврат остатка", async ({ browser, request }) => {
  const admin = await tokenOf(request, "admin");
  const review = await callApi<{ id: string; title: string }[]>(request, admin, "GET", "/admin/projects?status=review");
  const project = review.find((p) => p.title.includes("Тираж"))!;

  // администратор одобряет проект в интерфейсе: открывается сбор
  const actx = await browser.newContext();
  const adm = await actx.newPage();
  await loginAs(adm, request, "admin");
  await adm.goto(`/projects/${project.id}`);
  await adm.getByRole("button", { name: "Одобрить и опубликовать" }).click();
  await expect.poll(async () => (await callApi<{ status: string }>(request, admin, "GET", `/projects/${project.id}`)).status).toBe("approved");

  const olgaToken = await tokenOf(request, "olga");
  const deals = await callApi<{ id: string; mode: string }[]>(request, olgaToken, "GET", "/deals");
  const projectView = await callApi<{ dealId?: string }>(request, olgaToken, "GET", `/projects/${project.id}`);
  const dealId = projectView.dealId ?? deals.find((d) => d.mode === "crowdfunding")!.id;
  expect(dealId).toBeTruthy();

  const olgaStart = (await walletOf(request, "olga")).free;
  const maxStart = (await walletOf(request, "max")).free;

  // спонсоры вносят по 150 000 ₽ в интерфейсе
  for (const who of ["olga", "max"]) {
    const reservedBefore = (await walletOf(request, who)).reserved;
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, request, who);
    await page.goto(`/deals/${dealId}`);
    await page.getByPlaceholder("Сумма, ₽").fill("150000");
    await page.getByRole("button", { name: /Поддержать на/ }).click();
    await expect.poll(async () => (await walletOf(request, who)).reserved).toBe(reservedBefore + 150_000 * R);
    await ctx.close();
  }

  // автор подписывает контракт, и работа начинается
  const games = await tokenOf(request, "games");
  await callApi(request, games, "POST", `/deals/${dealId}/sign`, {});
  const gctx = await browser.newContext();
  const author = await gctx.newPage();
  await loginAs(author, request, "games");
  await author.goto(`/deals/${dealId}`);
  await author.getByRole("button", { name: /Сдать этап/ }).first().click();
  await author.getByPlaceholder("Результат работ и примечания").fill("Макет и правила готовы");
  await author.getByRole("button", { name: "Сдать на приемку" }).click();
  await expect(author.getByText("Сдан, ждет приемки")).toBeVisible();
  const gamesBefore = (await walletOf(request, "games")).free;

  // один спонсор из двух (ровно 50%) этап не принимает, второй голос решает
  const olgaCtx = await browser.newContext();
  const olga = await olgaCtx.newPage();
  await loginAs(olga, request, "olga");
  await olga.goto(`/deals/${dealId}`);
  await olga.getByRole("button", { name: "Принять", exact: true }).click();
  await expect(olga.getByText(/ваш голос: за/)).toBeVisible();
  expect((await walletOf(request, "games")).free).toBe(gamesBefore);
  const maxCtx = await browser.newContext();
  const max = await maxCtx.newPage();
  await loginAs(max, request, "max");
  await max.goto(`/deals/${dealId}`);
  await max.getByRole("button", { name: "Принять", exact: true }).click();
  await expect.poll(async () => (await walletOf(request, "games")).free).toBe(gamesBefore + 100_000 * R);

  // второй этап: автор сдает, спонсор отклоняет, остаток возвращается спонсорам
  const detail = await callApi<{ stages: { id: string }[] }>(request, games, "GET", `/deals/${dealId}`);
  await callApi(request, games, "POST", `/deals/${dealId}/stages/${detail.stages[1]!.id}/submit`, { note: "Часть тиража" });
  await olga.reload();
  const olgaReserved = (await walletOf(request, "olga")).reserved;
  await olga.getByRole("button", { name: "Отклонить", exact: true }).click();
  await expect.poll(async () => (await walletOf(request, "olga")).reserved).toBe(olgaReserved - 100_000 * R);
  expect((await walletOf(request, "olga")).free).toBe(olgaStart - 50_000 * R); // 100 000 возвращено из 150 000
  expect((await walletOf(request, "max")).free).toBe(maxStart - 50_000 * R);
  expect((await walletOf(request, "games")).free).toBe(gamesBefore + 100_000 * R); // автор больше ничего не получил

  for (const c of [actx, gctx, olgaCtx, maxCtx]) await c.close();
});

test("проект на проверке не виден в каталоге, пока администратор не одобрит", async ({ page, request }) => {
  await loginAs(page, request, "olga");
  await page.goto("/catalog");
  await expect(page.locator("body")).not.toContainText("Тираж настольной игры");
});
