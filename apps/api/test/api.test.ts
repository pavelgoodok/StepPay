import { beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { cleanKey, normalizePlan, templatePlan, createPlanner } from "../src/ai";
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
    const body = r.json();
    // исполнитель сразу подписывает контракт новой сделки: подписи сторон проверяются в отдельных тестах
    if (method === "POST" && url === "/deals" && r.statusCode === 200 && body.executorId && tokens[body.executorId]) {
      await app.inject({ method: "POST", url: `/deals/${body.id}/sign`, payload: {}, headers: { authorization: `Bearer ${tokens[body.executorId]}` } });
    }
    return { status: r.statusCode, body };
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

  it("демо-сценарий: ремонт по шаблону, резерв, приемка, выплата", async () => {
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

  it("автоприемка срабатывает через /system/tick спустя 3 дня", async () => {
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

  it("сроки по умолчанию: исполнитель пропал - через 30 дней остаток возвращается заказчику", async () => {
    const { call } = await setup();
    const id = (await call("anna", "POST", "/deals", {
      mode: "own", title: "Сайт", executorId: "ivan", stages: [{ title: "Дизайн", amount: 10_000 * R }],
    })).body.id;
    await call("anna", "POST", `/deals/${id}/fund`, {});
    const before = (await call("anna", "GET", "/me")).body.wallet.free;
    t += 29 * DAY;
    await call("anna", "POST", "/system/tick");
    expect((await call("anna", "GET", `/deals/${id}`)).body.status).toBe("active");
    t += 2 * DAY;
    await call("anna", "POST", "/system/tick");
    const d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.status).toBe("cancelled");
    expect(d.stages[0].resolution.by).toBe("expired");
    expect((await call("anna", "GET", "/me")).body.wallet.free).toBe(before + 10_000 * R);
  });

  it("краудфандинг: каталог, взносы, голосование", async () => {
    const { call } = await setup();
    const id = (await call("ivan", "POST", "/deals", {
      mode: "crowdfunding", title: "Настолка",
      stages: [{ title: "Макет", amount: 100_000 * R }, { title: "Тираж", amount: 100_000 * R }],
    })).body.id;
    await call("olga", "POST", `/deals/${id}/fund`, { amount: 100_000 * R });
    expect((await call("olga", "GET", `/deals/${id}`)).body).toMatchObject({ status: "funding" });
    await call("max", "POST", `/deals/${id}/fund`, { amount: 100_000 * R });
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, {});
    await call("olga", "POST", `/deals/${id}/stages/s1/vote`, { vote: "accept" });
    await call("max", "POST", `/deals/${id}/stages/s1/vote`, { vote: "accept" });
    expect((await call("ivan", "GET", "/me")).body.wallet.free).toBe(100_000 * R);
  });

  it("грант: фонд отклоняет этап - остаток возвращается", async () => {
    const { call } = await setup();
    const id = (await call("fond", "POST", "/deals", {
      mode: "grant", title: "Культура районов", executorId: "ivan", stages: [{ title: "Закупка", amount: 50_000 * R }],
    })).body.id;
    await call("fond", "POST", `/deals/${id}/fund`, {});
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, {});
    const bad = await call("fond", "POST", `/deals/${id}/stages/s1/reject`, { reason: "" });
    expect(bad.status).toBe(400);
    await call("fond", "POST", `/deals/${id}/stages/s1/reject`, { reason: "Нет отчета" });
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
    const generic = templatePlan({ description: "Сделать что-то неопределенное", mode: "own" });
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
    const planner = { status: () => ({ configured: true, models: ["m"] }), plan: async (i: unknown) => (calls.push(i), { title: "Т", stages: [{ title: "А", share: 100, criteria: [] }], source: "claude" as const }) };
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
  it("статистика и рейтинг считаются по закрытым этапам и закрыты от посторонних; чеки по выплатам", async () => {
    const { app, call } = await setup();
    expect((await call("ivan", "GET", "/me/stats")).body).toMatchObject({ rating: null, reviews: 0, acceptedStages: 0 });
    expect((await app.inject({ method: "GET", url: "/me/stats" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/users/ivan/public" })).statusCode).toBe(404); // публичной карточки нет

    const id = (await call("anna", "POST", "/deals", {
      mode: "own", title: "Сайт", executorId: "ivan",
      stages: [{ title: "Дизайн", amount: 10_000 * R }, { title: "Верстка", amount: 20_000 * R }],
    })).body.id;
    await call("anna", "POST", `/deals/${id}/fund`, {});
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, {});
    await call("anna", "POST", `/deals/${id}/stages/s1/approve`);
    await call("ivan", "POST", `/deals/${id}/stages/s2/submit`, {});
    await call("anna", "POST", `/deals/${id}/stages/s2/approve`);

    const pub = (await call("ivan", "GET", "/me/stats")).body;
    expect(pub).toMatchObject({ acceptedStages: 2, failedStages: 0, dealsCompleted: 1, received: 30_000 * R });
    expect(pub.rating).toBeNull(); // рейтинг считается только по отзывам

    const rc = await call("ivan", "GET", "/receipts");
    expect(rc.body).toHaveLength(2);
    expect(rc.body[0]).toMatchObject({ amount: 20_000 * R, payer: "Анна Смирнова", executor: "Иван Петров" });
    expect(rc.body[0].service).toContain("Верстка");
    expect((await call("anna", "GET", "/receipts")).body).toHaveLength(0);
  });

  it("SSE: участник сделки получает уведомление, посторонний - нет", async () => {
    const { app, call } = await setup();
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const tok = async (u: string) => (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: u } })).json().token as string;
    const reqs: http.ClientRequest[] = [];
    const listen = async (u: string) => {
      const chunks: string[] = [];
      const bearer = await tok(u);
      const t = (await app.inject({ method: "POST", url: "/auth/ticket", headers: { authorization: `Bearer ${bearer}` } })).json().ticket as string;
      await new Promise<void>((resolve) => {
        const req = http.get(`http://127.0.0.1:${port}/events?ticket=${t}`, (res) => {
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
    expect((await app.inject({ method: "GET", url: "/events?ticket=bad.ticket" })).statusCode).toBe(401);
    reqs.forEach((r) => r.destroy());
    await app.close();
  });
});

describe("демо для жюри", () => {
  it("сценарий проигрывается целиком, деньги сходятся, фото доступно", async () => {
    const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => t });
    const post = (url: string, payload?: object) => app.inject({ method: "POST", url, payload });
    const bal = async (u: string) => {
      const tok = (await post("/auth/demo", { userId: u })).json().token;
      return (await app.inject({ method: "GET", url: "/wallet", headers: { authorization: `Bearer ${tok}` } })).json();
    };
    const tokOf = async (u: string) => (await post("/auth/demo", { userId: u })).json().token as string;
    const get = async (u: string, url: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${await tokOf(u)}` } });
    expect((await app.inject({ method: "GET", url: "/demo/script" })).json()).toHaveLength(11);
    expect((await post("/demo/reset")).statusCode).toBe(200);
    const proj = (await get("anna", "/projects")).json();
    expect(proj.map((p: { title: string }) => p.title)).toContain("Детская площадка во дворе");
    expect((await get("anna", "/projects?kind=grant")).json().length).toBeGreaterThanOrEqual(1);
    expect((await get("anna", "/services")).json().length).toBeGreaterThanOrEqual(3);

    expect((await post("/demo/step", { step: 3 })).statusCode).toBe(400); // нельзя пропускать шаги
    const steps: Record<string, unknown>[] = [];
    for (let i = 1; i <= 11; i++) {
      const r = await post("/demo/step", { step: i });
      expect(r.statusCode, `шаг ${i}: ${r.body}`).toBe(200);
      steps.push(r.json());
      if (i === 2) expect((await get("ivan", "/deals/demo-own")).json().status).toBe("draft");
      if (i === 6) expect((await bal("ivan")).free).toBe(120_000 * R);
      if (i === 8) expect((await get("admin", "/admin/summary")).json().review).toBe(1);
    }
    expect(steps[5]).toMatchObject({ viewAs: "ivan", path: "/wallet" });
    expect((await bal("games")).free).toBe(100_000 * R);
    expect((await bal("anna")).reserved).toBe(180_000 * R);
    const olga = await bal("olga"), max = await bal("max");
    expect(olga.free).toBe(540_000 * R);
    expect(max.free).toBe(540_000 * R);
    const photo = await app.inject({ method: "GET", url: "/uploads/demo-tile-photo-0001" });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers["content-type"]).toBe("image/jpeg");
    // повторный сброс возвращает чистое состояние
    await new Promise((r) => setTimeout(r, 2100));
    await post("/demo/reset");
    expect((await bal("ivan")).free).toBe(0);
    expect((await bal("olga")).free).toBe(590_000 * R);
  }, 15000);

  it("в продакшене демо можно отключить", async () => {
    const app = await buildApp({ store: new MemoryStore(), secret: "s", demoMode: false });
    expect((await app.inject({ method: "POST", url: "/demo/reset" })).statusCode).toBe(404);
  });
});

describe("регистрация и вход по телефону", () => {
  const mk = async (over: Parameters<typeof buildApp>[0] extends infer O ? Partial<O> : never = {}) =>
    buildApp({ store: new MemoryStore(), secret: "s", now: () => t, ...over });
  const post = (app: Awaited<ReturnType<typeof mk>>, url: string, payload: object, token?: string) =>
    app.inject({ method: "POST", url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it("новый пользователь: код, имя, вход; повторный вход дает тот же аккаунт", async () => {
    const app = await mk();
    expect((await post(app, "/auth/otp/request", { phone: "12345" })).statusCode).toBe(400);
    const r1 = (await post(app, "/auth/otp/request", { phone: "8 (999) 123-45-67" })).json();
    expect(r1).toMatchObject({ phone: "+79991234567", isNew: true });
    expect(r1.demoCode).toMatch(/^\d{6}$/);

    // без имени нельзя, и код при этом не сгорает
    expect((await post(app, "/auth/otp/verify", { phone: "+79991234567", code: r1.demoCode })).statusCode).toBe(400);
    const wrong = await post(app, "/auth/otp/verify", { phone: "+79991234567", code: r1.demoCode === "000000" ? "111111" : "000000", name: "Петр" });
    expect(wrong.statusCode).toBe(400);
    const ok = (await post(app, "/auth/otp/verify", { phone: "+79991234567", code: r1.demoCode, name: "Петр Сидоров" })).json();
    expect(ok).toMatchObject({ isNew: true, user: { name: "Петр Сидоров", role: "user" } });
    // код одноразовый
    expect((await post(app, "/auth/otp/verify", { phone: "+79991234567", code: r1.demoCode, name: "Петр" })).statusCode).toBe(400);

    const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${ok.token}` } });
    expect(me.json().user.phone).toBe("+7 999 ***-**-67");
    expect(me.json().wallet).toEqual({ free: 0, reserved: 0 });

    t += 31_000; // повторный запрос кода разрешен через 30 секунд
    const r2 = (await post(app, "/auth/otp/request", { phone: "+7 999 123 45 67" })).json();
    expect(r2.isNew).toBe(false);
    const again = (await post(app, "/auth/otp/verify", { phone: "+79991234567", code: r2.demoCode })).json();
    expect(again).toMatchObject({ isNew: false, user: { id: ok.user.id } });
  });

  it("лимиты: частые запросы, пять неверных попыток, срок жизни кода", async () => {
    const app = await mk();
    const first = (await post(app, "/auth/otp/request", { phone: "+79990000001" })).json();
    expect((await post(app, "/auth/otp/request", { phone: "+79990000001" })).statusCode).toBe(429);
    const bad = first.demoCode === "999999" ? "888888" : "999999";
    for (let i = 0; i < 5; i++) expect((await post(app, "/auth/otp/verify", { phone: "+79990000001", code: bad, name: "Анна" })).statusCode).toBe(400);
    const blocked = await post(app, "/auth/otp/verify", { phone: "+79990000001", code: first.demoCode, name: "Анна" });
    expect(blocked.json().error).toContain("попыток");

    t += 31_000;
    const fresh = (await post(app, "/auth/otp/request", { phone: "+79990000001" })).json();
    t += 6 * 60_000; // код живет 5 минут
    const late = await post(app, "/auth/otp/verify", { phone: "+79990000001", code: fresh.demoCode, name: "Анна" });
    expect(late.json().error).toContain("устарел");
  });

  it("настоящая доставка: код не показывается в ответе, а уходит провайдеру", async () => {
    const sent: [string, string][] = [];
    const app = await mk({ otpDelivery: { showsCode: false, send: async (p, c) => void sent.push([p, c]) } });
    const r = (await post(app, "/auth/otp/request", { phone: "+79990000002" })).json();
    expect(r.demoCode).toBeNull();
    expect(sent).toHaveLength(1);
    expect((await post(app, "/auth/otp/verify", { phone: "+79990000002", code: sent[0]![1], name: "Олег" })).statusCode).toBe(200);
  });

  it("зарегистрированный пользователь ищется, становится исполнителем и получает деньги", async () => {
    const app = await mk();
    const reg = async (phone: string, name: string) => {
      const r = (await post(app, "/auth/otp/request", { phone })).json();
      return (await post(app, "/auth/otp/verify", { phone, code: r.demoCode, name })).json();
    };
    const master = await reg("+79990000003", "Сергей Мастеров");
    const anna = (await post(app, "/auth/demo", { userId: "anna" })).json();
    const h = { authorization: `Bearer ${anna.token}` };

    const byPhone = (await app.inject({ method: "GET", url: "/users/search?q=" + encodeURIComponent("8 999 000 00 03"), headers: h })).json();
    expect(byPhone).toEqual([{ id: master.user.id, name: "Сергей Мастеров", phone: "+7 999 ***-**-03" }]);
    expect((await app.inject({ method: "GET", url: "/users/search?q=Ма", headers: h })).json()).toEqual([]); // слишком коротко
    expect((await app.inject({ method: "GET", url: "/users/search?q=" + encodeURIComponent("Мастер"), headers: h })).json()).toHaveLength(1);

    const deal = (await app.inject({ method: "POST", url: "/deals", headers: h, payload: { mode: "own", title: "Кран", executorId: master.user.id, stages: [{ title: "Замена", amount: 5_000 * R }] } })).json();
    const mh = { authorization: `Bearer ${master.token}` };
    await app.inject({ method: "POST", url: `/deals/${deal.id}/sign`, headers: mh, payload: {} });
    await app.inject({ method: "POST", url: `/deals/${deal.id}/fund`, headers: h, payload: {} });
    await app.inject({ method: "POST", url: `/deals/${deal.id}/stages/s1/submit`, headers: mh, payload: {} });
    await app.inject({ method: "POST", url: `/deals/${deal.id}/stages/s1/approve`, headers: h, payload: {} });
    const me = (await app.inject({ method: "GET", url: "/me", headers: mh })).json();
    expect(me.wallet.free).toBe(5_000 * R);
    expect((await app.inject({ method: "GET", url: "/me/stats", headers: mh })).json()).toMatchObject({ acceptedStages: 1 });
  });

  it("пользователи переживают перезапуск; демо-вход отключается вместе с демо-режимом", async () => {
    const store = new MemoryStore();
    const a1 = await buildApp({ store, secret: "s", now: () => t });
    const r = (await post(a1, "/auth/otp/request", { phone: "+79990000004" })).json();
    const u = (await post(a1, "/auth/otp/verify", { phone: "+79990000004", code: r.demoCode, name: "Мария" })).json();
    const a2 = await buildApp({ store, secret: "s", now: () => t, demoMode: false });
    expect((await a2.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${u.token}` } })).statusCode).toBe(200);
    expect((await post(a2, "/auth/demo", { userId: "anna" })).statusCode).toBe(404);
    expect((await a2.inject({ method: "GET", url: "/auth/demo-users" })).json()).toEqual([]);
    const demoToken = (await post(a1, "/auth/demo", { userId: "anna" })).json().token;
    expect((await a2.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${demoToken}` } })).statusCode).toBe(401);
    // приемщик споров доступен всегда: на нем держится механизм споров
    const ex = (await post(a2, "/deals", { mode: "own", title: "X", executorId: u.user.id, stages: [{ title: "A", amount: 100 }] }, u.token));
    expect(ex.statusCode).toBe(400); // нельзя быть исполнителем самому себе
  });
});

