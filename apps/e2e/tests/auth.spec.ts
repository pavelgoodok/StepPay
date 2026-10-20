import { expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

test.beforeEach(async ({ request }) => resetDemo(request));

test("регистрация нового исполнителя по номеру телефона", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("Номер телефона").fill("+7 999 111-22-33");
  await page.getByRole("button", { name: "Получить код" }).click();
  await page.getByRole("button", { name: /Исполнитель/ }).click();
  await page.getByPlaceholder("Фамилия и имя").fill("Петр Сидоров");
  await page.locator(".sms").click(); // демо-код подставляется нажатием
  await page.waitForURL(/\/services\/new/);
  await expect(page.getByText("Услуга", { exact: false }).first()).toBeVisible();
});

test("вход по демо-аккаунту", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /демо-пользовател/i }).click();
  await page.locator(".who", { hasText: "Анна" }).click();
  await page.waitForURL(/\/deals/);
  await expect(page.locator("body")).toContainText("Сделки");
});

test("без входа раздел сделок ведет на экран входа", async ({ page }) => {
  await page.goto("/deals");
  await page.waitForURL(/\/login/);
});
