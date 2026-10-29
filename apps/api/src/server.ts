import { buildApp } from "./app";
import { chainFromEnv } from "./chain";
import { MemoryStore, PgStore, type Store } from "./store";

const secret = process.env.AUTH_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-secret");
if (!secret) throw new Error("AUTH_SECRET обязателен в production");

if (process.env.NODE_ENV === "production" && !process.env.CORS_ORIGIN) console.warn("CORS_ORIGIN не задан: запросы с других адресов будут отклонены");

let store: Store;
if (process.env.DATABASE_URL) {
  const pgStore = new PgStore(process.env.DATABASE_URL);
  // сразу после запуска частная сеть Railway бывает недоступна несколько секунд: повторяем подключение, а не падаем
  for (let attempt = 1; ; attempt++) {
    try {
      await pgStore.init();
      break;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (attempt >= 10 || !["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "ECONNRESET"].includes(code ?? "")) throw e;
      console.warn(`База данных недоступна (${code}), попытка ${attempt} из 10, повтор через 3 секунды`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  // перенос сделок в сеть ведет одно состояние (очередь транзакций кошельков): при включенной сети или SINGLE_WRITER=1
  // новая версия ждет, пока старая освободит блокировку. Без сети экземпляров может быть несколько.
  if ((process.env.CHAIN_RPC_URL || process.env.SINGLE_WRITER === "1") && !(await pgStore.acquireLeader()))
    throw new Error("Другой экземпляр API держит блокировку базы дольше 10 минут");
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

let chain: ReturnType<typeof chainFromEnv>;
try {
  chain = chainFromEnv(process.env);
} catch (e) {
  // ошибка в настройках сети не должна ронять приложение: работаем без переноса сделок на контракт
  console.error(`Тестовая сеть отключена, исправьте переменные CHAIN_*: ${(e as Error).message}`);
}
if (chain) console.log(`Тестовая сеть: ${chain.info().network}, контракт ${chain.info().contract}`);
/** Пределы запросов в минуту с одного адреса; для сквозных тестов их поднимают переменными RATE_LIMIT_*. */
const rateLimit = { general: Number(process.env.RATE_LIMIT_GENERAL ?? 600), auth: Number(process.env.RATE_LIMIT_AUTH ?? 120), uploads: Number(process.env.RATE_LIMIT_UPLOADS ?? 30) };
/** "1" включает, "0" выключает, иначе значение по умолчанию */
const flag = (v: string | undefined) => (v === "1" ? true : v === "0" ? false : undefined);
const app = await buildApp({ store, chain, rateLimit, fileKey: process.env.FILE_KEY, adminRequireKey: flag(process.env.ADMIN_REQUIRE_KEY ?? process.env.ADMIN_REQUIRE_PASSKEY), passkeys: process.env.PASSKEYS === "1", anchorPublish, anchorEveryMs: process.env.ANCHOR_EVERY_MIN ? Number(process.env.ANCHOR_EVERY_MIN) * 60_000 : undefined, secret, corsOrigin: process.env.CORS_ORIGIN, seedCatalog: true, demoMode: process.env.DEMO_MODE === "1", allowTopup: process.env.ALLOW_TOPUP === "1" ? true : undefined, signaturePolicy: process.env.SIGNATURE_POLICY === "device" || (process.env.SIGNATURE_POLICY === "passkey" && process.env.PASSKEYS !== "1") ? "device" : process.env.SIGNATURE_POLICY === "passkey" ? "passkey" : "any", adminPhones: (process.env.ADMIN_PHONES ?? "").split(",").map((x) => x.trim()).filter(Boolean) });
const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: "0.0.0.0" });
console.log(`StepPay API on :${port}`);
