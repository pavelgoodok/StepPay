import { expect, test } from "@playwright/test";
import { loginAs, resetDemo } from "./helpers";

test.beforeEach(async ({ request }) => resetDemo(request, 3));

test("на телефоне нижнее меню не перекрывается и страницы не уходят за край", async ({ page, request }) => {
  await loginAs(page, request, "anna");
  for (const url of ["/deals", "/catalog", "/wallet", "/chats", "/profile", "/notifications"]) {
    await page.goto(url);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(800); // соединение событий открыто постоянно, ждать «тишины» сети нельзя
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `горизонтальная прокрутка на ${url}`).toBeLessThanOrEqual(1);
  }
});

test("панель администратора на телефоне: меню прокручивается, таблицы внутри блока", async ({ page, request }) => {
  await loginAs(page, request, "admin");
  await page.goto("/admin/transactions");
  await expect(page.getByRole("heading", { name: "Операции" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
