#!/usr/bin/env node
// Генерация секретов и готовых блоков переменных для Railway и Vercel.
// Запуск: node scripts/gen-env.mjs --api https://api.example.com --web https://site.example.com --admin +79001234567
// Без аргументов печатает только секреты. Ничего никуда не отправляет, файл не пишет, если не указан --out.
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : undefined; };
const strip = (u) => (u ?? "").replace(/\/+$/, "");

const api = strip(opt("api"));
const web = strip(opt("web"));
const admin = opt("admin");
const out = opt("out");
const demo = args.includes("--demo");

const errors = [];
if (api && !/^https:\/\/[^\s/]+$/.test(api)) errors.push("--api: нужен адрес вида https://домен, без пути");
if (web && !/^https:\/\/[^\s/]+$/.test(web)) errors.push("--web: нужен адрес вида https://домен, без пути (у CORS точное совпадение)");
if (admin && !admin.split(",").every((p) => /^\+7\d{10}$/.test(p.trim()))) errors.push("--admin: номера в формате +79001234567, несколько через запятую");
if (out && existsSync(out)) errors.push(`--out: файл ${out} уже есть, не перезаписываю`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }

const hex = (n) => randomBytes(n).toString("hex");
const secrets = { AUTH_SECRET: hex(32), FILE_KEY: hex(32), ANCHOR_TOKEN: hex(24), CHAIN_WALLET_SEED: hex(32) };

const railway = [
  "NODE_ENV=production",
  `AUTH_SECRET=${secrets.AUTH_SECRET}`,
  `FILE_KEY=${secrets.FILE_KEY}`,
  `CORS_ORIGIN=${web || "https://ВАШ-САЙТ"}`,
  `DEMO_MODE=${demo ? "on" : "off"}`,
  `ADMIN_PHONES=${admin ?? "+7XXXXXXXXXX"}`,
  "ADMIN_REQUIRE_PASSKEY=1",
  "SIGNATURE_POLICY=passkey",
  "# необязательно:",
  "# ANCHOR_URL=https://...",
  `# ANCHOR_TOKEN=${secrets.ANCHOR_TOKEN}`,
  "# ANTHROPIC_API_KEY=sk-ant-...",
  "# Тестовая сеть Ethereum (после pnpm deploy:sepolia в packages/contracts):",
  "# CHAIN_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/...",
  "# CHAIN_ID=11155111",
  "# CHAIN_ESCROW=0x...",
  "# CHAIN_TOKEN=0x...",
  "# CHAIN_DEPLOYER_KEY=0x...   (только тестовый ключ)",
  `# CHAIN_WALLET_SEED=${secrets.CHAIN_WALLET_SEED}`,
].join("\n");
const vercel = `NEXT_PUBLIC_API_URL=${api || "https://ВАШ-API"}`;

const text = `# Railway, сервис API (DATABASE_URL и PORT выдает сама Railway)\n${railway}\n\n# Vercel, проект apps/web\n${vercel}\n`;
if (out) { writeFileSync(out, text, { mode: 0o600 }); console.log(`Записано в ${out} (права 600). Не коммитьте этот файл.`); }
else console.log(text);
console.error("\nСохраните AUTH_SECRET и FILE_KEY в менеджере паролей. Потеря FILE_KEY делает зашифрованные файлы и анкеты нечитаемыми.");
