import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { makeTicket, makeToken, TICKET_TTL_MS, TOKEN_TTL_MS, verifyTicket, verifyToken } from "../src/auth";
import { MemoryStore } from "../src/store";

describe("токены и билеты", () => {
  const secret = "secret";
  it("токен действует 30 дней, подделка и чужой секрет отклоняются, отозванные не проходят", () => {
    const t0 = 1_000_000;
    const tok = makeToken(secret, "anna", t0);
    expect(verifyToken(secret, tok, t0 + 1000)).toBe("anna");
    expect(verifyToken(secret, tok, t0 + TOKEN_TTL_MS + 1)).toBeNull();
    expect(verifyToken("другой", tok, t0)).toBeNull();
    const [v, u, at, sig] = tok.split(".");
    expect(verifyToken(secret, [v, Buffer.from("olga").toString("base64url"), at, sig].join("."), t0)).toBeNull(); // другой пользователь под той же подписью
    expect(verifyToken(secret, [v, u, String(Number(at) + 1), sig].join("."), t0 + 5)).toBeNull(); // время выдачи не подделать
    expect(verifyToken(secret, `anna.${sig}`, t0)).toBeNull(); // старый формат без срока не принимается
    expect(verifyToken(secret, tok, t0 + 10, () => t0)).toBeNull(); // выдан не позже отзыва
    expect(verifyToken(secret, tok, t0 + 10, () => t0 - 1)).toBe("anna");
    expect(verifyToken(secret, undefined, t0)).toBeNull();
  });

  it("билет живет две минуты и не подходит как токен, а токен как билет", () => {
    const t0 = 5_000_000;
    const ticket = makeTicket(secret, "anna", t0);
    expect(verifyTicket(secret, ticket, t0 + 1000)).toBe("anna");
    expect(verifyTicket(secret, ticket, t0 + TICKET_TTL_MS + 1)).toBeNull();
    expect(verifyToken(secret, ticket, t0)).toBeNull();
    expect(verifyTicket(secret, makeToken(secret, "anna", t0), t0)).toBeNull();
  });
});

