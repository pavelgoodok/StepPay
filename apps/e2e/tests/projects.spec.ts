import { expect, test } from "@playwright/test";
import { callApi, demoStep, loginAs, resetDemo, tokenOf, walletOf } from "./helpers";

const R = 100;

type Project = { id: string; title: string; status: string; dealId?: string };

/** Грантовый проект автора «games»: заполнен полностью и подан на проверку (то же, что делает автор в мастере). */
async function submitGrant(request: Parameters<typeof tokenOf>[0]): Promise<string> {
  const games = await tokenOf(request, "games");
  await callApi(request, games, "POST", "/me/mode", { kind: "executor" });
  await callApi(request, games, "POST", "/me/author", { legalStatus: "org", inn: "7707083893", orgName: "ООО Мастерская" });
  const p = await callApi<Project>(request, games, "POST", "/projects", { kind: "grant", title: "Мастерская для школы", category: "Образование" });
  await callApi(request, games, "POST", `/projects/${p.id}/update`, {
    summary: "Оборудуем школьную мастерскую станками и инструментом.",
    description: "Школа получит мастерскую для уроков труда: закупим станки, инструмент и средства защиты, проведем монтаж и обучим учителей. Работы разбиты на два этапа, каждый принимает грантодатель.",
    stages: [
      { title: "Закупка оборудования", amount: 80_000 * R, criteria: ["Оборудование доставлено"] },
      { title: "Монтаж и обучение", amount: 40_000 * R, criteria: ["Мастерская запущена"] },
    ],
    docs: [
      { id: "cv", name: "Обложка", url: "/uploads/demo-cover-0003", kind: "photo" },
      { id: "d1", name: "Смета.pdf", url: "/uploads/demo-doc-0001", kind: "doc" },
    ],
  });
  const sent = await callApi<Project & { error?: string }>(request, games, "POST", `/projects/${p.id}/submit`, {});
  expect(sent.error).toBeUndefined();
  return p.id;
}

test.beforeEach(async ({ request }) => resetDemo(request));

test("проект возвращается на доработку, автор правит и отправляет повторно, администратор одобряет", async ({ browser, request }) => {
  await demoStep(request, 7);
  const admin = await tokenOf(request, "admin");
  const games = await tokenOf(request, "games");
  // анкета автора нужна мастеру проекта: без нее шаг «Об авторе» не пропустить
  await callApi(request, games, "POST", "/me/author", { legalStatus: "org", inn: "7707083893", orgName: "ООО Мастерская" });
  const queue = await callApi<Project[]>(request, admin, "GET", "/admin/projects?status=review");
  const project = queue.find((p) => p.title.includes("Тираж"))!;

  // администратор: без комментария вернуть на доработку нельзя
  const actx = await browser.newContext();
  const adm = await actx.newPage();
  await loginAs(adm, request, "admin");
  await adm.goto(`/projects/${project.id}`);
  const changes = adm.getByRole("button", { name: "На доработку" });
  await expect(changes).toBeDisabled();
  await adm.getByPlaceholder(/Комментарий автору/).fill("Уточните сроки второго этапа и приложите договор с типографией");
  await expect(changes).toBeEnabled();
  await changes.click();
  await expect.poll(async () => (await callApi<Project>(request, admin, "GET", `/projects/${project.id}`)).status).toBe("changes");

  // автор видит замечание и кнопку повторной отправки, публично проект не виден
  const gctx = await browser.newContext();
  const author = await gctx.newPage();
  await loginAs(author, request, "games");
  await author.goto(`/projects/${project.id}`);
  await expect(author.locator("body")).toContainText("Уточните сроки второго этапа");
  const edit = author.getByRole("link", { name: /Внести изменения и отправить повторно/ });
  await expect(edit).toBeVisible();
  const octx = await browser.newContext(); // у каждого участника своя сессия: токен хранится в localStorage контекста
  const other = await octx.newPage();
  await loginAs(other, request, "olga");
  await other.goto("/catalog");
  await expect(other.locator("body")).not.toContainText("Тираж настольной игры");
  await octx.close();

  // автор проходит мастер и отправляет проект повторно
  await edit.click();
  await author.waitForURL(/\/edit/);
  for (let i = 0; i < 8; i++) {
    const send = author.getByRole("button", { name: "Отправить на проверку" });
    if (await send.isVisible()) {
      await send.click();
      break;
    }
    const next = author.getByRole("button", { name: "Далее", exact: true });
    if (await next.isVisible()) await next.click();
    else await author.locator("button.card.tap").first().click(); // экран выбора раздела
    await author.waitForTimeout(300);
  }
  await expect.poll(async () => (await callApi<Project>(request, games, "GET", `/projects/${project.id}`)).status).toBe("review");

  // проект снова в очереди, администратор одобряет
  await adm.goto(`/projects/${project.id}`);
  await adm.getByRole("button", { name: "Одобрить и опубликовать" }).click();
  await expect.poll(async () => (await callApi<Project>(request, admin, "GET", `/projects/${project.id}`)).status).toBe("approved");
  const history = await callApi<{ history: { action: string }[] }>(request, admin, "GET", `/projects/${project.id}`);
  expect(history.history.map((h) => h.action)).toEqual(expect.arrayContaining(["submit", "changes", "resubmit", "approve"]));
  await actx.close();
  await gctx.close();
});

