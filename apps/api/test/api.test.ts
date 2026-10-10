import { beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import { normalizePlan, templatePlan, createPlanner } from "../src/ai";
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

describe("AI-планировщик", () => {
  it("без ключа подбирает шаблон по словам и не падает", async () => {
    const p = templatePlan({ description: "Нужно переделать ванную и положить плитку", mode: "own" });
    expect(p.source).toBe("template");
    expect(p.title).toBe("Ремонт ванной");
    expect(p.stages.reduce((a, s) => a + s.share, 0)).toBe(100);
    const generic = templatePlan({ description: "Сделать что-то неопределённое", mode: "own" });
    expect(generic.stages).toHaveLength(3);
    expect((await createPlanner("").plan({ description: "Сайт для пекарни", mode: "own" })).source).toBe("template");
  });

  it("normalizePlan приводит доли к 100 и отсеивает мусор", () => {
    const s = normalizePlan({ title: "x", stages: [
      { title: "А", share: 30, criteria: ["ок"] }, { title: "Б", share: 50, criteria: [] }, { title: "В", share: 10, criteria: [] },
    ] })!;
    expect(s.reduce((a, x) => a + x.share, 0)).toBe(100);
    expect(s.find((x) => x.title === "Б")!.share).toBe(60);
    expect(normalizePlan({ title: "x", stages: [{ title: "Один", share: 100, criteria: [] }] })).toBeNull();
    expect(normalizePlan({ title: "x", stages: [{ title: "", share: 50, criteria: [] }, { title: "Б", share: 0, criteria: [] }] })).toBeNull();
  });

  it("/ai/plan: нужен вход, валидация, подмена планировщика, лимит запросов", async () => {
    const calls: unknown[] = [];
    const planner = { plan: async (i: unknown) => (calls.push(i), { title: "Т", stages: [{ title: "А", share: 100, criteria: [] }], source: "claude" as const }) };
    const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => t, planner });
    const token = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: "anna" } })).json().token;
    const h = { authorization: `Bearer ${token}` };
    expect((await app.inject({ method: "POST", url: "/ai/plan", payload: { description: "ремонт кухни" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/ai/plan", headers: h, payload: { description: "?" } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/ai/plan", headers: h, payload: { description: "ремонт кухни", mode: "own", total: 100000 } });
    expect(ok.json().source).toBe("claude");
    expect(calls).toHaveLength(1);
    for (let i = 0; i < 7; i++) await app.inject({ method: "POST", url: "/ai/plan", headers: h, payload: { description: "ремонт кухни" } });
    expect((await app.inject({ method: "POST", url: "/ai/plan", headers: h, payload: { description: "ремонт кухни" } })).statusCode).toBe(429);
  });
});

describe("репутация, чеки, события", () => {
  it("публичная карточка считает рейтинг по закрытым этапам; чеки по выплатам", async () => {
    const { app, call } = await setup();
    const fresh = await app.inject({ method: "GET", url: "/users/ivan/public" });
    expect(fresh.json()).toMatchObject({ name: "Иван Петров", rating: null, acceptedStages: 0 });

    const id = (await call("anna", "POST", "/deals", {
      mode: "own", title: "Сайт", executorId: "ivan",
      stages: [{ title: "Дизайн", amount: 10_000 * R }, { title: "Вёрстка", amount: 20_000 * R }],
    })).body.id;
    await call("anna", "POST", `/deals/${id}/fund`, {});
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, {});
    await call("anna", "POST", `/deals/${id}/stages/s1/approve`);
    await call("ivan", "POST", `/deals/${id}/stages/s2/submit`, {});
    await call("anna", "POST", `/deals/${id}/stages/s2/approve`);

    const pub = (await app.inject({ method: "GET", url: "/users/ivan/public" })).json();
    expect(pub).toMatchObject({ acceptedStages: 2, failedStages: 0, dealsCompleted: 1, received: 30_000 * R });
    expect(pub.rating).toBe(5);
    expect((await app.inject({ method: "GET", url: "/users/nobody/public" })).statusCode).toBe(404);

    const rc = await call("ivan", "GET", "/receipts");
    expect(rc.body).toHaveLength(2);
    expect(rc.body[0]).toMatchObject({ amount: 20_000 * R, payer: "Анна Смирнова", executor: "Иван Петров" });
    expect(rc.body[0].service).toContain("Вёрстка");
    expect((await call("anna", "GET", "/receipts")).body).toHaveLength(0);
  });

  it("SSE: участник сделки получает уведомление, посторонний — нет", async () => {
    const { app, call } = await setup();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const tok = async (u: string) => (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: u } })).json().token as string;
    const reqs: http.ClientRequest[] = [];
    const listen = async (u: string) => {
      const chunks: string[] = [];
      const t = await tok(u);
      await new Promise<void>((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/events?token=${t}`, (res) => {
          res.setEncoding("utf8");
          res.on("data", (c: string) => { chunks.push(c); if (chunks.join("").includes(": connected")) resolve(); });
        });
        req.on("error", () => undefined);
        reqs.push(req);
      });
      return chunks;
    };
    const ivan = await listen("ivan");
    const olga = await listen("olga");
    const id = (await call("anna", "POST", "/deals", { mode: "own", title: "Сайт", executorId: "ivan", stages: [{ title: "Дизайн", amount: 10_000 * R }] })).body.id;
    await call("anna", "POST", `/deals/${id}/fund`, {});
    await new Promise((r) => setTimeout(r, 150));
    const got = ivan.join("");
    expect(got).toContain("event: notify");
    expect(got).toContain("зарезервировал");
    expect(olga.join("")).not.toContain("event: notify");
    expect((await app.inject({ method: "GET", url: "/events?token=bad.token" })).statusCode).toBe(401);
    reqs.forEach((r) => r.destroy());
    await app.close();
  });
});