describe("защита API", () => {
  const mk = async (extra = {}) => buildApp({ store: new MemoryStore(), secret: "s", ...extra });
  const login = async (app: Awaited<ReturnType<typeof mk>>, id: string) => (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: id } })).json().token as string;

  it("пользователь завершает все сессии: старые токены отвергаются, новый вход работает", async () => {
    const app = await mk();
    const old = await login(app, "anna");
    const get = (tok: string) => app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${tok}` } });
    expect((await get(old)).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    expect((await app.inject({ method: "POST", url: "/auth/logout-all", headers: { authorization: `Bearer ${old}` } })).statusCode).toBe(200);
    expect((await get(old)).statusCode).toBe(401);
    await new Promise((r) => setTimeout(r, 5));
    expect((await get(await login(app, "anna"))).statusCode).toBe(200);
    const olga = await login(app, "olga");
    expect((await get(olga)).statusCode).toBe(200); // чужие сессии не затронуты
  });

  it("закрытый файл открывается по билету, токен в адресе запроса не принимается, просмотр администратором попадает в журнал действий", async () => {
    const app = await mk();
    await app.inject({ method: "POST", url: "/demo/reset" });
    const owner = await login(app, "games");
    const admin = await login(app, "admin");
    const anna = await login(app, "anna");
    const up = await app.inject({ method: "POST", url: "/uploads", headers: { authorization: `Bearer ${owner}` }, payload: { dataUrl: `data:application/pdf;base64,${Buffer.from("%PDF-1.4").toString("base64")}`, private: true } });
    const url = up.json().url as string;
    const ticket = async (tok: string) => (await app.inject({ method: "POST", url: "/auth/ticket", headers: { authorization: `Bearer ${tok}` } })).json().ticket as string;
    expect((await app.inject({ method: "GET", url: `${url}?token=${admin}` })).statusCode).toBe(401); // токен в ссылке больше не работает
    expect((await app.inject({ method: "GET", url: `${url}?ticket=${await ticket(anna)}` })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `${url}?ticket=${await ticket(owner)}` })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `${url}?ticket=${await ticket(admin)}` })).statusCode).toBe(200);
    const log = (await app.inject({ method: "GET", url: "/admin/audit", headers: { authorization: `Bearer ${admin}` } })).json();
    expect(log).toHaveLength(1); // просмотр владельцем в журнал не пишется
    expect(log[0]).toMatchObject({ action: "Просмотр документа проекта", byName: "Администратор платформы" });
    expect((await app.inject({ method: "GET", url: "/admin/audit", headers: { authorization: `Bearer ${anna}` } })).statusCode).toBe(403);
  });

  it("решения администратора записываются в журнал действий", async () => {
    const app = await mk();
    await app.inject({ method: "POST", url: "/demo/reset" });
    const admin = await login(app, "admin");
    const h = { authorization: `Bearer ${admin}` };
    const queue = (await app.inject({ method: "GET", url: "/admin/projects?status=review", headers: h })).json();
    expect((await app.inject({ method: "POST", url: `/admin/projects/${queue[0].id}/decision`, headers: h, payload: { action: "changes", comment: "Добавьте ссылки" } })).statusCode).toBe(200);
    const log = (await app.inject({ method: "GET", url: "/admin/audit", headers: h })).json();
    expect(log[0]).toMatchObject({ action: "Проект возвращен на доработку", by: "admin" });
  });

  it("заголовки безопасности и запрет кеширования ответов API", async () => {
    const app = await mk();
    const r = await app.inject({ method: "GET", url: "/templates" });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(r.headers["cache-control"]).toBe("no-store");
  });

  it("частые запросы получают отказ, остальные адреса не страдают", async () => {
    const app = await mk({ rateLimit: { general: 600, auth: 5, uploads: 30 } });
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) codes.push((await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: "anna" }, remoteAddress: "10.0.0.1" })).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 200)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429, 429]);
    expect((await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: "anna" }, remoteAddress: "10.0.0.2" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/health", remoteAddress: "10.0.0.1" })).statusCode).toBe(200); // проверка живости не ограничивается
  });

  it("пополнение без оплаты отключается вне демо-режима", async () => {
    const demo = await mk();
    const tokenD = await login(demo, "anna");
    expect((await demo.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${tokenD}` } })).json().features).toEqual({ topup: true });
    expect((await demo.inject({ method: "POST", url: "/wallet/topup", headers: { authorization: `Bearer ${tokenD}` }, payload: { amount: 100 } })).statusCode).toBe(200);

    const prod = await mk({ demoMode: false });
    const reg = async (phone: string) => {
      const r = (await prod.inject({ method: "POST", url: "/auth/otp/request", payload: { phone } })).json();
      return (await prod.inject({ method: "POST", url: "/auth/otp/verify", payload: { phone, code: r.demoCode, name: "Пользователь" } })).json();
    };
    const u = await reg("+79995550101");
    const h = { authorization: `Bearer ${u.token}` };
    expect((await prod.inject({ method: "POST", url: "/wallet/topup", headers: h, payload: { amount: 100 } })).statusCode).toBe(403);
    expect((await prod.inject({ method: "GET", url: "/me", headers: h })).json().features).toEqual({ topup: false });
    const explicit = await mk({ demoMode: false, allowTopup: true });
    const r2 = (await explicit.inject({ method: "POST", url: "/auth/otp/request", payload: { phone: "+79995550102" } })).json();
    const u2 = (await explicit.inject({ method: "POST", url: "/auth/otp/verify", payload: { phone: "+79995550102", code: r2.demoCode, name: "Пользователь" } })).json();
    expect((await explicit.inject({ method: "POST", url: "/wallet/topup", headers: { authorization: `Bearer ${u2.token}` }, payload: { amount: 100 } })).statusCode).toBe(200);
  });
});

