import { expect, test } from "@playwright/test";
import { callApi, loginAs, resetDemo, tokenOf } from "./helpers";

type Chat = { id: string };

/** Чат Анны и Ивана после первых двух сообщений сценария: взаимодействие есть, можно оставить отзыв. */
async function chatOf(request: Parameters<typeof tokenOf>[0]): Promise<string> {
  const anna = await tokenOf(request, "anna");
  const chats = await callApi<{ items?: Chat[] } | Chat[]>(request, anna, "GET", "/chats");
  return (Array.isArray(chats) ? chats : chats.items!)[0]!.id;
}

test.beforeEach(async ({ request }) => resetDemo(request, 1));

test("заказчик оценивает исполнителя, оценка попадает в рейтинг, повторно оценить нельзя", async ({ browser, request }) => {
  const id = await chatOf(request);
  const ctx = await browser.newContext();
  const anna = await ctx.newPage();
  await loginAs(anna, request, "anna");
  await anna.goto(`/chats/${id}`);
  await anna.getByRole("button", { name: /Оценить: Иван/ }).click();

  // низкая оценка требует пояснения
  await anna.getByRole("radiogroup").getByLabel("2").click();
  const send = anna.getByRole("button", { name: "Оставить отзыв" });
  await expect(send).toBeDisabled();
  await anna.locator("textarea").fill("Плохо");
  await expect(send).toBeDisabled(); // меньше 10 символов
  await anna.getByRole("radiogroup").getByLabel("5").click();
  await anna.locator("textarea").fill("Работа выполнена аккуратно и в срок");
  await expect(send).toBeEnabled();
  await send.click();

  await expect(anna.getByText("Ваш отзыв")).toBeVisible();
  await expect(anna.getByRole("button", { name: /Оставить отзыв|Оценить: Иван/ })).toHaveCount(0); // повторной возможности нет

  // страница исполнителя показывает рейтинг и текст отзыва
  const viewer = await ctx.newPage();
  await loginAs(viewer, request, "olga");
  await viewer.goto("/users/ivan");
  await expect(viewer.locator("body")).toContainText("Работа выполнена аккуратно и в срок");
  await expect(viewer.locator("body")).toContainText("5");
  await ctx.close();
});

test("исполнитель не может оценить заказчика, а повторный отзыв отклоняется сервером", async ({ browser, request }) => {
  const id = await chatOf(request);
  const ctx = await browser.newContext();
  const ivan = await ctx.newPage();
  await loginAs(ivan, request, "ivan");
  await ivan.goto(`/chats/${id}`);
  await expect(ivan.getByRole("button", { name: /Оценить:/ })).toHaveCount(0);
  const ivanToken = await tokenOf(request, "ivan");
  const bad = await request.post(`http://localhost:4000/reviews/of/${id}`, { data: { stars: 5, text: "" }, headers: { authorization: `Bearer ${ivanToken}` } });
  expect(bad.status()).toBe(403);

  const annaToken = await tokenOf(request, "anna");
  const ok = await request.post(`http://localhost:4000/reviews/of/${id}`, { data: { stars: 4, text: "" }, headers: { authorization: `Bearer ${annaToken}` } });
  expect(ok.status()).toBe(200);
  const again = await request.post(`http://localhost:4000/reviews/of/${id}`, { data: { stars: 5, text: "" }, headers: { authorization: `Bearer ${annaToken}` } });
  expect(again.status()).toBe(409);
  await ctx.close();
});