describe("выключенный демо-режим", () => {
  it("старые демо-данные в базе вычищаются, настоящие пользователи и их сделки остаются", async () => {
    const store = new MemoryStore();
    const demo = await buildApp({ store, secret: "s", now: () => t, seedCatalog: true });
    await demo.inject({ method: "POST", url: "/demo/reset" });
    // настоящий пользователь и настоящая сделка с другим настоящим пользователем
    const reg = async (phone: string, name: string) => {
      const r = (await demo.inject({ method: "POST", url: "/auth/otp/request", payload: { phone } })).json();
      return (await demo.inject({ method: "POST", url: "/auth/otp/verify", payload: { phone, code: r.demoCode, name } })).json();
    };
    const a = await reg("+79990000010", "Заказчик"), b = await reg("+79990000011", "Исполнитель");
    await demo.inject({ method: "POST", url: "/wallet/topup", headers: { authorization: `Bearer ${a.token}` }, payload: { amount: 10_000 * R } });
    const real = (await demo.inject({ method: "POST", url: "/deals", headers: { authorization: `Bearer ${a.token}` }, payload: { mode: "own", title: "Настоящая", executorId: b.user.id, stages: [{ title: "Шаг", amount: 1_000 * R }] } })).json();
    await demo.inject({ method: "POST", url: `/deals/${real.id}/fund`, headers: { authorization: `Bearer ${a.token}` }, payload: {} });

    const prod = await buildApp({ store, secret: "s", now: () => t, demoMode: false });
    const list = (await prod.inject({ method: "GET", url: "/projects", headers: { authorization: `Bearer ${a.token}` } })).json();
    expect(list).toEqual([]); // демо-каталог исчез
    const mine = (await prod.inject({ method: "GET", url: "/deals", headers: { authorization: `Bearer ${a.token}` } })).json();
    expect(mine.map((d: { title: string }) => d.title)).toEqual(["Настоящая"]);
    const w = (await prod.inject({ method: "GET", url: "/wallet", headers: { authorization: `Bearer ${a.token}` } })).json();
    expect(w.free + w.reserved).toBe(10_000 * R); // деньги настоящего пользователя целы
  });
});

