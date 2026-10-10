import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { MemoryStore } from "../src/store";

const R = 100;
let t = 1_000_000;
const DAY = 86_400_000;

async function setup() {
  const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => t });
  const tokens: Record<string, string> = {};
  for (const id of ["anna", "ivan", "olga", "max", "fond", "expert"]) {
    const r = await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: id } });
    tokens[id] = r.json().token;
  }
  const call = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${tokens[who]}` } });
    return { status: r.statusCode, body: r.json() };
  };
  return { app, call };
}

describe("API", () => {
  beforeEach(() => {
    t = 1_000_000;
  });

  it("требует вход и отвергает поддельный токен", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
    const r = await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer anna.fake" } });
    expect(r.statusCode).toBe(401);
  });

  it("демо-сценарий: ремонт по шаблону, резерв, приёмка, выплата", async () => {
    const { call } = await setup();
    const me = await call("anna", "GET", "/me");
    expect(me.body.wallet.free).toBe(300_000 * R);

    const created = await call("anna", "POST", "/deals", {
      mode: "own", title: "Ремонт ванной", executorId: "ivan", templateId: "bathroom", total: 300_000 * R,
    });
    expect(created.status).toBe(200);
    const id = created.body.id as string;
    expect(created.body.stages.map((s: { amount: number }) => s.amount / R)).toEqual([30_000, 60_000, 120_000, 90_000]);

    expect((await call("anna", "POST", `/deals/${id}/fund`, {})).status).toBe(200);
    expect((await call("anna", "GET", "/wallet")).body.reserved).toBe(300_000 * R);

    // чужой не может сдать этап
    expect((await call("anna", "POST", `/deals/${id}/stages/s1/submit`, {})).status).toBe(400);
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, { note: "готово" });
    const ok = await call("anna", "POST", `/deals/${id}/stages/s1/approve`);
    expect(ok.status).toBe(200);
    expect((await call("ivan", "GET", "/me")).body.wallet.free).toBe(30_000 * R);

    const list = await call("ivan", "GET", "/deals");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].stages).toEqual({ done: 1, total: 4 });
  });

  it("автоприёмка срабатывает через /system/tick спустя 3 дня", async () => {
    const { call } = await setup();
    const id = (await call("anna", "POST", "/deals", {
      mode: "own", title: "Сайт", executorId: "ivan", stages: [{ title: "Дизайн", amount: 10_000 * R }],
    })).body.id;
    await call("anna", "POST", `/deals/${id}/fund`, {});
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, {});
    t += 3 * DAY;
    await call("anna", "POST", "/system/tick");
    expect((await call("ivan", "GET", "/me")).body.wallet.free).toBe(10_000 * R);
  });

  it("краудфандинг: каталог, взносы, голосование", async () => {
    const { call } = await setup();
    const id = (await call("ivan", "POST", "/deals", {
      mode: "crowdfunding", title: "Настолка",
      stages: [{ title: "Макет", amount: 100_000 * R }, { title: "Тираж", amount: 100_000 * R }],
    })).body.id;
    await call("olga", "POST", `/deals/${id}/fund`, { amount: 100_000 * R });
    const proj = await call("olga", "GET", "/projects?mode=crowdfunding");
    expect(proj.body[0]).toMatchObject({ raised: 100_000 * R, sponsors: 1, status: "funding" });
    await call("max", "POST", `/deals/${id}/fund`, { amount: 100_000 * R });
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, {});
    await call("olga", "POST", `/deals/${id}/stages/s1/vote`, { vote: "accept" });
    await call("max", "POST", `/deals/${id}/stages/s1/vote`, { vote: "accept" });
    expect((await call("ivan", "GET", "/me")).body.wallet.free).toBe(100_000 * R);
  });

  it("грант: фонд отклоняет этап — остаток возвращается", async () => {
    const { call } = await setup();
    const id = (await call("fond", "POST", "/deals", {
      mode: "grant", title: "Культура районов", executorId: "ivan", stages: [{ title: "Закупка", amount: 50_000 * R }],
    })).body.id;
    await call("fond", "POST", `/deals/${id}/fund`, {});
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, {});
    const bad = await call("fond", "POST", `/deals/${id}/stages/s1/reject`, { reason: "" });
    expect(bad.status).toBe(400);
    await call("fond", "POST", `/deals/${id}/stages/s1/reject`, { reason: "Нет отчёта" });
    expect((await call("fond", "GET", "/me")).body.wallet.free).toBe(2_000_000 * R);
  });

  it("фото: загрузка, выдача, отсев чужих ссылок; спор с перепиской и решением", async () => {
    const { app, call } = await setup();
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    expect((await call("ivan", "POST", "/uploads", { dataUrl: "data:text/html;base64,PGI+" })).status).toBe(400);
    const up = await call("ivan", "POST", "/uploads", { dataUrl: png });
    expect(up.status).toBe(200);
    const img = await app.inject({ method: "GET", url: up.body.url });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");

    const id = (await call("anna", "POST", "/deals", {
      mode: "own", title: "Ванная", executorId: "ivan", stages: [{ title: "Плитка", amount: 10_000 * R }],
    })).body.id;
    await call("anna", "POST", `/deals/${id}/fund`, {});
    const evil = await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, { photos: ["https://evil.example/x.jpg"] });
    expect(evil.status).toBe(400);
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, { photos: [up.body.url] });
    await call("anna", "POST", `/deals/${id}/stages/s1/reject`, { reason: "Швы кривые" });
    await call("ivan", "POST", `/deals/${id}/stages/s1/reply`, { text: "Переделал", photos: [up.body.url] });
    expect((await call("olga", "POST", `/deals/${id}/stages/s1/reply`, { text: "я вмешаюсь" })).status).toBe(400);
    await call("expert", "POST", `/deals/${id}/stages/s1/resolve`, { decision: "pay", comment: "Фото подтверждают" });
    const d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.stages[0].messages).toHaveLength(2);
    expect(d.stages[0].resolution).toMatchObject({ by: "arbiter", decision: "accepted", comment: "Фото подтверждают" });
    expect((await call("ivan", "GET", "/me")).body.wallet.free).toBe(10_000 * R);
  });

  it("валидация: нужен шаблон или этапы", async () => {
    const { call } = await setup();
    const r = await call("anna", "POST", "/deals", { mode: "own", title: "X", executorId: "ivan" });
    expect(r.status).toBe(400);
  });
});
