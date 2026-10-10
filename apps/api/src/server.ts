import { buildApp } from "./app";
import { MemoryStore, PgStore, type Store } from "./store";

const secret = process.env.AUTH_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-secret");
if (!secret) throw new Error("AUTH_SECRET обязателен в production");

let store: Store;
if (process.env.DATABASE_URL) {
  const pgStore = new PgStore(process.env.DATABASE_URL);
  await pgStore.init();
  store = pgStore;
} else {
  console.warn("DATABASE_URL не задан — данные хранятся в памяти и пропадут при перезапуске");
  store = new MemoryStore();
}

const app = await buildApp({ store, secret, corsOrigin: process.env.CORS_ORIGIN, seedCatalog: true, demoMode: process.env.DEMO_MODE !== "off" });
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
console.log(`StepPay API on :${port}`);