describe("шифрование закрытых файлов", () => {
  const pdf = Buffer.from("%PDF-1.4 секретный документ с ИНН 500100112294");

  async function up(app: Awaited<ReturnType<typeof buildApp>>, token: string, priv: boolean) {
    const r = await app.inject({ method: "POST", url: "/uploads", headers: { authorization: `Bearer ${token}` }, payload: { dataUrl: `data:application/pdf;base64,${pdf.toString("base64")}`, private: priv } });
    return r.json() as { url: string };
  }

  it("закрытый файл лежит в хранилище зашифрованным, но владельцу отдается как есть", async () => {
    const store = new MemoryStore();
    const app = await buildApp({ store, secret: "s", now: () => 1_000_000 });
    const tok = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: "games" } })).json().token as string;
    const { url } = await up(app, tok, true);
    const raw = await store.getFile(url.slice("/uploads/".length));
    expect(raw!.data.subarray(0, 4).toString()).toBe("SPE1");
    expect(raw!.data.includes(Buffer.from("секретный"))).toBe(false);
    const ticket = (await app.inject({ method: "POST", url: "/auth/ticket", headers: { authorization: `Bearer ${tok}` } })).json().ticket as string;
    const got = await app.inject({ method: "GET", url: `${url}?ticket=${ticket}` });
    expect(got.statusCode).toBe(200);
    expect(Buffer.from(got.rawPayload).equals(pdf)).toBe(true);
  });

  it("открытые файлы не шифруются, подмена шифртекста или чужой идентификатор дают отказ", async () => {
    const store = new MemoryStore();
    const app = await buildApp({ store, secret: "s", now: () => 1_000_000 });
    const tok = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: "games" } })).json().token as string;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
    const pub = (await app.inject({ method: "POST", url: "/uploads", headers: { authorization: `Bearer ${tok}` }, payload: { dataUrl: `data:image/png;base64,${png.toString("base64")}` } })).json() as { url: string };
    expect((await store.getFile(pub.url.slice("/uploads/".length)))!.data.equals(png)).toBe(true);
    const a = await up(app, tok, true);
    const b = await up(app, tok, true);
    const ida = a.url.slice("/uploads/".length);
    const idb = b.url.slice("/uploads/".length);
    const fa = (await store.getFile(ida))!;
    const fb = (await store.getFile(idb))!;
    // шифртекст одного файла под идентификатором другого не расшифровывается
    await store.putFile(idb, { ...fb, data: fa.data });
    const ticket = (await app.inject({ method: "POST", url: "/auth/ticket", headers: { authorization: `Bearer ${tok}` } })).json().ticket as string;
    expect((await app.inject({ method: "GET", url: `${b.url}?ticket=${ticket}` })).statusCode).toBe(404);
    // порча одного байта
    const bad = Buffer.from(fa.data);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
    await store.putFile(ida, { ...fa, data: bad });
    expect((await app.inject({ method: "GET", url: `${a.url}?ticket=${ticket}` })).statusCode).toBe(404);
  });

  it("другой ключ не открывает файлы, ключ проверяется на длину", async () => {
    const store = new MemoryStore();
    const app1 = await buildApp({ store, secret: "s", fileKey: "00".repeat(32), now: () => 1_000_000 });
    const tok = (await app1.inject({ method: "POST", url: "/auth/demo", payload: { userId: "games" } })).json().token as string;
    const { url } = await up(app1, tok, true);
    const app2 = await buildApp({ store, secret: "s", fileKey: "11".repeat(32), now: () => 1_000_000 });
    const tok2 = (await app2.inject({ method: "POST", url: "/auth/demo", payload: { userId: "games" } })).json().token as string;
    const t2 = (await app2.inject({ method: "POST", url: "/auth/ticket", headers: { authorization: `Bearer ${tok2}` } })).json().ticket as string;
    expect((await app2.inject({ method: "GET", url: `${url}?ticket=${t2}` })).statusCode).toBe(404);
    await expect(buildApp({ store: new MemoryStore(), secret: "s", fileKey: "abc" })).rejects.toThrow(/FILE_KEY/);
  });
});