test("грант: администратор одобряет, грантодатель финансирует, этап принят, второй отклонен, остаток возвращен", async ({ browser, request }) => {
  const id = await submitGrant(request);
  const admin = await tokenOf(request, "admin");
  const games = await tokenOf(request, "games");
  const olga = await tokenOf(request, "olga");

  const actx = await browser.newContext();
  const adm = await actx.newPage();
  await loginAs(adm, request, "admin");
  await adm.goto(`/projects/${id}`);
  await adm.getByRole("button", { name: "Одобрить и опубликовать" }).click();
  await expect.poll(async () => (await callApi<Project>(request, admin, "GET", `/projects/${id}`)).status).toBe("approved");

  // обычный участник не может профинансировать грант ни в интерфейсе, ни по API
  const octx = await browser.newContext();
  const other = await octx.newPage();
  await loginAs(other, request, "olga");
  await other.goto(`/projects/${id}`);
  await expect(other.getByRole("button", { name: "Профинансировать грант" })).toHaveCount(0);
  expect((await request.post(`http://localhost:4000/projects/${id}/grant`, { data: {}, headers: { authorization: `Bearer ${olga}` } })).status()).toBe(403);

  // грантодатель резервирует всю сумму сразу
  const fondStart = await walletOf(request, "fond");
  const fctx = await browser.newContext();
  const fond = await fctx.newPage();
  await loginAs(fond, request, "fond");
  await fond.goto(`/projects/${id}`);
  fond.once("dialog", (d) => void d.accept()); // подтверждение суммы перед резервом
  await fond.getByRole("button", { name: "Профинансировать грант" }).click();
  await expect.poll(async () => (await walletOf(request, "fond")).reserved).toBe(fondStart.reserved + 120_000 * R);
  const view = await callApi<Project>(request, games, "GET", `/projects/${id}`);
  const dealId = view.dealId!;
  expect(dealId).toBeTruthy();

  // контракт подписывают обе стороны: грантодатель ключом своего устройства в интерфейсе, автор подписью сервера (демо)
  await fond.waitForURL(new RegExp(`/deals/${dealId}`));
  await fond.getByRole("button", { name: "Подписать контракт" }).click();
  await callApi(request, games, "POST", `/deals/${dealId}/sign`, {});
  const gctx = await browser.newContext();
  const author = await gctx.newPage();
  await loginAs(author, request, "games");
  const gamesStart = (await walletOf(request, "games")).free;
  await author.goto(`/deals/${dealId}`);
  await author.getByRole("button", { name: /Сдать этап/ }).first().click();
  await author.getByPlaceholder("Результат работ и примечания").fill("Оборудование поставлено");
  await author.getByRole("button", { name: "Сдать на приемку" }).click();
  await expect(author.getByText("Сдан, ждет приемки")).toBeVisible();
  expect((await walletOf(request, "games")).free).toBe(gamesStart); // до приемки выплаты нет

  await fond.goto(`/deals/${dealId}`);
  await fond.getByRole("button", { name: "Принял" }).click();
  await expect.poll(async () => (await walletOf(request, "games")).free).toBe(gamesStart + 80_000 * R);

  // второй этап: отказ грантодателя закрывает проект, остаток возвращается
  const deal = await callApi<{ stages: { id: string }[] }>(request, games, "GET", `/deals/${dealId}`);
  await callApi(request, games, "POST", `/deals/${dealId}/stages/${deal.stages[1]!.id}/submit`, { note: "Монтаж выполнен" });
  const reservedBefore = (await walletOf(request, "fond")).reserved;
  await fond.reload();
  await fond.getByRole("button", { name: "Отклонить" }).click();
  await fond.locator("textarea").fill("Мастерская не запущена, обучение не проведено");
  await fond.getByRole("button", { name: "Отправить отказ" }).click();
  await expect.poll(async () => (await walletOf(request, "fond")).reserved).toBe(reservedBefore - 40_000 * R);
  expect((await walletOf(request, "games")).free).toBe(gamesStart + 80_000 * R); // автору больше ничего не выплачено
  for (const c of [actx, octx, fctx, gctx]) await c.close();
});
