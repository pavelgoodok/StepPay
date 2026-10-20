import { expect, test } from "@playwright/test";
import { callApi, loginAs, resetDemo, tokenOf } from "./helpers";

test.beforeEach(async ({ request }) => resetDemo(request, 6));

test("обычный участник не попадает в интерфейс администратора", async ({ page, request }) => {
  await loginAs(page, request, "anna");
  await page.goto("/admin");
  await expect(page.getByText("Раздел для администраторов")).toBeVisible();
  const r = await request.get("http://localhost:4000/admin/dashboard", { headers: { authorization: `Bearer ${await tokenOf(request, "anna")}` } });
  expect(r.status()).toBe(403);
});

test("администратор видит показатели и операции участников", async ({ page, request }) => {
  await loginAs(page, request, "admin");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Показатели" })).toBeVisible();
  await expect(page.getByText("Зарезервировано", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Операции" }).click();
  await expect(page.getByRole("heading", { name: "Операции" })).toBeVisible();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
  await page.getByRole("button", { name: "Выплата за этап" }).click();
  await expect(page.locator("table tbody tr")).toHaveCount(1);
  await page.getByPlaceholder(/Поиск/).fill("такого нет");
  await expect(page.getByText("Операций не найдено")).toBeVisible();
});

test("подтверждение данных: заявка исполнителя, решение администратора, отметка в профиле", async ({ browser, request }) => {
  const ivan = await tokenOf(request, "ivan");
  await callApi(request, ivan, "POST", "/me/mode", { kind: "executor" });
  const ictx = await browser.newContext();
  const ipage = await ictx.newPage();
  await loginAs(ipage, request, "ivan");
  await ipage.goto("/profile");
  await ipage.getByRole("button", { name: "Подать заявку" }).click();
  await ipage.getByRole("button", { name: "Организация" }).click();
  await ipage.getByPlaceholder("ИНН").fill("7707083893");
  await ipage.locator(".field", { hasText: "Название организации" }).locator("input").fill("ООО Мастерская");
  await ipage.getByRole("button", { name: "Отправить на подтверждение" }).click();
  await expect(ipage.getByText("На рассмотрении")).toBeVisible();

  const actx = await browser.newContext();
  const admin = await actx.newPage();
  await loginAs(admin, request, "admin");
  await admin.goto("/admin/verifications");
  await expect(admin.getByText("ООО Мастерская")).toBeVisible();
  await expect(admin.getByRole("button", { name: "Отказать" })).toBeDisabled(); // без причины отказ недоступен
  await admin.getByRole("button", { name: "Подтвердить" }).click();
  await expect(admin.getByText("Заявок нет")).toBeVisible();

  await ipage.reload();
  await expect(ipage.getByText("Проверено").first()).toBeVisible();
  // отметка видна другим участникам на странице исполнителя
  const anna = await ictx.newPage();
  await loginAs(anna, request, "anna");
  await anna.goto("/users/ivan");
  await expect(anna.getByText("Проверено")).toBeVisible();
  await ictx.close();
  await actx.close();
});
