import { PGlite } from "@electric-sql/pglite";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { PgStore } from "../src/store";

/** PGlite - настоящий Postgres в WASM: проверяем реальный SQL и то, что данные переживают перезапуск API. */
const asPool = (db: PGlite) =>
  ({ query: async (text: string, params?: unknown[]) => ({ rows: (await db.query(text, params)).rows }) }) as unknown as Pick<pg.Pool, "query">;

describe("PgStore на Postgres", () => {
  it("сделки, кошельки и фото сохраняются между запусками API", async () => {
    const db = new PGlite();
    const open = async () => {
      const store = new PgStore("postgres://pglite", asPool(db));
      await store.init();
      return buildApp({ store, secret: "s", seedCatalog: true });
    };

    const app1 = await open();
    const tok = (await app1.inject({ method: "POST", url: "/auth/demo", payload: { userId: "anna" } })).json().token;
    await app1.inject({ method: "POST", url: "/wallet/topup", headers: { authorization: `Bearer ${tok}` }, payload: { amount: 12_345 } });
    await app1.close();

    const app2 = await open(); // «перезапуск» на той же базе
    const me = await app2.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${tok}` } });
    expect(me.json().wallet.free).toBe(300_000 * 100 + 12_345); // не пересеяно заново
    expect((await app2.inject({ method: "GET", url: "/projects", headers: { authorization: `Bearer ${tok}` } })).json().length).toBeGreaterThanOrEqual(4);
    const img = await app2.inject({ method: "GET", url: "/uploads/demo-tile-photo-0001" });
    expect(img.statusCode).toBe(200);
    expect(img.rawPayload.length).toBeGreaterThan(5000);
    expect(img.rawPayload[0]).toBe(0xff); // JPEG-сигнатура: бинарные данные не испорчены bytea
    await app2.close();
    await db.close();
  }, 30000);
});
