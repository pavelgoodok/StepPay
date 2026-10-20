import { defineConfig, devices } from "@playwright/test";

const ci = !!process.env.CI;
/** В облачной среде браузер уже установлен: путь задается переменной PW_CHROMIUM. */
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: "./tests",
  // все сценарии работают с одним демо-сервером и сбрасывают его состояние, поэтому идут по очереди
  workers: 1,
  fullyParallel: false,
  retries: ci ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    locale: "ru-RU",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath, args: ["--no-sandbox"] },
  },
  projects: [
    { name: "desktop", testIgnore: /mobile\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 820 }, launchOptions: { executablePath, args: ["--no-sandbox"] } } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"], launchOptions: { executablePath, args: ["--no-sandbox"] } } },
  ],
  webServer: [
    {
      command: "pnpm --filter @steppay/api exec tsx src/server.ts",
      url: "http://localhost:4000/health",
      reuseExistingServer: !ci,
      timeout: 60_000,
      env: { PORT: "4000", DEMO_MODE: "on", AUTH_SECRET: "e2e-secret" },
    },
    {
      // сборка веб-части выполняется заранее (pnpm --filter @steppay/web build с NEXT_PUBLIC_API_URL=http://localhost:4000)
      command: "pnpm --filter @steppay/web exec next start -p 3000",
      url: "http://localhost:3000/login",
      reuseExistingServer: !ci,
      timeout: 60_000,
    },
  ],
});
