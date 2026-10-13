import { createHmac, randomBytes } from "node:crypto";
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
  defaultDeadlines,
  updateTerms,
  proposeDeal,
  reopenDeal,
  topUp,
  voteStage,
  type Deal,
  type State, canonicalJson, contractTerms, sealContract, signContract, signatureStatus, verifyContract, verifyJournal, linkChain } from "@steppay/engine";
import { createPlanner, type Planner } from "./ai";
import { makeLoginChallenge, makeTicket, makeToken, openLoginChallenge, tokenMethod, verifyTicket, verifyToken } from "./auth";
import { Hub } from "./hub";
import { DEMO_DOC, DEMO_DOC_ID, DEMO_PHOTO, DEMO_PHOTO_ID } from "./demo-photo";
import { ANCHOR_GENESIS, buildAnchor, changedSince, checkAgainstAnchors, verifyAnchorChain, verifyMoney, type Anchor } from "@steppay/engine";
import { fileKeyFrom, openFile, sealFile } from "./filecrypt";
import { MAX_KEYS, checkLoginAssertion, checkPasskeyRegistration, checkRegisterProof, checkSignProof, keyIdOf, signMessage } from "./devicekeys";
import { DEMO_COVERS, DEMO_COVER_IDS } from "./demo-covers";
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

