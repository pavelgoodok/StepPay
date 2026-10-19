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

describe("единственный пишущий экземпляр", () => {
  it("второй экземпляр ждет, пока первый освободит блокировку", async () => {
    let held = true;
    let tries = 0;
    const client = { query: async () => ({ rows: [{ ok: !held && ++tries > 0 }] }), release() {} };
    const pool = { query: async () => ({ rows: [] }), connect: async () => client } as unknown as Pick<pg.Pool, "query" | "connect">;
    const store = new PgStore("postgres://x", pool);
    setTimeout(() => (held = false), 30);
    expect(await store.acquireLeader(10, 1000)).toBe(true);
    expect(tries).toBe(1);
  });

  it("сдается, если блокировка не освободилась за отведенное время", async () => {
    const client = { query: async () => ({ rows: [{ ok: false }] }), release() {} };
    const pool = { query: async () => ({ rows: [] }), connect: async () => client } as unknown as Pick<pg.Pool, "query" | "connect">;
    expect(await new PgStore("postgres://x", pool).acquireLeader(5, 30)).toBe(false);
  });
});

describe("состояние в таблицах", () => {
  const mk = async (db: PGlite) => {
    const st = new PgStore("postgres://pglite", asPool(db));
    await st.init();
    return st;
  };
  it("переносит прежний единый документ и дальше пишет только изменения", async () => {
    const db = new PGlite();
    await db.query("create table app_state (id int primary key, state jsonb not null, updated_at timestamptz not null default now())");
    const old = { wallets: { a: 100 }, deals: {}, ledger: [{ id: 1, at: 1, type: "topup", userId: "a", amount: 100 }] };
    await db.query("insert into app_state (id, state) values (1, $1)", [JSON.stringify(old)]);
    const s1 = await (await mk(db)).load();
    expect(s1.wallets.a).toBe(100);
    expect(s1.ledger).toHaveLength(1);
    const st = await mk(db);
    const loaded = await st.load();
    loaded.wallets.a = 250;
    loaded.wallets.b = 5;
    loaded.ledger.push({ id: 2, at: 2, type: "topup", userId: "b", amount: 5 });
    await st.save(loaded);
    const again = await (await mk(db)).load();
    expect(again.wallets).toEqual({ a: 250, b: 5 });
    expect(again.ledger.map((e) => e.id)).toEqual([1, 2]);
  });
  it("удаляет исчезнувшие строки и переписывает журнал после сброса", async () => {
    const db = new PGlite();
    const st = await mk(db);
    const s = await st.load();
    s.wallets.a = 1;
    s.ledger.push({ id: 1, at: 1, type: "topup", userId: "a", amount: 1 }, { id: 2, at: 2, type: "topup", userId: "a", amount: 1 });
    await st.save(s);
    await st.save({ wallets: { z: 9 }, deals: {}, ledger: [{ id: 1, at: 5, type: "topup", userId: "z", amount: 9 }] });
    const r = await (await mk(db)).load();
    expect(r.wallets).toEqual({ z: 9 });
    expect(r.ledger).toHaveLength(1);
    expect(r.ledger[0]!.userId).toBe("z");
  });
});
