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
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, { photos: ["x.jpg"] });
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

  it("валидация: нужен шаблон или этапы", async () => {
    const { call } = await setup();
    const r = await call("anna", "POST", "/deals", { mode: "own", title: "X", executorId: "ivan" });
    expect(r.status).toBe(400);
  });
});