export interface PublicAnchor {
  n: number;
  at: number;
  root: string;
  prev: string;
  deals: number;
  ledgerLen: number;
  ledgerHash: string;
}

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
  /** device: подписывать можно только ключом устройства; any (по умолчанию): без ключа допускается серверная демо-подпись */
  /** пополнение кошелька без оплаты: по умолчанию только в демо-режиме */
  allowTopup?: boolean;
  /** ограничение частоты запросов с одного адреса за минуту */
  rateLimit?: { general: number; auth: number; uploads: number };
  signaturePolicy?: "device" | "any" | "passkey";
  /** ключ шифрования закрытых файлов (32 байта, hex или base64); без него выводится из секрета */
  fileKey?: string;
  /** администратор работает только в сессии, начатой входом по passkey; по умолчанию включено вне демо */
  adminRequirePasskey?: boolean;
  /** как часто фиксировать якорь истории (мс), по умолчанию час */
  anchorEveryMs?: number;
  /** публикация якоря вне сервера: внешний журнал, сеть, свидетель. Без нее якоря только хранятся и отдаются по /anchors */
  anchorPublish?: (a: PublicAnchor) => Promise<{ target: string; ref?: string }>;
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
  // за прокси платформы (Railway) настоящий адрес клиента приходит в X-Forwarded-For
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, trustProxy: process.env.NODE_ENV === "production" });
  const origins = opts.corsOrigin?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];
  await app.register(cors, { origin: origins.length ? origins : process.env.NODE_ENV === "production" ? false : true });
  const now = opts.now ?? Date.now;
  const fileKey = fileKeyFrom(opts.secret, opts.fileKey);
  const putFile = (id: string, f: Parameters<typeof opts.store.putFile>[1]) => opts.store.putFile(id, sealFile(fileKey, id, f));
  const getFile = async (id: string) => {
    const f = await opts.store.getFile(id);
    return f ? openFile(fileKey, id, f) : null;
  };
  const planner = opts.planner ?? createPlanner();
  const hub = new Hub();
  const demoOn = opts.demoMode ?? true;
  const adminPhones = (opts.adminPhones ?? []).map((p) => normalizePhone(p)).filter((p): p is string => !!p);
  const dir = new Directory((users) => opts.store.saveUsers(users), await opts.store.loadUsers(), demoOn, adminPhones);
  const platform = new Platform(await opts.store.loadPlatform(), (d) => opts.store.savePlatform(d), now);
  /** Серверная подпись (демо): HMAC от сделки, хеша контракта и подписанта. Настоящие подписи ключами на устройстве это шаг 7. */
  const signFor = (dealId: string, hash: string, userId: string) => createHmac("sha256", `${opts.secret}:sign`).update(`${dealId}:${hash}:${userId}`).digest("hex");
  const signatureValid = (d: Deal, userId: string) => {
    const sg = d.signatures?.[userId];
    if (!sg || !d.contract || sg.hash !== d.contract.hash) return false;
    if (sg.proof) return checkSignProof(sg.proof, { dealId: d.id, contract: sg.hash, userId }, undefined, origins) === null;
    return sg.sig === signFor(d.id, sg.hash, userId);
  };
  /** Подписывает за пользователя, если он сторона контракта и еще не подписал. */
  const signIfNeeded = (s: State, dealId: string, userId: string, at: number): State => {
    const d = s.deals[dealId];
    if (!d?.signing || !d.contract || d.status !== "funding") return s;
    // у пользователя есть ключ или включена строгая политика: подписывает он сам, ключом устройства
    if (opts.signaturePolicy === "device" || opts.signaturePolicy === "passkey" || dir.hasActiveKey(userId)) return s;
    const st = signatureStatus(d);
    if (!st.required.includes(userId) || st.signed.includes(userId)) return s;
    return signContract(s, dealId, userId, at, signFor(dealId, d.contract.hash, userId));
  };
  const otp = new OtpService(opts.secret, opts.otpDelivery ?? demoDelivery, now);

  let state: State = await opts.store.load();
  if (state.ledger.length === 0 && Object.keys(state.deals).length === 0) {
    if (demoOn) {
      state = opts.seedCatalog ? freshDemoState(now()) : seedUsers(state, now());
      await opts.store.save(state);
    }
  }
  // сделки, созданные до появления контрактов, получают контракт с хешем текущих условий
  const unsealed = Object.values(state.deals).filter((d) => d.status !== "draft" && !d.contract);
  if (unsealed.length > 0) {
    state = structuredClone(state);
    for (const d of Object.values(state.deals)) if (d.status !== "draft" && !d.contract) sealContract(d, d.createdAt);
    await opts.store.save(state);
  }
  if (demoOn && opts.seedCatalog && platform.isEmpty()) await platform.reset(freshDemoPlatform(now()));
  if (!demoOn) {
    const cleaned = purgeDemo(state);
    if (cleaned.changed) {
      state = cleaned.state;
      await opts.store.save(state);
      await platform.clearAnchors();
    }
    await platform.purgeDemo(new Set(DEMO_USERS.map((u) => u.id)), (id) => !state.deals[id]);
  }

  await putFile(DEMO_PHOTO_ID, { mime: "image/jpeg", data: DEMO_PHOTO });
  for (let i = 0; i < DEMO_COVERS.length; i++) await putFile(DEMO_COVER_IDS[i]!, { mime: "image/jpeg", data: DEMO_COVERS[i]! });
  await putFile(DEMO_DOC_ID, { mime: "application/pdf", data: DEMO_DOC, private: true, ownerId: "games" });

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

  // ── защита: ограничение частоты запросов и заголовки ──
  const limits = opts.rateLimit ?? { general: 600, auth: 120, uploads: 30 };
  const hits = new Map<string, number[]>();
  const over = (key: string, max: number) => {
    const t = Date.now();
    const list = (hits.get(key) ?? []).filter((x) => t - x < 60_000);
    list.push(t);
    hits.set(key, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (v.every((x) => t - x >= 60_000)) hits.delete(k);
    return list.length > max;
  };
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const ip = req.ip;
    const bucket = req.url.startsWith("/auth") ? ["auth", limits.auth] : req.url.startsWith("/uploads") && req.method === "POST" ? ["uploads", limits.uploads] : ["all", limits.general];
    if (over(`${bucket[0]}:${ip}`, bucket[1] as number)) return reply.code(429).header("retry-after", "30").send({ error: "Слишком много запросов, подождите минуту" });
  });
  const hsts = process.env.NODE_ENV === "production";
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff").header("referrer-policy", "no-referrer").header("x-frame-options", "DENY");
    if (hsts) reply.header("strict-transport-security", "max-age=15552000");
    const type = String(reply.getHeader("content-type") ?? "");
    if (type.includes("json")) {
      reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
      if (!reply.getHeader("cache-control")) reply.header("cache-control", "no-store");
    }
    return payload;
  });

  const adminRequirePasskey = opts.adminRequirePasskey ?? !demoOn;
  /** Сессия администратора без passkey при включенном требовании. */
  const adminLocked = (id: string, raw: string | undefined) => adminRequirePasskey && dir.isAdmin(id) && tokenMethod(opts.secret, raw) !== "passkey";

  const authed = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const h = req.headers.authorization;
    const raw = h?.startsWith("Bearer ") ? h.slice(7) : undefined;
    const id = verifyToken(opts.secret, raw, Date.now(), (u) => dir.sessionsFrom(u));
    if (!id || !dir.get(id)) {
      reply.code(401).send({ error: "Требуется вход" });
      return null;
    }
    // администратор, вошедший по СМС, может только управлять ключами: остальное требует passkey
    if (adminLocked(id, raw) && !/^\/(me|me\/keys|me\/passkeys|auth\/logout-all)(\/|\?|$)/.test(req.url)) {
      reply.code(403).send({ error: "Администратору нужен вход по passkey: добавьте его в профиле и войдите с ним" });
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
    return { token: makeToken(opts.secret, u.id, Date.now()), user: { id: u.id, name: u.name, role: u.role } };
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
    return { token: makeToken(opts.secret, user.id, Date.now()), isNew: !existing, user: { id: user.id, name: user.name, role: "user" as const } };
  });

  // вход по passkey: без кода из СМС, подтверждение отпечатком, лицом или PIN
  const usedChallenges = new Map<string, number>();
  app.post("/auth/passkey/challenge", async () => ({ challenge: makeLoginChallenge(opts.secret, now(), randomBytes(16).toString("base64url")) }));
  app.post("/auth/passkey/login", async (req, reply) => {
    const b = z
      .object({
        challenge: z.string().max(200),
        credentialId: z.string().max(400),
        userHandle: z.string().max(400),
        authenticatorData: z.string().max(1200),
        clientDataJSON: z.string().max(1200),
        signature: z.string().max(400),
      })
      .parse(req.body);
    const fail = () => reply.code(401).send({ error: "Не удалось войти по passkey" });
    const t = now();
    for (const [k, at] of usedChallenges) if (t - at > 5 * 60_000) usedChallenges.delete(k);
    const ch = openLoginChallenge(opts.secret, b.challenge, t);
    if (!ch || usedChallenges.has(ch.nonce)) return fail();
    usedChallenges.set(ch.nonce, t);
    const userId = Buffer.from(b.userHandle, "base64").toString("utf8");
    const user = dir.get(userId);
    const key = dir.keysOf(userId).find((k) => k.kind === "passkey" && !k.revokedAt && k.credentialId === b.credentialId);
    if (!user || !key) return fail();
    if (checkLoginAssertion(key.publicKey, b, b.challenge, origins) !== null) return fail();
    if (user.role === "admin") await platform.logAudit(userId, "Вход администратора по passkey", key.id);
    return { token: makeToken(opts.secret, userId, Date.now(), "passkey"), user: { id: user.id, name: user.name, role: user.role } };
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
      const f = await getFile(patch.avatar.slice("/uploads/".length));
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

  registerPlatformRoutes({ app, authed, dir, platform, hub, now, getState: () => state, transact, brief, signIfNeeded });

  // ── личное ──
  app.get("/me", async (req, reply) => {
    const id = authed(req, reply);
    if (!id) return;
    const u = dir.get(id)!;
    const phone = dir.phoneOf(id);
    const h = req.headers.authorization;
    const locked = adminLocked(id, h?.startsWith("Bearer ") ? h.slice(7) : undefined);
    return { user: { ...u, phone: phone ? maskPhone(phone) : undefined }, wallet: walletOf(state, id), features: { topup: topupAllowed }, ...(locked ? { adminLocked: true } : {}) };
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

  /** Билет на 2 минуты для адреса запроса: поток событий и закрытые файлы. Долгоживущий токен в ссылки не попадает. */
  app.post("/auth/ticket", async (req, reply) => {
    const id = authed(req, reply);
    if (!id) return;
    return { ticket: makeTicket(opts.secret, id, Date.now()) };
  });

  /** Завершает все сессии: токены, выданные раньше этого момента, перестают действовать. */
  app.post("/auth/logout-all", async (req, reply) => {
    const id = authed(req, reply);
    if (!id) return;
    await dir.revokeSessions(id, Date.now());
    return { ok: true };
  });

  const topupAllowed = opts.allowTopup ?? demoOn;
  app.post("/wallet/topup", async (req, reply) => {
    if (!topupAllowed) return reply.code(403).send({ error: "Пополнение подключается к платежной платформе и пока недоступно" });
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
    return { ...d, summary: sum(d), contractCheck: verifyContract(d), journalCheck: verifyJournal(d), signatureStatus: { ...signatureStatus(d), valid: Object.fromEntries(Object.keys(d.signatures ?? {}).map((u) => [u, signatureValid(d, u)])) }, terms: contractTerms(d), people: Object.fromEntries([...ids].map((x) => [x, brief(x)])) };
  });

  /** Прогон сделки на контракте в сети: администратор прикрепляет отчет (адреса и хеши транзакций), он виден участникам сделки. */
  app.post("/deals/:id/chain", async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    if (!dir.isAdmin(me)) return reply.code(403).send({ error: "Только для администраторов" });
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const chain = z
      .object({
        network: z.string().trim().min(1).max(60),
        chainId: z.number().int().positive(),
        contract: z.string(),
        dealId: z.number().int().positive(),
        explorer: z.string().max(200).optional(),
        txs: z.array(z.object({ label: z.string().trim().min(1).max(80), hash: z.string(), at: z.number() })).min(1).max(100),
      })
      .parse(req.body);
    const out = await transact((s) => {
      const next = linkChain(s, id, chain, now());
      return { state: next, result: next.deals[id]! };
    });
    await platform.logAudit(me, "Привязан прогон на контракте", id, `${chain.network}, транзакций ${chain.txs.length}`);
    const people = [out.executorId, out.ownerId, ...Object.keys(out.contributed)].filter((x): x is string => !!x);
    hub.send(people, "notify", { dealId: id, text: `Сделка «${out.title}» проведена на контракте в сети ${chain.network}: транзакции доступны в сделке` });
    hub.send(people, "changed", { dealId: id });
    return { ok: true };
  });

  /** Журнал для разбора спора: события, хеши цепочки и результат проверки. Файл самодостаточен: условия и хеш контракта внутри. */
  app.get("/deals/:id/journal", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const d = state.deals[id];
    if (!d) return reply.code(404).send({ error: "Сделка не найдена" });
    return { dealId: d.id, title: d.title, contract: d.contract ?? null, check: verifyJournal(d), entries: d.journal ?? [] };
  });

  /** Контракт для разбора и независимой проверки: условия, каноническая запись и хеш. SHA-256 канонической записи должен совпасть с hash. */
  app.get("/deals/:id/contract", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const d = state.deals[id];
    if (!d) return reply.code(404).send({ error: "Сделка не найдена" });
    const terms = contractTerms(d);
    return { dealId: d.id, contract: d.contract ?? null, check: verifyContract(d), terms, canonical: canonicalJson(terms) };
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
        signed: true,
        stages,
        autoAcceptDays: b.autoAcceptDays,
        ...defaultDeadlines(b.mode),
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
      expired: `Срок вышел: сделка «${d.title}» закрыта, остаток возвращен`,
      propose: `${who} отправил(а) условия по «${d.title}», можно резервировать`,
      reopen: `${who} вернул(а) условия на правку: «${d.title}»`,
      sign: d.status === "active" ? `${who} подписал(а) контракт «${d.title}»: работа началась` : `${who} подписал(а) контракт «${d.title}»`,
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
    return fund(signIfNeeded(s, p.id, me, now()), p.id, me, b.amount ?? d.target, now());
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
  act("/deals/:id/propose", none, (s, p, me) => signIfNeeded(proposeDeal(s, p.id, me, now()), p.id, me, now()), "propose");
  act(
    "/deals/:id/sign",
    z.object({
      proof: z
        .object({
          keyId: z.string().max(40),
          message: z.string().max(600),
          signature: z.string().max(400),
          webauthn: z.object({ authenticatorData: z.string().max(400), clientDataJSON: z.string().max(1200) }).optional(),
        })
        .optional(),
    }),
    (s, p, me, b) => {
      const d = s.deals[p.id];
      if (!d?.contract) return signContract(s, p.id, me, now(), "", undefined); // движок вернет понятную ошибку
      if (b.proof) {
        const key = dir.activeKey(me, b.proof.keyId);
        if (!key) throw new EngineError("Ключ не найден или отозван: создайте новый в профиле");
        if (opts.signaturePolicy === "passkey" && key.kind !== "passkey") throw new EngineError("Подписывать можно только passkey: добавьте его в профиле");
        if ((key.kind === "passkey") !== !!b.proof.webauthn) throw new EngineError(key.kind === "passkey" ? "Этот ключ подписывает только через passkey" : "Для этого ключа нужна обычная подпись");
        const proof = { alg: "ES256" as const, keyId: key.id, publicKey: key.publicKey, message: b.proof.message, signature: b.proof.signature, webauthn: b.proof.webauthn };
        const bad = checkSignProof(proof, { dealId: d.id, contract: d.contract.hash, userId: me }, now(), origins);
        if (bad) throw new EngineError(bad);
        return signContract(s, p.id, me, now(), `es256:${key.id}`, proof);
      }
      if (dir.hasActiveKey(me)) throw new EngineError("Подпишите контракт ключом устройства");
      if (opts.signaturePolicy === "passkey") throw new EngineError("Добавьте passkey в профиле: подписывать можно только им");
      if (opts.signaturePolicy === "device") throw new EngineError("Создайте ключ подписи в профиле: серверная подпись отключена");
      return signContract(s, p.id, me, now(), signFor(p.id, d.contract.hash, me));
    },
    "sign",
  );

  // ключи подписи на устройстве
  app.get("/me/keys", async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    return dir.keysOf(me).map((k) => ({ id: k.id, label: k.label, createdAt: k.createdAt, revokedAt: k.revokedAt, active: !k.revokedAt, kind: k.kind ?? "device", credentialId: k.credentialId }));
  });

  app.post("/me/keys", async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    const b = z.object({ publicKey: z.string().max(400), label: z.string().trim().max(60).optional(), at: z.number(), signature: z.string().max(200) }).parse(req.body);
    const bad = checkRegisterProof(me, b.publicKey, b.at, b.signature, now());
    if (bad) return reply.code(400).send({ error: bad });
    const id = keyIdOf(b.publicKey);
    if (dir.keysOf(me).some((k) => k.id === id)) return reply.code(400).send({ error: "Этот ключ уже добавлен" });
    if (dir.keysOf(me).filter((k) => !k.revokedAt).length >= MAX_KEYS) return reply.code(400).send({ error: `Не больше ${MAX_KEYS} активных ключей: отзовите ненужные` });
    await dir.addKey(me, { id, publicKey: b.publicKey, label: b.label || "Это устройство", createdAt: now() });
    return { id };
  });

  // passkeys (WebAuthn): ключ в защищенном чипе устройства, подтверждение отпечатком, лицом или PIN
  app.post("/me/passkeys", async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    const b = z
      .object({
        credentialId: z.string().max(400),
        publicKey: z.string().max(400),
        authenticatorData: z.string().max(1200),
        clientDataJSON: z.string().max(1200),
        at: z.number(),
        label: z.string().trim().max(60).optional(),
      })
      .parse(req.body);
    const bad = checkPasskeyRegistration(me, b, now(), origins);
    if (bad) return reply.code(400).send({ error: bad });
    const id = keyIdOf(b.publicKey);
    const have = dir.keysOf(me);
    if (have.some((k) => k.id === id)) return reply.code(400).send({ error: "Этот passkey уже добавлен" });
    if (have.filter((k) => !k.revokedAt).length >= MAX_KEYS) return reply.code(400).send({ error: `Не больше ${MAX_KEYS} активных ключей: отзовите ненужные` });
    await dir.addKey(me, { id, publicKey: b.publicKey, label: b.label || "Passkey", createdAt: now(), kind: "passkey", credentialId: b.credentialId });
    return { id };
  });

  app.post("/me/keys/:id/revoke", async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    if (!(await dir.revokeKey(me, id, now()))) return reply.code(404).send({ error: "Ключ не найден" });
    return { ok: true };
  });
  act("/deals/:id/reopen", none, (s, p, me) => reopenDeal(s, p.id, me, now()), "reopen");
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
      const prep = await prepareDemoStep(platform, step, now(), signFor);
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
    const { ticket } = z.object({ ticket: z.string() }).parse(req.query);
    const id = verifyTicket(opts.secret, ticket, Date.now());
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
    await putFile(id, { mime: m[1]!, data, private: !!isPrivate, ownerId: me });
    return { url: `/uploads/${id}` };
  });
  app.get("/uploads/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().regex(/^[\w-]{8,64}$/) }).parse(req.params);
    const f = await getFile(id);
    if (!f) return reply.code(404).send({ error: "Файл не найден" });
    if (f.private) {
      const { ticket } = z.object({ ticket: z.string().optional() }).parse(req.query);
      const h = req.headers.authorization;
      const who = ticket ? verifyTicket(opts.secret, ticket, Date.now()) : verifyToken(opts.secret, h?.startsWith("Bearer ") ? h.slice(7) : undefined, Date.now(), (u) => dir.sessionsFrom(u));
      if (!who || !dir.get(who)) return reply.code(401).send({ error: "Требуется вход" });
      if (who !== f.ownerId && !dir.isAdmin(who)) return reply.code(403).send({ error: "Документ доступен только автору и администраторам" });
      if (who !== f.ownerId) await platform.logAudit(who, "Просмотр документа проекта", id, f.ownerId ? `автор ${dir.get(f.ownerId)?.name ?? f.ownerId}` : undefined);
      return reply.header("content-type", f.mime).header("cache-control", "private, no-store").header("content-disposition", "inline").header("cross-origin-resource-policy", "cross-origin").send(f.data);
    }
    return reply
      .header("content-type", f.mime)
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("cross-origin-resource-policy", "cross-origin")
      .send(f.data);
  });

  // ── якоря истории ──
  const publicAnchor = (a: Anchor): PublicAnchor => ({ n: a.n, at: a.at, root: a.root, prev: a.prev, deals: a.leaves.length, ledgerLen: a.ledgerLen, ledgerHash: a.ledgerHash });
  const anchorEvery = opts.anchorEveryMs ?? 60 * 60_000;
  /** Публикует якоря, которые еще не ушли наружу. Ошибка записывается и повторится на следующем проходе. */
  const publishAnchors = async () => {
    if (!opts.anchorPublish) return;
    for (const a of platform.anchors()) {
      if (platform.anchorPubs(a.n).some((p) => p.ok)) continue;
      const last = platform.anchorPubs(a.n).at(-1);
      if (last && now() - last.at < 60_000) continue;
      try {
        const r = await opts.anchorPublish(publicAnchor(a));
        await platform.addAnchorPub(a.n, { at: now(), target: r.target, ok: true, ref: r.ref });
      } catch (e) {
        await platform.addAnchorPub(a.n, { at: now(), target: "внешний журнал", ok: false, error: (e as Error).message.slice(0, 160) });
      }
    }
  };
  /** Фиксирует якорь, если с прошлого что-то изменилось и прошло достаточно времени. */
  const runAnchor = async (force = false) => {
    const list = platform.anchors();
    const last = list.at(-1) ?? null;
    if (!force && last && now() - last.at < anchorEvery) return null;
    if (!changedSince(state, last)) return null;
    const a = buildAnchor(state, last, now());
    await platform.addAnchor(a);
    return a;
  };
  const anchorTick = async () => {
    await runAnchor();
    await publishAnchors();
  };

  // часы автоприемки: вызывается по таймеру сервера, а также вручную для демо
  const runTick = async () => {
    const before = state;
    await transact((s) => ({ state: tick(s, now()), result: true }));
    for (const d of Object.values(state.deals)) {
      d.stages.forEach((st, i) => {
        if (before.deals[d.id]?.stages[i]?.status === "submitted" && st.status === "accepted") announce(d, "", "approve", st.title, st.amount);
        if (st.resolution?.by === "expired" && before.deals[d.id]?.stages[i]?.status !== "failed") announce(d, "", "expired", st.title, st.amount);
      });
      const was = before.deals[d.id];
      if (was?.status === "funding" && d.status === "cancelled") announce(d, "", "expired", "", 0);
    }
  };
  app.post("/system/tick", async (req, reply) => {
    if (!authed(req, reply)) return;
    await runTick();
    await anchorTick();
    return { ok: true };
  });

  /** Список якорей: корни и ссылки на публикации. Подробности по сделкам не раскрываются. */
  app.get("/anchors", async () => ({ anchors: platform.anchors().map((a) => ({ ...publicAnchor(a), published: platform.anchorPubs(a.n).filter((p) => p.ok).map((p) => ({ at: p.at, target: p.target, ref: p.ref })) })), genesis: ANCHOR_GENESIS }));
  app.get("/anchors/latest", async (_req, reply) => {
    const a = platform.anchors().at(-1);
    return a ? publicAnchor(a) : reply.code(404).send({ error: "Якорей пока нет" });
  });
  /** Сверка: цепочка якорей цела, история и деньги ничего из зафиксированного не потеряли. Подробности только администратору. */
  app.get("/anchors/verify", async (req) => {
    const list = platform.anchors();
    const chain = verifyAnchorChain(list);
    const problems = checkAgainstAnchors(state, list);
    const money = verifyMoney(state);
    const ok = chain.ok && problems.length === 0 && money.length === 0;
    const h = req.headers.authorization;
    const viewer = verifyToken(opts.secret, h?.startsWith("Bearer ") ? h.slice(7) : undefined, Date.now(), (u) => dir.sessionsFrom(u));
    const admin = !!viewer && dir.isAdmin(viewer);
    return { ok, anchors: list.length, lastAt: list.at(-1)?.at ?? null, chain, problems: admin ? problems : problems.length, money: admin ? money : money.length };
  });
  /** Якоря, в которых зафиксирован журнал этой сделки: участник может сверить их с тем, что опубликовано снаружи. */
  app.get("/deals/:id/anchors", async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const d = state.deals[id];
    if (!d || !(involved(d, me) || dir.isAdmin(me))) return reply.code(404).send({ error: "Сделка не найдена" });
    return platform
      .anchors()
      .flatMap((a) => {
        const leaf = a.leaves.find((l) => l.id === id);
        return leaf ? [{ n: a.n, at: a.at, root: a.root, len: leaf.len, head: leaf.head, published: platform.anchorPubs(a.n).filter((p) => p.ok).map((p) => ({ target: p.target, ref: p.ref })) }] : [];
      });
  });
  app.post("/system/anchor", async (req, reply) => {
    const me = authed(req, reply);
    if (!me) return;
    if (!dir.isAdmin(me)) return reply.code(403).send({ error: "Только администратор" });
    const a = await runAnchor(true);
    await publishAnchors();
    return { anchored: !!a, anchor: a ? publicAnchor(a) : null };
  });

  const timer = setInterval(() => void runTick().then(anchorTick).catch(() => undefined), 60_000);
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
