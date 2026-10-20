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

describe("пользователи и платформа в таблице docs", () => {
  it("переносят прежние документы и пишут только изменения", async () => {
    const db = new PGlite();
    await db.query("create table app_state (id int primary key, state jsonb not null, updated_at timestamptz not null default now())");
    await db.query("insert into app_state (id, state) values (2, $1), (3, $2)", [
      JSON.stringify([{ id: "u1", phone: "1", name: "A", createdAt: 1 }, { id: "u2", phone: "2", name: "B", createdAt: 2 }]),
      JSON.stringify({ projects: [{ id: "p2" }, { id: "p1" }], services: [], threads: [{ id: "t1" }], notes: { u1: [{ id: "n1" }] }, notesSeen: { u1: 5 }, reviews: [{ id: "r1" }] }),
    ]);
    const open = async () => {
      const st = new PgStore("postgres://pglite", asPool(db));
      await st.init();
      return st;
    };
    const a = await open();
    const users = await a.loadUsers();
    const plat = await a.loadPlatform();
    expect(users.map((u) => u.id)).toEqual(["u1", "u2"]);
    expect(plat.projects.map((p) => p.id)).toEqual(["p2", "p1"]); // порядок сохранен
    expect(plat.notesSeen).toEqual({ u1: 5 });
    users.push({ id: "u3", phone: "3", name: "C", createdAt: 3 });
    users.shift();
    plat.projects.pop();
    plat.notes!.u9 = [];
    await a.saveUsers(users);
    await a.savePlatform(plat);
    const b = await open();
    expect((await b.loadUsers()).map((u) => u.id)).toEqual(["u2", "u3"]);
    const p2 = await b.loadPlatform();
    expect(p2.projects.map((p) => p.id)).toEqual(["p2"]);
    expect(Object.keys(p2.notes!).sort()).toEqual(["u1", "u9"]);
    expect(p2.threads).toHaveLength(1);
  });
});

