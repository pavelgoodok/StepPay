import { expect, test } from "@playwright/test";
import { loginAs, resetDemo } from "./helpers";

test.beforeEach(async ({ request }) => resetDemo(request));

test("чат: сообщение исполнителю, ответ, правило регистрации задачи и сама задача", async ({ browser, request }) => {
  const actx = await browser.newContext();
  const anna = await actx.newPage();
  await loginAs(anna, request, "anna");
  const ictx = await browser.newContext();
  const ivan = await ictx.newPage();
  await loginAs(ivan, request, "ivan");

  // заказчик пишет исполнителю со страницы услуги
  await anna.goto("/services/svc_ivan");
  await anna.getByPlaceholder("Сообщение исполнителю").fill("Здравствуйте! Нужно переделать кухню, возьметесь?");
  await anna.getByRole("button", { name: "Написать исполнителю" }).click();
  await anna.waitForURL(/\/chats\//);
  const chatUrl = anna.url();

  // у исполнителя в меню счетчик непрочитанных, сообщение видно в чате
  await ivan.goto("/deals");
  await expect(ivan.locator('a[href="/chats"]').filter({ hasText: "1" })).not.toHaveCount(0);
  await ivan.goto(chatUrl);
  await expect(ivan.locator("body")).toContainText("Нужно переделать кухню");

  // регистрация задачи недоступна, пока заказчик не ответит на сообщение исполнителя
  const register = ivan.getByRole("button", { name: "Зарегистрировать задачу" });
  await expect(register).toBeDisabled();
  await ivan.getByPlaceholder("Сообщение").fill("Добрый день, возьмусь. Уточните бюджет.");
  await ivan.getByPlaceholder("Сообщение").press("Enter");
  await expect(ivan.locator("body")).toContainText("Уточните бюджет");
  await expect(register).toBeDisabled();

  await anna.reload();
  await expect(anna.locator("body")).toContainText("Уточните бюджет");
  await anna.getByPlaceholder("Сообщение").fill("Бюджет около 50 тысяч.");
  await anna.getByPlaceholder("Сообщение").press("Enter");
  await expect(anna.locator("body")).toContainText("Бюджет около 50 тысяч");

  // после ответа заказчика задачу можно зарегистрировать, сумма обязательна
  await ivan.reload();
  await expect(register).toBeEnabled();
  await register.click();
  await ivan.getByPlaceholder("Название задачи").fill("Ремонт кухни");
  const submit = ivan.getByRole("button", { name: "Зарегистрировать", exact: true });
  await expect(submit).toBeDisabled(); // без согласованной суммы нельзя
  await ivan.getByPlaceholder("Согласованная сумма, ₽").fill("50000");
  await submit.click();

  await ivan.goto("/deals");
  await expect(ivan.locator("body")).toContainText("Ремонт кухни");
  await expect(ivan.locator("body")).toContainText("Согласование");
  await actx.close();
  await ictx.close();
});

test("чужой чат недоступен", async ({ page, request }) => {
  await resetDemo(request, 1);
  const anna = await (await request.post("http://localhost:4000/auth/demo", { data: { userId: "anna" } })).json();
  const chats = await (await request.get("http://localhost:4000/chats", { headers: { authorization: `Bearer ${anna.token}` } })).json();
  const id = (chats.items ?? chats)[0].id as string;
  await loginAs(page, request, "olga");
  await page.goto(`/chats/${id}`);
  await expect(page.getByRole("button", { name: "Зарегистрировать задачу" })).toHaveCount(0);
  await expect(page.getByPlaceholder("Сообщение")).toHaveCount(0);
});
