import { buildApp } from "./app";
import { MemoryStore, PgStore, type Store } from "./store";

const secret = process.env.AUTH_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-secret");
if (!secret) throw new Error("AUTH_SECRET обязателен в production");

if (process.env.NODE_ENV === "production" && !process.env.CORS_ORIGIN) console.warn("CORS_ORIGIN не задан: запросы с других адресов будут отклонены");

let store: Store;
if (process.env.DATABASE_URL) {
  const pgStore = new PgStore(process.env.DATABASE_URL);
  await pgStore.init();
  store = pgStore;
} else {
  console.warn("DATABASE_URL не задан - данные хранятся в памяти и пропадут при перезапуске");
  store = new MemoryStore();
}

/** Публикация якорей во внешнее место: POST с JSON на ANCHOR_URL (журнал свидетеля, нотариальный сервис, свой сервер). */
const anchorUrl = process.env.ANCHOR_URL;
const anchorPublish = anchorUrl
  ? async (a: unknown) => {
      const res = await fetch(anchorUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...(process.env.ANCHOR_TOKEN ? { authorization: `Bearer ${process.env.ANCHOR_TOKEN}` } : {}) },
        body: JSON.stringify(a),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`внешний журнал ответил ${res.status}`);
      const ref = (await res.text().catch(() => "")).slice(0, 120).trim();
      return { target: new URL(anchorUrl).host, ref: ref || undefined };
    }
  : undefined;

const app = await buildApp({ store, anchorPublish, anchorEveryMs: process.env.ANCHOR_EVERY_MIN ? Number(process.env.ANCHOR_EVERY_MIN) * 60_000 : undefined, secret, corsOrigin: process.env.CORS_ORIGIN, seedCatalog: true, demoMode: process.env.DEMO_MODE !== "off", allowTopup: process.env.ALLOW_TOPUP === "1" ? true : undefined, signaturePolicy: process.env.SIGNATURE_POLICY === "device" ? "device" : process.env.SIGNATURE_POLICY === "passkey" ? "passkey" : "any", adminPhones: (process.env.ADMIN_PHONES ?? "").split(",").map((x) => x.trim()).filter(Boolean) });
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
console.log(`StepPay API on :${port}`);