describe("шифрование анкет авторов и миграция", () => {
  const INN = "500100732259";
  const register = async (app: Awaited<ReturnType<typeof buildApp>>, phone: string) => {
    const req = (await app.inject({ method: "POST", url: "/auth/otp/request", payload: { phone } })).json();
    const r = (await app.inject({ method: "POST", url: "/auth/otp/verify", payload: { phone, code: req.demoCode, name: "Автор Проекта" } })).json();
    return r.token as string;
  };
  const saveAuthor = (app: Awaited<ReturnType<typeof buildApp>>, token: string) =>
    app.inject({ method: "POST", url: "/me/author", payload: { legalStatus: "selfemployed", inn: INN, email: "author@example.com" }, headers: { authorization: `Bearer ${token}` } });

  it("в базе нет открытых ИНН и почты, после перезапуска анкета читается", async () => {
    const store = new MemoryStore();
    const app = await buildApp({ store, secret: "s", now: () => 1_000_000 });
    const tok = await register(app, "+79301234505");
    expect((await saveAuthor(app, tok)).statusCode).toBe(200);
    const raw = JSON.stringify(await store.loadUsers());
    expect(raw).not.toContain(INN);
    expect(raw).not.toContain("author@example.com");
    expect(raw).toContain("authorEnc");
    const again = await buildApp({ store, secret: "s", now: () => 1_000_000 });
    const got = await again.inject({ method: "GET", url: "/me/author", headers: { authorization: `Bearer ${tok}` } });
    expect(got.json()).toMatchObject({ inn: INN, email: "author@example.com" });
  });

  it("чужой ключ не читает анкеты, но сервер запускается", async () => {
    const store = new MemoryStore();
    const app = await buildApp({ store, secret: "s", fileKey: "00".repeat(32), now: () => 1_000_000 });
    const tok = await register(app, "+79301234506");
    await saveAuthor(app, tok);
    const other = await buildApp({ store, secret: "s", fileKey: "11".repeat(32), now: () => 1_000_000 });
    const got = await other.inject({ method: "GET", url: "/me/author", headers: { authorization: `Bearer ${tok}` } });
    expect(got.json()).toBeNull();
  });

  it("анкеты и закрытые файлы прежних версий шифруются при запуске", async () => {
    const store = new MemoryStore();
    const app = await buildApp({ store, secret: "s", now: () => 1_000_000 });
    const tok = await register(app, "+79301234507");
    const users = await store.loadUsers();
    users[0]!.author = { legalStatus: "selfemployed", inn: INN, email: "old@example.com" }; // как в базе до шифрования
    await store.saveUsers(users);
    await store.putFile("legacy1", { mime: "application/pdf", data: Buffer.from("%PDF старый документ"), private: true, ownerId: users[0]!.id });
    await store.putFile("pub1", { mime: "image/png", data: Buffer.from("png"), private: false });
    const up = await buildApp({ store, secret: "s", now: () => 1_000_000 });
    expect(JSON.stringify(await store.loadUsers())).not.toContain("old@example.com");
    const f = await store.getFile("legacy1");
    expect(f!.data.subarray(0, 4).toString()).toBe("SPE1");
    expect((await store.getFile("pub1"))!.data.toString()).toBe("png");
    expect(await store.plainPrivateFileIds()).toEqual([]);
    const got = await up.inject({ method: "GET", url: "/me/author", headers: { authorization: `Bearer ${tok}` } });
    expect(got.json()).toMatchObject({ email: "old@example.com" });
  });
});