describe("настройки профиля", () => {
  it("имя меняется; слишком короткое отвергается; демо-аккаунт изменить нельзя", async () => {
    const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => t });
    const r = (await app.inject({ method: "POST", url: "/auth/otp/request", payload: { phone: "+79990000020" } })).json();
    const u = (await app.inject({ method: "POST", url: "/auth/otp/verify", payload: { phone: "+79990000020", code: r.demoCode, name: "Старое имя" } })).json();
    const h = { authorization: `Bearer ${u.token}` };
    expect((await app.inject({ method: "POST", url: "/me/profile", headers: h, payload: { name: "Новое имя" } })).json()).toMatchObject({ ok: true, name: "Новое имя" });
    expect((await app.inject({ method: "GET", url: "/me", headers: h })).json().user).toMatchObject({ name: "Новое имя" });
    expect((await app.inject({ method: "POST", url: "/me/profile", headers: h, payload: { name: "А" } })).statusCode).toBe(400);
    const demo = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: "anna" } })).json();
    expect((await app.inject({ method: "POST", url: "/me/profile", headers: { authorization: `Bearer ${demo.token}` }, payload: { name: "Взлом" } })).statusCode).toBe(400);
  });
});

describe("аватарки и данные участников", () => {
  it("аватарка ставится и снимается, видна в сделках; чужой и несуществующий файл не принимаются", async () => {
    const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => t });
    const reg = async (phone: string, name: string) => {
      const r = (await app.inject({ method: "POST", url: "/auth/otp/request", payload: { phone } })).json();
      return (await app.inject({ method: "POST", url: "/auth/otp/verify", payload: { phone, code: r.demoCode, name } })).json();
    };
    const a = await reg("+79990000030", "Заказчик Один"), b = await reg("+79990000031", "Исполнитель Два");
    const ha = { authorization: `Bearer ${a.token}` }, hb = { authorization: `Bearer ${b.token}` };
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const up = (await app.inject({ method: "POST", url: "/uploads", headers: hb, payload: { dataUrl: png } })).json();

    expect((await app.inject({ method: "POST", url: "/me/profile", headers: hb, payload: { avatar: "/uploads/net-takogo-fayla" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/me/profile", headers: hb, payload: { avatar: "https://evil.example/x.png" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/me/profile", headers: hb, payload: { avatar: up.url } })).json()).toMatchObject({ ok: true, avatar: up.url });
    expect((await app.inject({ method: "GET", url: "/me", headers: hb })).json().user.avatar).toBe(up.url);

    const deal = (await app.inject({ method: "POST", url: "/deals", headers: ha, payload: { mode: "own", title: "Кран", executorId: b.user.id, stages: [{ title: "Замена", amount: 5_000 * R }] } })).json();
    const list = (await app.inject({ method: "GET", url: "/deals", headers: ha })).json();
    expect(list[0].executor).toMatchObject({ id: b.user.id, name: "Исполнитель Два", avatar: up.url });
    expect(list[0].owner).toMatchObject({ name: "Заказчик Один" });
    const full = (await app.inject({ method: "GET", url: `/deals/${deal.id}`, headers: ha })).json();
    expect(full.people[b.user.id].avatar).toBe(up.url);
    expect(full.people[a.user.id].name).toBe("Заказчик Один");

    await app.inject({ method: "POST", url: "/me/profile", headers: hb, payload: { avatar: null } });
    expect((await app.inject({ method: "GET", url: "/me", headers: hb })).json().user.avatar).toBeUndefined();
  });
});

describe("Claude-планировщик: причины отказа и запасные модели", () => {
  const apiErr = (status: number, message: string) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message } }, message, new Headers());
  const okReply = { stop_reason: "end_turn", parsed_output: { title: "Баня", stages: [{ title: "Фундамент", share: 60, criteria: ["Залит"] }, { title: "Стены", share: 40, criteria: [] }] } };
  const fake = (impl: (model: string) => unknown) => {
    const tried: string[] = [];
    return { tried, client: { messages: { parse: async (a: { model: string }) => { tried.push(a.model); return impl(a.model); } } } as never };
  };
  const input = { description: "Построить баню", mode: "own" as const };

  it("успешный ответ: источник claude, указана модель", async () => {
    const f = fake(() => okReply);
    const plan = await createPlanner("sk-ant-x", f.client).plan(input);
    expect(plan).toMatchObject({ source: "claude", model: "claude-opus-5-5", title: "Баня" });
    expect(plan.stages.reduce((a, x) => a + x.share, 0)).toBe(100);
  });

  it("нет такой модели у ключа: пробуем следующую", async () => {
    const f = fake((m) => { if (m === "claude-opus-5-5") throw apiErr(404, "model: claude-opus-5-5"); return okReply; });
    const plan = await createPlanner("sk-ant-x", f.client).plan(input);
    expect(f.tried).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    expect(plan).toMatchObject({ source: "claude", model: "claude-sonnet-5-5" });
  });

  it("неверный ключ: шаблон с понятной причиной, лишние модели не перебираются", async () => {
    const f = fake(() => { throw apiErr(401, "invalid x-api-key"); });
    const plan = await createPlanner("sk-ant-bad", f.client).plan(input);
    expect(f.tried).toHaveLength(1);
    expect(plan).toMatchObject({ source: "template", reason: { code: "invalid_key" } });
  });

  it("нет денег на счете: причина про баланс", async () => {
    const f = fake(() => { throw apiErr(400, "Your credit balance is too low to access the Anthropic API"); });
    const plan = await createPlanner("sk-ant-x", f.client).plan(input);
    expect(f.tried).toHaveLength(1);
    expect(plan.reason?.code).toBe("no_credit");
  });

  it("оборванный ответ и отказ модели не ломают создание сделки", async () => {
    expect((await createPlanner("k", fake(() => ({ stop_reason: "max_tokens", parsed_output: null })).client).plan(input)).reason?.code).toBe("truncated");
    expect((await createPlanner("k", fake(() => ({ stop_reason: "refusal", parsed_output: null })).client).plan(input)).reason?.code).toBe("refused");
    expect((await createPlanner("k", fake(() => ({ stop_reason: "end_turn", parsed_output: null })).client).plan(input)).reason?.code).toBe("bad_output");
  });

  it("без ключа: причина no_key, статус не настроен; ключ очищается от кавычек и пробелов", async () => {
    const p = createPlanner("");
    expect(p.status().configured).toBe(false);
    expect((await p.plan(input)).reason?.code).toBe("no_key");
    expect(cleanKey(' "sk-ant-abc"\n')).toBe("sk-ant-abc");
    expect(createPlanner("  ").status().configured).toBe(false);
  });
});