describe("несколько экземпляров API на одной базе", () => {
  const mk = async (db: PGlite) => {
    const st = new PgStore("postgres://pglite", asPool(db));
    await st.init();
    return st;
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const boot = async (db: PGlite) => {
    const store = new PgStore("postgres://pglite", asPool(db));
    await store.init();
    return buildApp({ store, secret: "s", seedCatalog: true });
  };
  const token = async (app: Awaited<ReturnType<typeof boot>>, userId: string) => (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId } })).json().token as string;
  const wallet = async (app: Awaited<ReturnType<typeof boot>>, tok: string) => (await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${tok}` } })).json().wallet.free as number;
  const topup = (app: Awaited<ReturnType<typeof boot>>, tok: string, amount: number) =>
    app.inject({ method: "POST", url: "/wallet/topup", headers: { authorization: `Bearer ${tok}` }, payload: { amount } });

  it("одновременные пополнения на двух экземплярах не теряются", async () => {
    const db = new PGlite();
    const a = await boot(db);
    const b = await boot(db);
    const ta = await token(a, "anna");
    const base = await wallet(a, ta);
    const calls = [];
    for (let i = 0; i < 6; i++) calls.push(topup(a, ta, 100), topup(b, ta, 1000));
    const res = await Promise.all(calls);
    expect(res.every((r) => r.statusCode === 200)).toBe(true);
    await sleep(300);
    expect(await wallet(a, ta)).toBe(base + 6 * 100 + 6 * 1000);
    expect(await wallet(b, ta)).toBe(base + 6 * 100 + 6 * 1000);
    await a.close();
    await b.close();
  }, 60_000);

  it("код входа, запрошенный на одном экземпляре, подтверждается на другом, а пользователь виден обоим", async () => {
    const db = new PGlite();
    const a = await boot(db);
    const b = await boot(db);
    const phone = "+79990001122";
    const code = (await a.inject({ method: "POST", url: "/auth/otp/request", payload: { phone } })).json().demoCode as string;
    const v = await b.inject({ method: "POST", url: "/auth/otp/verify", payload: { phone, code, name: "Иван Иванов" } });
    expect(v.statusCode).toBe(200);
    await sleep(300);
    const me = await a.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${v.json().token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.name).toBe("Иван Иванов");
    // повторное использование кода невозможно
    const again = await a.inject({ method: "POST", url: "/auth/otp/verify", payload: { phone, code } });
    expect(again.statusCode).toBe(400);
    await a.close();
    await b.close();
  }, 60_000);

  it("устаревшая запись отклоняется версией состояния", async () => {
    const db = new PGlite();
    const s1 = await mk(db);
    const s2 = await mk(db);
    const x = await s1.load();
    const y = await s2.load();
    x.wallets.a = 1;
    await s1.save(x);
    y.wallets.a = 2;
    await expect(s2.save(y)).rejects.toThrow(/другим экземпляром/);
    expect(await s2.stale()).toBe(true);
    const fresh = await s2.load();
    expect(fresh.wallets.a).toBe(1);
    fresh.wallets.a = 3;
    await s2.save(fresh);
    expect((await (await mk(db)).load()).wallets.a).toBe(3);
  });
});

describe("сообщения чата отдельными строками", () => {
  const open = async (db: PGlite) => {
    const st = new PgStore("postgres://pglite", asPool(db));
    await st.init();
    return st;
  };
  const thread = (messages: unknown[]) => ({ id: "c1", serviceId: "s", customerId: "a", executorId: "b", messages, read: {}, createdAt: 1, updatedAt: 1 });
  const msg = (id: string, at: number) => ({ id, by: "a", text: id, at, kind: "text" as const });

  it("сообщения, записанные двумя экземплярами в один чат, не затирают друг друга", async () => {
    const db = new PGlite();
    const a = await open(db);
    const b = await open(db);
    await a.savePlatform({ projects: [], services: [], threads: [thread([msg("m0", 1)])] } as never);
    const pa = await a.loadPlatform();
    const pb = await b.loadPlatform();
    pa.threads[0]!.messages.push(msg("m1", 2));
    pb.threads[0]!.messages.push(msg("m2", 3));
    await a.savePlatform(pa);
    await b.savePlatform(pb);
    const fresh = await (await open(db)).loadPlatform();
    expect(fresh.threads[0]!.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
  });

  it("прежний формат (сообщения внутри чата) читается и переносится в строки", async () => {
    const db = new PGlite();
    await db.query("create table app_state (id int primary key, state jsonb not null, updated_at timestamptz not null default now())");
    await db.query("insert into app_state (id, state) values (3, $1)", [JSON.stringify({ projects: [], services: [], threads: [thread([msg("m0", 1), msg("m1", 2)])] })]);
    const a = await open(db);
    const p = await a.loadPlatform();
    expect(p.threads[0]!.messages).toHaveLength(2);
    p.threads[0]!.messages.push(msg("m2", 3));
    await a.savePlatform(p);
    const rows = await db.query("select count(*)::int as n from docs where coll = 'messages'");
    expect((rows.rows[0] as { n: number }).n).toBe(3);
    const after = await (await open(db)).loadPlatform();
    expect(after.threads[0]!.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
  });
});

describe("журнал действий отдельными строками", () => {
  const open = async (db: PGlite) => {
    const st = new PgStore("postgres://pglite", asPool(db));
    await st.init();
    return st;
  };
  const base = { projects: [], services: [], threads: [] };

  it("записи, добавленные двумя экземплярами одновременно, не сливаются", async () => {
    const db = new PGlite();
    const a = await open(db);
    const b = await open(db);
    await a.savePlatform({ ...base, audit: [{ id: "a0", at: 1, by: "x", action: "старая" }] });
    const pa = await a.loadPlatform();
    const pb = await b.loadPlatform();
    pa.audit!.push({ id: "a1", at: 2, by: "x", action: "первая" });
    pb.audit!.push({ id: "a2", at: 3, by: "y", action: "вторая" });
    await a.savePlatform(pa);
    await b.savePlatform(pb);
    const fresh = await (await open(db)).loadPlatform();
    expect(fresh.audit!.map((e) => e.action)).toEqual(["старая", "первая", "вторая"]);
  });

  it("старые записи без номера читаются по порядку и получают номер", async () => {
    const db = new PGlite();
    await db.query("create table app_state (id int primary key, state jsonb not null, updated_at timestamptz not null default now())");
    await db.query("insert into app_state (id, state) values (3, $1)", [JSON.stringify({ ...base, audit: [{ at: 5, by: "x", action: "б" }, { at: 1, by: "x", action: "а" }] })]);
    const a = await open(db);
    const p = await a.loadPlatform();
    expect(p.audit!.map((e) => e.action)).toEqual(["а", "б"]);
    expect(p.audit!.every((e) => !!e.id)).toBe(true);
    p.audit!.push({ id: "n1", at: 9, by: "x", action: "в" });
    await a.savePlatform(p);
    expect((await (await open(db)).loadPlatform()).audit!.map((e) => e.action)).toEqual(["а", "б", "в"]);
  });
});
