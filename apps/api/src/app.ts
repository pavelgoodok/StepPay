import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  EngineError,
  approveStage,
  cancelDeal,
  createDeal,
  freeBalance,
  fund,
  openDispute,
  replyDispute,
  rejectStage,
  reservedBalance,
  resolveDispute,
  submitStage,
  tick,
  updateTerms,
  proposeDeal,
  reopenDeal,
  topUp,
  voteStage,
  type Deal,
  type State,
} from "@steppay/engine";
import { createPlanner, type Planner } from "./ai";
import { makeToken, verifyToken } from "./auth";
import { Hub } from "./hub";
import { DEMO_DOC, DEMO_DOC_ID, DEMO_PHOTO, DEMO_PHOTO_ID } from "./demo-photo";
import { DEMO_SCRIPT, freshDemoPlatform, freshDemoState, prepareDemoStep, purgeDemo, seedUsers } from "./demo";
import { DEMO_USERS } from "./users";
import { executorStats, receiptsFor } from "./stats";
import { stageCounts, summary } from "./summary";
import type { Store } from "./store";
import { TEMPLATES, stagesFromTemplate } from "./templates";
import { demoDelivery, OtpService, type OtpDelivery } from "./otp";
import { Platform, PlatformError } from "./platform";
import { registerPlatformRoutes } from "./routes-platform";
import { Directory, maskPhone, normalizePhone } from "./users";

const RUB = 100;
const rub = (k: number) => `${String(Math.round(k / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0")}\u00a0₽`;

export interface AppOptions {
  store: Store;
  secret: string;
  now?: () => number;
  corsOrigin?: string;
  /** заполнить каталог проектов демо-данными при пустой базе */
  seedCatalog?: boolean;
  /** публичные демо-эндпоинты (сценарий для жюри и сброс данных); по умолчанию включены */
  demoMode?: boolean;
  /** способ доставки кода из SMS; по умолчанию демо (код показывается на экране) */
  otpDelivery?: OtpDelivery;
  /** телефоны администраторов платформы */
  adminPhones?: string[];
  /** подмена AI-планировщика (в тестах) */
  planner?: Planner;
}

const photoUrl = z.string().regex(/^\/uploads\/[\w-]{8,64}$/);
const money = z.number().int().positive().max(100_000_000 * RUB);

const createBody = z.object({
  mode: z.enum(["own", "crowdfunding", "grant"]),
  title: z.string().trim().min(1).max(120),
  /** own/grant: исполнитель; для краудфандинга игнорируется (автор - вы) */
  executorId: z.string().optional(),
  arbiterId: z.string().optional(),
  /** либо шаблон + общая сумма, либо явные этапы */
  templateId: z.string().optional(),
  total: money.optional(),
  stages: z
    .array(z.object({ title: z.string().trim().min(1), amount: money, criteria: z.array(z.string()).optional() }))
    .min(1)
    .optional(),
  autoAcceptDays: z.number().int().min(1).max(30).optional(),
});

/** Деньги - в копейках. Заказчик/грантодатель видит сделку целиком; чужие сделки доступны только участникам и в каталоге проектов. */
function involved(d: Deal, userId: string) {
  return d.executorId === userId || d.ownerId === userId || d.arbiterId === userId || (d.contributed[userId] ?? 0) > 0;
}

