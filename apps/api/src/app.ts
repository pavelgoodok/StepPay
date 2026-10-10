import cors from "@fastify/cors";
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
  rejectStage,
  reservedBalance,
  resolveDispute,
  submitStage,
  tick,
  topUp,
  voteStage,
  type Deal,
  type State,
} from "@steppay/engine";
import { makeToken, verifyToken } from "./auth";
import type { Store } from "./store";
import { TEMPLATES, stagesFromTemplate } from "./templates";
import { DEMO_USERS, userById } from "./users";

const RUB = 100;

export interface AppOptions {
  store: Store;
  secret: string;
  now?: () => number;
  corsOrigin?: string;
}

const money = z.number().int().positive().max(100_000_000 * RUB);

const createBody = z.object({
  mode: z.enum(["own", "crowdfunding", "grant"]),
  title: z.string().trim().min(1).max(120),
  /** own/grant: исполнитель; для краудфандинга игнорируется (автор — вы) */
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

/** Деньги — в копейках. Заказчик/грантодатель видит сделку целиком; чужие сделки доступны только участникам и в каталоге проектов. */
function involved(d: Deal, userId: string) {
  return d.executorId === userId || d.ownerId === userId || d.arbiterId === userId || (d.contributed[userId] ?? 0) > 0;
}

export async function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: opts.corsOrigin ?? true });
  const now = opts.now ?? Date.now;

  let state: State = await opts.store.load();
  if (state.ledger.length === 0 && Object.keys(state.deals).length === 0) {
    for (const u of DEMO_USERS) if (u.startBalance > 0) state = topUp(state, u.id, u.startBalance * RUB, now());
    await opts.store.save(state);
  }

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
    if (err instanceof EngineError) return reply.code(400).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "Неверные данные", issues: err.issues });
    return reply.code(err.statusCode ?? 500).send({ error: err.statusCode ? err.message : "Внутренняя ошибка" });
  });

  const authed = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const h = req.headers.authorization;
    const id = verifyToken(opts.secret, h?.startsWith("Bearer ") ? h.slice(7) : undefined);
    if (!id || !userById(id)) {
      reply.code(401).send({ error: "Требуется вход" });
      return null;
    }
    return id;
  };

  const walletOf = (s: State, id: string) => ({ free: freeBalance(s, id), reserved: reservedBalance(s, id) });

  // ── публичное ──
  app.get("/health", async () => ({ ok: true }));
  app.get("/templates", async () => TEMPLATES);
  app.get("/auth/demo-users", async () => DEMO_USERS.map(({ id, name, role }) => ({ id, name, role })));
  app.post("/auth/demo", async (req, reply) => {
    const { userId } = z.object({ userId: z.string() }).parse(req.body);
    const u = userById(userId);
    if (!u) return reply.code(404).send({ error: "Нет такого демо-пользователя" });
    return { token: makeToken(opts.secret, u.id), user: { id: u.id, name: u.name, role: u.role } };
  });

  // каталог проектов: краудфандинг и гранты
  app.get("/projects", async (req) => {
    const { mode } = z.object({ mode: z.enum(["crowdfunding", "grant"]).optional() }).parse(req.query);
    return Object.values(state.deals)
      .filter((d) => d.mode !== "own" && (!mode || d.mode === mode))
      .map((d) => summary(d));
  });

  // ── личное ──
  app.get("/me", async (req, reply) => {
    const id = authed(req, reply);
    if (!id) return;
    const { startBalance: _, ...u } = userById(id)!;
    return { user: u, wallet: walletOf(state, id) };
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
    return Object.values(state.deals).filter((d) => involved(d, id)).map(summary).reverse();
  });

  app.get("/deals/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const d = state.deals[id];
    if (!d) return reply.code(404).send({ error: "Сделка не найдена" });
    return { ...d, summary: summary(d) };
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
    if (b.executorId && !userById(b.executorId)) return reply.code(400).send({ error: "Исполнитель не найден" });
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
  const act = <B extends z.ZodTypeAny>(
    path: string,
    body: B,
    fn: (s: State, p: { id: string; stageId: string }, me: string, b: z.infer<B>) => State,
  ) =>
    app.post(path, async (req, reply) => {
      const me = authed(req, reply);
      if (!me) return;
      const params = z.object({ id: z.string(), stageId: z.string().default("") }).parse(req.params);
      const b = body.parse(req.body ?? {});
      return transact((s) => {
        const next = fn(s, params, me, b);
        return { state: next, result: { deal: next.deals[params.id]!, wallet: walletOf(next, me) } };
      });
    });

  const none = z.object({}).passthrough();
  act("/deals/:id/fund", z.object({ amount: money.optional() }), (s, p, me, b) => {
    const d = s.deals[p.id];
    if (!d) throw new EngineError("Сделка не найдена");
    return fund(s, p.id, me, b.amount ?? d.target, now());
  });
  act("/deals/:id/cancel", none, (s, p, me) => cancelDeal(s, p.id, me, now()));
  act(
    "/deals/:id/stages/:stageId/submit",
    z.object({ note: z.string().max(2000).optional(), photos: z.array(z.string().max(500)).max(10).optional() }),
    (s, p, me, b) => submitStage(s, p.id, p.stageId, me, b, now()),
  );
  act("/deals/:id/stages/:stageId/approve", none, (s, p, me) => approveStage(s, p.id, p.stageId, me, now()));
  act("/deals/:id/stages/:stageId/reject", z.object({ reason: z.string() }), (s, p, me, b) =>
    rejectStage(s, p.id, p.stageId, me, b.reason, now()),
  );
  act("/deals/:id/stages/:stageId/vote", z.object({ vote: z.enum(["accept", "reject"]) }), (s, p, me, b) =>
    voteStage(s, p.id, p.stageId, me, b.vote, now()),
  );
  act("/deals/:id/stages/:stageId/dispute", z.object({ reason: z.string() }), (s, p, me, b) =>
    openDispute(s, p.id, p.stageId, me, b.reason),
  );
  act("/deals/:id/stages/:stageId/resolve", z.object({ decision: z.enum(["pay", "refund"]) }), (s, p, me, b) =>
    resolveDispute(s, p.id, p.stageId, me, b.decision, now()),
  );

  // часы автоприёмки: вызывается по таймеру сервера, а также вручную для демо
  const runTick = () => transact((s) => ({ state: tick(s, now()), result: true }));
  app.post("/system/tick", async (req, reply) => {
    if (!authed(req, reply)) return;
    await runTick();
    return { ok: true };
  });

  const timer = setInterval(() => void runTick().catch(() => undefined), 60_000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));

  return app;
}

function stageCounts(d: Deal) {
  const done = d.stages.filter((x) => x.status === "accepted").length;
  return { done, total: d.stages.length };
}

function summary(d: Deal) {
  const raised = Object.values(d.contributed).reduce((a, b) => a + b, 0);
  const current = d.stages.find((x) => ["active", "submitted", "disputed"].includes(x.status));
  return {
    id: d.id,
    mode: d.mode,
    title: d.title,
    status: d.status,
    executorId: d.executorId,
    ownerId: d.ownerId,
    target: d.target,
    raised,
    sponsors: Object.keys(d.contributed).length,
    stages: stageCounts(d),
    currentStage: current ? { id: current.id, title: current.title, status: current.status } : null,
  };
}
