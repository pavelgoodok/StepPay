import { expect, test } from "@playwright/test";
import { resetDemo } from "./helpers";

test.beforeEach(async ({ request }) => resetDemo(request));

test("в демо новый исполнитель входит по имени, без номера телефона", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByPlaceholder("Номер телефона")).toHaveCount(0);
  await page.getByRole("button", { name: /Исполнитель/ }).click();
  await page.getByPlaceholder("Имя").fill(`Петр ${Date.now()}`);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
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