export async function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const origins = opts.corsOrigin?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];
  await app.register(cors, { origin: origins.length ? origins : true });
  const now = opts.now ?? Date.now;
  const planner = opts.planner ?? createPlanner();
  const hub = new Hub();
  const demoOn = opts.demoMode ?? true;
  const adminPhones = (opts.adminPhones ?? []).map((p) => normalizePhone(p)).filter((p): p is string => !!p);
  const dir = new Directory((users) => opts.store.saveUsers(users), await opts.store.loadUsers(), demoOn, adminPhones);
  const platform = new Platform(await opts.store.loadPlatform(), (d) => opts.store.savePlatform(d), now);
  const otp = new OtpService(opts.secret, opts.otpDelivery ?? demoDelivery, now);

  let state: State = await opts.store.load();
  if (state.ledger.length === 0 && Object.keys(state.deals).length === 0) {
    if (demoOn) {
      state = opts.seedCatalog ? freshDemoState(now()) : seedUsers(state, now());
      await opts.store.save(state);
    }
  }
  if (demoOn && opts.seedCatalog && platform.isEmpty()) await platform.reset(freshDemoPlatform(now()));
  if (!demoOn) {
    const cleaned = purgeDemo(state);
    if (cleaned.changed) {
      state = cleaned.state;
      await opts.store.save(state);
    }
    await platform.purgeDemo(new Set(DEMO_USERS.map((u) => u.id)), (id) => !state.deals[id]);
  }

  await opts.store.putFile(DEMO_PHOTO_ID, { mime: "image/jpeg", data: DEMO_PHOTO });
  await opts.store.putFile(DEMO_DOC_ID, { mime: "application/pdf", data: DEMO_DOC, private: true, ownerId: "games" });

  /** Все изменения последовательны: чтение-изменение-запись без гонок. */
  let queue: Promise<unknown> = Promise.resolve();
  function transact<T>(fn: (s: State) => { state: State; result: T }): Promise<T> {
    const run = queue.then(async () => {
      const out = fn(state);
      await opts.store.save(out.state);
      state = out.state;
      return out.result;
    });
    queue = run.catch(() => undefined);
    return run;
  }

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof EngineError || err instanceof PlatformError) return reply.code(400).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "Неверные данные", issues: err.issues });
    return reply.code(err.statusCode ?? 500).send({ error: err.statusCode ? err.message : "Внутренняя ошибка" });
  });

  const authed = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const h = req.headers.authorization;
    const id = verifyToken(opts.secret, h?.startsWith("Bearer ") ? h.slice(7) : undefined);
    if (!id || !dir.get(id)) {
      reply.code(401).send({ error: "Требуется вход" });
      return null;
    }
    return id;
  };

  const walletOf = (s: State, id: string) => ({ free: freeBalance(s, id), reserved: reservedBalance(s, id) });

  // ── публичное ──
  app.get("/health", async () => ({ ok: true }));
  app.get("/templates", async () => TEMPLATES);
  app.get("/auth/demo-users", async () => dir.demoUsers());
  app.post("/auth/demo", async (req, reply) => {
    const { userId } = z.object({ userId: z.string() }).parse(req.body);
    const u = dir.demoUsers().find((x) => x.id === userId);
    if (!u) return reply.code(404).send({ error: "Нет такого демо-пользователя" });
    return { token: makeToken(opts.secret, u.id), user: { id: u.id, name: u.name, role: u.role } };
  });

  // регистрация и вход по телефону: код приходит по SMS (в демо показывается на экране)
  app.post("/auth/otp/request", async (req, reply) => {
    const { phone: raw } = z.object({ phone: z.string().max(40) }).parse(req.body);
    const phone = normalizePhone(raw);
    if (!phone) return reply.code(400).send({ error: "Введите российский номер в формате +7 999 123-45-67" });
    try {
      const r = await otp.request(phone);
      return { phone, isNew: !dir.byPhone(phone), demoCode: r.demoCode, retryAfter: r.retryAfter };
    } catch (e) {
      return reply.code(429).send({ error: (e as Error).message });
    }
  });

  app.post("/auth/otp/verify", async (req, reply) => {
    const b = z.object({ phone: z.string().max(40), code: z.string().regex(/^\d{6}$/, "Код состоит из 6 цифр"), name: z.string().trim().min(2, "Укажите имя").max(60).optional() }).parse(req.body);
    const phone = normalizePhone(b.phone);
    if (!phone) return reply.code(400).send({ error: "Неверный номер телефона" });
    const existing = dir.byPhone(phone);
    if (!existing && !b.name) return reply.code(400).send({ error: "Укажите имя для регистрации" });
    let ok: boolean;
    try {
      ok = otp.verify(phone, b.code);
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    if (!ok) return reply.code(400).send({ error: "Неверный код" });
    const user = existing ?? (await dir.register(phone, b.name!, now()));
    return { token: makeToken(opts.secret, user.id), isNew: !existing, user: { id: user.id, name: user.name, role: "user" as const } };
  });

  // поиск исполнителя при создании сделки: точный номер или имя от 3 букв
  app.get("/users/search", async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    const { q } = z.object({ q: z.string().max(60) }).parse(req.query);
    return dir.search(q, me);
  });

  app.post("/me/profile", async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    const patch = z
      .object({ name: z.string().trim().min(2, "Имя от 2 символов").max(60).optional(), avatar: z.string().regex(/^\/uploads\/[\w-]{8,64}$/).nullable().optional() })
      .parse(req.body);
    if (patch.avatar) {
      const f = await opts.store.getFile(patch.avatar.slice("/uploads/".length));
      if (!f) return reply.code(400).send({ error: "Фото не найдено, загрузите его заново" });
    }
    if (!(await dir.updateProfile(me, patch))) return reply.code(400).send({ error: "Профиль демо-аккаунта изменить нельзя" });
    return { ok: true, name: dir.get(me)!.name, avatar: dir.get(me)!.avatar ?? null };
  });

  /** Краткие данные участника: имя и аватарка, чтобы клиенту не искать их самому. */
  const brief = (id: string) => {
    const a = dir.get(id);
    return { id, name: a?.name ?? "Участник", avatar: a?.avatar };
  };
  const sum = (d: Deal) => ({ ...summary(d), executor: brief(d.executorId), owner: d.ownerId ? brief(d.ownerId) : undefined });

  registerPlatformRoutes({ app, authed, dir, platform, hub, now, getState: () => state, transact, brief });

  // ── личное ──
  app.get("/me", async (req, reply) => {
    const id = authed(req, reply);
    if (!id) return;
    const u = dir.get(id)!;
    const phone = dir.phoneOf(id);
    return { user: { ...u, phone: phone ? maskPhone(phone) : undefined }, wallet: walletOf(state, id) };
  });

  app.get("/wallet", async (req, reply) => {
    const id = authed(req, reply);
    if (!id) return;
    const reserves = Object.values(state.deals)
      .filter((d) => (d.reserves[id] ?? 0) > 0)
      .map((d) => ({ dealId: d.id, title: d.title, amount: d.reserves[id]!, stages: stageCounts(d) }));
    return {
      ...walletOf(state, id),
      reserves,
      history: state.ledger.filter((l) => l.userId === id).reverse().slice(0, 100),
    };
  });

  app.post("/wallet/topup", async (req, reply) => {
    const id = authed(req, reply);
    if (!id) return;
    const { amount } = z.object({ amount: money }).parse(req.body);
    return transact((s) => {
      const next = topUp(s, id, amount, now());
      return { state: next, result: walletOf(next, id) };
    });
  });

  app.get("/deals", async (req, reply) => {
    const id = authed(req, reply);
    if (!id) return;
    return Object.values(state.deals).filter((d) => involved(d, id)).map(sum).reverse();
  });

  app.get("/deals/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const d = state.deals[id];
    if (!d) return reply.code(404).send({ error: "Сделка не найдена" });
    const ids = new Set<string>([d.executorId, ...(d.ownerId ? [d.ownerId] : []), ...(d.arbiterId ? [d.arbiterId] : []), ...Object.keys(d.contributed)]);
    for (const st of d.stages) {
      for (const u of Object.keys(st.votes)) ids.add(u);
      for (const m of st.messages ?? []) ids.add(m.by);
    }
    return { ...d, summary: sum(d), people: Object.fromEntries([...ids].map((x) => [x, brief(x)])) };
  });

  app.post("/deals", async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    const b = createBody.parse(req.body);
    const crowd = b.mode === "crowdfunding";
    const stages =
      b.stages ??
      (b.templateId && b.total ? stagesFromTemplate(b.templateId, b.total) : null);
    if (!stages) return reply.code(400).send({ error: "Укажите этапы или шаблон с суммой" });
    if (!crowd && !b.executorId) return reply.code(400).send({ error: "Укажите исполнителя" });
    if (b.executorId && !dir.get(b.executorId)) return reply.code(400).send({ error: "Исполнитель не найден" });
    const dealId = `d_${now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return transact((s) => {
      const next = createDeal(s, {
        id: dealId,
        mode: b.mode,
        title: b.title,
        executorId: crowd ? me : b.executorId!,
        ownerId: crowd ? undefined : me,
        arbiterId: b.arbiterId ?? (b.mode === "own" ? "expert" : undefined),
        stages,
        autoAcceptDays: b.autoAcceptDays,
        at: now(),
      });
      return { state: next, result: next.deals[dealId]! };
    });
  });

  // ── действия по сделке ──
  /** Кому и что сообщить после действия: остальным участникам сделки приходит уведомление, всем - сигнал обновиться. */
  const announce = (d: Deal, actor: string, kind: string, stageTitle: string, amount: number) => {
    const people = new Set([d.executorId, d.ownerId, d.arbiterId, ...Object.keys(d.contributed)].filter((x): x is string => !!x));
    const who = dir.get(actor)?.name ?? "Участник";
    const q = `«${stageTitle}»`;
    const text: Record<string, string> = {
      fund: `${who} зарезервировал(а) деньги по «${d.title}»`,
      submit: `${who} сдал(а) этап ${q} - проверьте`,
      approve: `Этап ${q} принят: ${rub(amount)} уже у исполнителя`,
      reject: d.mode === "grant" ? `Этап ${q} отклонен, остаток возвращен` : `Отказ по этапу ${q}: открыт спор`,
      vote: `${who} проголосовал(а) по этапу ${q}`,
      dispute: `Открыт спор по этапу ${q}`,
      reply: `${who} написал(а) в споре по этапу ${q}`,
      resolve: `Спор по этапу ${q} решен`,
      cancel: `Сделка «${d.title}» отменена, остаток возвращен`,
      propose: `${who} отправил(а) условия по «${d.title}», можно резервировать`,
      reopen: `${who} вернул(а) условия на правку: «${d.title}»`,
    };
    if (kind === "propose" || kind === "reopen") {
      if (d.meta?.chatId) void platform.post(d.meta.chatId, actor, kind === "propose" ? "Условия отправлены. Можно проверить этапы и зарезервировать деньги." : "Условия возвращены на правку.", "system", d.id);
    }
    if (kind === "terms") {
      hub.send(people, "changed", { dealId: d.id });
      return;
    }
    const others = [...people].filter((p) => p !== actor && (kind !== "reply" && kind !== "dispute" ? p !== d.arbiterId : true));
    hub.send(others, "notify", { dealId: d.id, text: text[kind] ?? "Сделка обновлена" });
    hub.send(people, "changed", { dealId: d.id });
  };

  const act = <B extends z.ZodTypeAny>(
    path: string,
    body: B,
    fn: (s: State, p: { id: string; stageId: string }, me: string, b: z.infer<B>) => State,
    kind = "update",
  ) =>
    app.post(path, async (req, reply) => {
      const me = authed(req, reply);
      if (!me) return;
      const params = z.object({ id: z.string(), stageId: z.string().default("") }).parse(req.params);
      const b = body.parse(req.body ?? {});
      const out = await transact((s) => {
        const next = fn(s, params, me, b);
        return { state: next, result: { deal: next.deals[params.id]!, wallet: walletOf(next, me) } };
      });
      const stage = out.deal.stages.find((x) => x.id === params.stageId);
      announce(out.deal, me, kind, stage?.title ?? "", stage?.amount ?? 0);
      return out;
    });

  const none = z.object({}).passthrough();
  act("/deals/:id/fund", z.object({ amount: money.optional() }), (s, p, me, b) => {
    const d = s.deals[p.id];
    if (!d) throw new EngineError("Сделка не найдена");
    return fund(s, p.id, me, b.amount ?? d.target, now());
  }, "fund");
  act(
    "/deals/:id/terms",
    z.object({
      title: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(2000).optional(),
      stages: z.array(z.object({ title: z.string().trim().min(1).max(120), amount: money, criteria: z.array(z.string().trim().max(200)).max(6).optional() })).max(8).optional(),
    }),
    (s, p, me, b) => updateTerms(s, p.id, me, b),
    "terms",
  );
  act("/deals/:id/propose", none, (s, p, me) => proposeDeal(s, p.id, me), "propose");
  act("/deals/:id/reopen", none, (s, p, me) => reopenDeal(s, p.id, me), "reopen");
  act("/deals/:id/cancel", none, (s, p, me) => cancelDeal(s, p.id, me, now()), "cancel");
  act(
    "/deals/:id/stages/:stageId/submit",
    z.object({ note: z.string().max(2000).optional(), photos: z.array(photoUrl).max(6).optional() }),
    (s, p, me, b) => submitStage(s, p.id, p.stageId, me, b, now()),
    "submit",
  );
  act("/deals/:id/stages/:stageId/approve", none, (s, p, me) => approveStage(s, p.id, p.stageId, me, now()), "approve");
  act("/deals/:id/stages/:stageId/reject", z.object({ reason: z.string() }), (s, p, me, b) =>
    rejectStage(s, p.id, p.stageId, me, b.reason, now()),
    "reject",
  );
  act("/deals/:id/stages/:stageId/vote", z.object({ vote: z.enum(["accept", "reject"]) }), (s, p, me, b) =>
    voteStage(s, p.id, p.stageId, me, b.vote, now()),
    "vote",
  );
  act("/deals/:id/stages/:stageId/dispute", z.object({ reason: z.string() }), (s, p, me, b) =>
    openDispute(s, p.id, p.stageId, me, b.reason, now()),
    "dispute",
  );
  act("/deals/:id/stages/:stageId/reply", z.object({ text: z.string().max(2000).default(""), photos: z.array(photoUrl).max(6).default([]) }), (s, p, me, b) =>
    replyDispute(s, p.id, p.stageId, me, b.text, b.photos, now()),
    "reply",
  );
  act(
    "/deals/:id/stages/:stageId/resolve",
    z.object({ decision: z.enum(["pay", "refund"]), comment: z.string().max(2000).optional() }),
    (s, p, me, b) => resolveDispute(s, p.id, p.stageId, me, b.decision, now(), b.comment),
    "resolve",
  );

  // демо для жюри: без входа, действует только на демо-пользователях и демо-сделках
  if (opts.demoMode ?? true) {
    const everyone = { [Symbol.iterator]: () => dir.allIds()[Symbol.iterator]() };
    let lastReset = 0;
    app.get("/demo/script", async () => DEMO_SCRIPT);
    app.post("/demo/reset", async (_req, reply) => {
      if (Date.now() - lastReset < 2000) return reply.code(429).send({ error: "Подождите пару секунд" });
      lastReset = Date.now();
      await transact(() => ({ state: freshDemoState(now()), result: true }));
      await platform.reset(freshDemoPlatform(now()));
      hub.send(everyone, "changed", {});
      return { ok: true };
    });
    app.post("/demo/step", async (req) => {
      const { step } = z.object({ step: z.number().int().min(1).max(DEMO_SCRIPT.length) }).parse(req.body);
      const prep = await prepareDemoStep(platform, step, now());
      const narration = await transact((s) => ({ state: prep.apply(s), result: prep.narration }));
      await prep.after?.();
      hub.send(everyone, "changed", {});
      hub.send([narration.viewAs], "notify", { dealId: "", text: narration.title });
      return { step, total: DEMO_SCRIPT.length, ...narration };
    });
  }

  // Настроен ли Claude на сервере (ключ не показывается)
  app.get("/ai/status", async (req, reply) => {
    if (!authed(req, reply)) return;
    return planner.status();
  });

  // AI-помощник: описание работы -> этапы с долями и критериями приемки
  const lastAi = new Map<string, number[]>();
  app.post("/ai/plan", async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    const b = z.object({ description: z.string().trim().min(5).max(1500), mode: z.enum(["own", "crowdfunding", "grant"]).default("own"), total: money.optional() }).parse(req.body);
    const recent = (lastAi.get(me) ?? []).filter((t) => Date.now() - t < 60_000);
    if (recent.length >= 8) return reply.code(429).send({ error: "Слишком много запросов, подождите минуту" });
    lastAi.set(me, [...recent, Date.now()]);
    return planner.plan(b);
  });

  // личная статистика исполнителя: видна только самому пользователю
  app.get("/me/stats", async (req, reply) => {
    const id = authed(req, reply);
    if (!id) return;
    return executorStats(state, id);
  });

  app.get("/receipts", async (req, reply) => {
    const id = authed(req, reply);
    if (!id) return;
    return receiptsFor(state, id).map((r) => ({ ...r, payer: r.payerId ? dir.get(r.payerId)?.name ?? null : null, executor: dir.get(id)!.name }));
  });

  // события в реальном времени (SSE). Токен в query: EventSource не умеет заголовки.
  app.get("/events", async (req, reply) => {
    const { token } = z.object({ token: z.string() }).parse(req.query);
    const id = verifyToken(opts.secret, token);
    if (!id || !dir.get(id)) return reply.code(401).send({ error: "Требуется вход" });
    reply.hijack();
    const reqOrigin = req.headers.origin;
    const origin = !origins.length ? (reqOrigin ?? "*") : reqOrigin && origins.includes(reqOrigin) ? reqOrigin : origins[0]!;
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "access-control-allow-origin": origin,
    });
    reply.raw.write("retry: 3000\n: connected\n\n");
    hub.add(id, reply.raw);
  });

  // файлы: клиент присылает data URL. Фото публичные по ссылке, документы проектов закрытые
  app.post("/uploads", { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    const { dataUrl, private: isPrivate } = z.object({ dataUrl: z.string(), private: z.boolean().optional() }).parse(req.body);
    const m = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return reply.code(400).send({ error: "Подходят JPEG, PNG, WebP и PDF" });
    const data = Buffer.from(m[2]!, "base64");
    const pdf = m[1] === "application/pdf";
    if (pdf && !isPrivate) return reply.code(400).send({ error: "PDF можно загружать только как документ" });
    if (data.length > (pdf ? 5 * 1024 * 1024 : 900 * 1024)) return reply.code(413).send({ error: pdf ? "Файл больше 5 МБ" : "Фото слишком большое" });
    const id = randomUUID();
    await opts.store.putFile(id, { mime: m[1]!, data, private: !!isPrivate, ownerId: me });
    return { url: `/uploads/${id}` };
  });
  app.get("/uploads/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().regex(/^[\w-]{8,64}$/) }).parse(req.params);
    const f = await opts.store.getFile(id);
    if (!f) return reply.code(404).send({ error: "Файл не найден" });
    if (f.private) {
      const { token } = z.object({ token: z.string().optional() }).parse(req.query);
      const h = req.headers.authorization;
      const who = verifyToken(opts.secret, token ?? (h?.startsWith("Bearer ") ? h.slice(7) : undefined));
      if (!who || !dir.get(who)) return reply.code(401).send({ error: "Требуется вход" });
      if (who !== f.ownerId && !dir.isAdmin(who)) return reply.code(403).send({ error: "Документ доступен только автору и администраторам" });
      return reply.header("content-type", f.mime).header("cache-control", "private, no-store").header("content-disposition", "inline").header("cross-origin-resource-policy", "cross-origin").send(f.data);
    }
    return reply
      .header("content-type", f.mime)
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("cross-origin-resource-policy", "cross-origin")
      .send(f.data);
  });

  // часы автоприемки: вызывается по таймеру сервера, а также вручную для демо
  const runTick = async () => {
    const before = state;
    await transact((s) => ({ state: tick(s, now()), result: true }));
    for (const d of Object.values(state.deals)) {
      d.stages.forEach((st, i) => {
        if (before.deals[d.id]?.stages[i]?.status === "submitted" && st.status === "accepted") announce(d, "", "approve", st.title, st.amount);
      });
    }
  };
  app.post("/system/tick", async (req, reply) => {
    if (!authed(req, reply)) return;
    await runTick();
    return { ok: true };
  });

  const timer = setInterval(() => void runTick().catch(() => undefined), 60_000);
  const beat = setInterval(() => hub.heartbeat(), 25_000);
  timer.unref();
  beat.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    clearInterval(beat);
    hub.closeAll();
  });

  return app;
}
