import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createDeal, defaultDeadlines, fund, type State } from "@steppay/engine";
import { z } from "zod";
import { validInn } from "./inn";
import type { Hub } from "./hub";
import { PROJECT_CATEGORIES, PlatformError, SERVICE_CATEGORIES, projectGoal, projectProblems, type Platform, type Project, type Service } from "./platform";
import { summary } from "./summary";
import type { Directory } from "./users";

const RUB = 100;
const photoUrl = z.string().regex(/^\/uploads\/[\w-]{8,64}$/);
const money = z.number().int().positive().max(100_000_000 * RUB);

export interface Ctx {
  app: FastifyInstance;
  authed(req: FastifyRequest, reply: FastifyReply): string | null;
  dir: Directory;
  platform: Platform;
  hub: Hub;
  now(): number;
  getState(): State;
  transact<T>(fn: (s: State) => { state: State; result: T }): Promise<T>;
  brief(id: string): { id: string; name: string; avatar?: string };
  signIfNeeded(s: State, dealId: string, userId: string, at: number): State;
}

const docSchema = z.object({ id: z.string().min(1).max(60), name: z.string().trim().min(1).max(120), url: photoUrl, kind: z.enum(["photo", "doc"]) });
const stageSchema = z.object({ title: z.string().trim().min(1).max(120), amount: money, criteria: z.array(z.string().trim().min(1).max(200)).max(6).default([]) });

const projectFields = {
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(200),
  description: z.string().trim().max(3000),
  category: z.enum(PROJECT_CATEGORIES as [string, ...string[]]),
  stages: z.array(stageSchema).max(8),
  docs: z.array(docSchema).max(12),
};

const authorBody = z.object({
  legalStatus: z.enum(["person", "selfemployed", "ip", "org"]),
  inn: z.string().regex(/^\d{10}$|^\d{12}$/, "ИНН состоит из 10 или 12 цифр"),
  orgName: z.string().trim().max(160).optional(),
  email: z.string().trim().email("Неверный адрес почты").max(120).optional().or(z.literal("")),
});

export function registerPlatformRoutes(c: Ctx) {
  const { app, dir, platform, hub, brief } = c;

  const adminOnly = (req: FastifyRequest, reply: FastifyReply) => {
    const id = c.authed(req, reply);
    if (!id) return null;
    if (!dir.isAdmin(id)) {
      reply.code(403).send({ error: "Только для администраторов" });
      return null;
    }
    return id;
  };
  const admins = () => dir.allIds().filter((id) => dir.isAdmin(id));
  const notify = (to: string[], text: string, dealId = "") => hub.send(to, "notify", { dealId, text });
  const changed = (to: string[]) => hub.send(to, "changed", {});

  app.get("/meta", async () => ({ serviceCategories: SERVICE_CATEGORIES, projectCategories: PROJECT_CATEGORIES }));

  // ───────── анкета автора ─────────

  app.get("/me/author", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    return dir.authorOf(me) ?? null;
  });

  app.post("/me/author", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const b = authorBody.parse(req.body);
    const wantLen = b.legalStatus === "org" ? 10 : 12;
    if (b.inn.length !== wantLen) return reply.code(400).send({ error: wantLen === 10 ? "У организации ИНН из 10 цифр" : "У физлица, самозанятого и ИП ИНН из 12 цифр" });
    if (!validInn(b.inn)) return reply.code(400).send({ error: "ИНН не прошел проверку: проверьте цифры" });
    if ((b.legalStatus === "org" || b.legalStatus === "ip") && !b.orgName) return reply.code(400).send({ error: b.legalStatus === "org" ? "Укажите название организации" : "Укажите, как записаны в ЕГРИП" });
    await dir.setAuthor(me, { legalStatus: b.legalStatus, inn: b.inn, orgName: b.orgName || undefined, email: b.email || undefined });
    return { ok: true };
  });

  // ───────── проекты ─────────

  const raisedOf = (p: Project) => {
    const d = p.dealId ? c.getState().deals[p.dealId] : undefined;
    return d ? summary(d) : null;
  };

  const catalogItem = (p: Project) => {
    const deal = raisedOf(p);
    return {
      id: p.id,
      kind: p.kind,
      title: p.title,
      summary: p.summary,
      category: p.category,
      cover: (p.docs.find((d) => d.kind === "photo" && d.name === "Обложка") ?? p.docs.find((d) => d.kind === "photo"))?.url,
      goal: projectGoal(p),
      stageCount: p.stages.length,
      raised: deal?.raised ?? 0,
      sponsors: deal?.sponsors ?? 0,
      dealId: p.dealId,
      dealStatus: deal?.status,
      owner: brief(p.ownerId),
    };
  };

  /** Что видит смотрящий: чужие проекты без документов и истории проверки. */
  const projectView = (p: Project, viewer: string) => {
    const mine = p.ownerId === viewer;
    const admin = dir.isAdmin(viewer);
    const deal = raisedOf(p);
    return {
      ...catalogItem(p),
      description: p.description,
      stages: p.stages,
      photos: p.docs.filter((d) => d.kind === "photo"),
      status: p.status,
      ...(mine || admin ? { docs: p.docs, history: p.history, author: dir.authorOf(p.ownerId) ?? null } : {}),
      deal,
      funder: p.funderId ? brief(p.funderId) : undefined,
      can: {
        edit: mine && (p.status === "draft" || p.status === "changes"),
        fundGrant: p.kind === "grant" && p.status === "approved" && !p.dealId && dir.isGrantor(viewer),
        support: p.status === "approved" && !!p.dealId && !mine,
      },
      problems: mine && (p.status === "draft" || p.status === "changes") ? projectProblems(p) : undefined,
    };
  };

  app.get("/projects", async (req, reply) => {
    if (!c.authed(req, reply)) return;
    const q = z.object({ kind: z.enum(["crowdfunding", "grant"]).optional(), category: z.string().optional(), q: z.string().max(60).optional() }).parse(req.query);
    const needle = q.q?.trim().toLowerCase();
    return platform
      .projects()
      .filter((p) => p.status === "approved" && (!q.kind || p.kind === q.kind) && (!q.category || p.category === q.category))
      .filter((p) => !needle || p.title.toLowerCase().includes(needle) || p.summary.toLowerCase().includes(needle))
      .map(catalogItem)
      .reverse();
  });

  app.get("/my/projects", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    return platform
      .projects()
      .filter((p) => p.ownerId === me)
      .map((p) => ({ ...catalogItem(p), status: p.status, lastReview: [...p.history].reverse().find((h) => h.action !== "submit" && h.action !== "resubmit"), updatedAt: p.updatedAt }))
      .reverse();
  });

  app.get("/projects/:id", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const p = platform.project(id);
    if (!p || (p.status !== "approved" && p.ownerId !== me && !dir.isAdmin(me))) return reply.code(404).send({ error: "Проект не найден" });
    return projectView(p, me);
  });

  app.post("/projects", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const b = z
      .object({ kind: z.enum(["crowdfunding", "grant"]), title: projectFields.title, category: projectFields.category.default("Другое") })
      .parse(req.body);
    const p = await platform.createProject(me, { kind: b.kind, title: b.title, category: b.category, summary: "", description: "", stages: [], docs: [] });
    return projectView(p, me);
  });

  app.post("/projects/:id/update", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const patch = z.object(projectFields).partial().parse(req.body);
    return projectView(await platform.updateProject(id, me, patch), me);
  });

  app.post("/projects/:id/submit", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    if (!dir.authorOf(me)) return reply.code(400).send({ error: "Сначала заполните анкету автора: статус и ИНН" });
    const p = await platform.submitProject(id, me);
    notify(admins(), `Новый проект на проверке: «${p.title}»`);
    changed(admins());
    return projectView(p, me);
  });

  /** Грантодатель финансирует проект целиком: создается сделка по этапам и сразу резервируется вся сумма. */
  app.post("/projects/:id/grant", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const p = platform.project(id);
    if (!p || p.kind !== "grant" || p.status !== "approved") return reply.code(404).send({ error: "Грант не найден" });
    if (!dir.isGrantor(me)) return reply.code(403).send({ error: "Финансировать гранты могут проверенные грантодатели" });
    if (p.dealId) return reply.code(400).send({ error: "Проект уже профинансирован" });
    const dealId = `g_${p.id}`;
    const t = c.now();
    await c.transact((s) => {
      let n = createDeal(s, { id: dealId, mode: "grant", title: p.title, executorId: p.ownerId, ownerId: me, signed: true, ...defaultDeadlines("grant"), stages: p.stages, meta: { projectId: p.id }, at: t });
      n = fund(c.signIfNeeded(n, dealId, me, t), dealId, me, projectGoal(p), t);
      return { state: n, result: true };
    });
    await platform.linkDeal(p.id, dealId, me);
    notify([p.ownerId], `Проект «${p.title}» получил грант: подпишите контракт, и работа начнется`, dealId);
    changed([p.ownerId, me]);
    return { dealId };
  });

  // ───────── панель администратора ─────────

  app.get("/admin/summary", async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const count = (st: string) => platform.projects().filter((p) => p.status === st).length;
    return { review: count("review"), changes: count("changes"), approved: count("approved"), rejected: count("rejected"), services: platform.services().filter((s) => s.active).length };
  });

  app.get("/admin/projects", async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const { status } = z.object({ status: z.enum(["review", "changes", "approved", "rejected"]).default("review") }).parse(req.query);
    return platform
      .projects()
      .filter((p) => p.status === status)
      .map((p) => ({ ...catalogItem(p), status: p.status, submittedAt: [...p.history].reverse().find((h) => h.action === "submit" || h.action === "resubmit")?.at ?? p.updatedAt }))
      .sort((a, b) => a.submittedAt - b.submittedAt);
  });

  app.post("/admin/projects/:id/decision", async (req, reply) => {
    const me = adminOnly(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ action: z.enum(["approve", "reject", "changes"]), comment: z.string().trim().max(1000).optional() }).parse(req.body);
    const p = await platform.decide(id, me, b.action, b.comment);
    await platform.logAudit(me, b.action === "approve" ? "Проект одобрен" : b.action === "reject" ? "Проект отклонен" : "Проект возвращен на доработку", id, p.title);
    let dealId: string | undefined;
    if (b.action === "approve" && p.kind === "crowdfunding") {
      // краудфандинг открывается сразу: сделка ждет взносов спонсоров
      dealId = `d_${p.id}`;
      const t = c.now();
      await c.transact((s) => ({ state: createDeal(s, { id: dealId!, mode: "crowdfunding", title: p.title, executorId: p.ownerId, signed: true, ...defaultDeadlines("crowdfunding"), stages: p.stages, meta: { projectId: p.id }, at: t }), result: true }));
      await platform.linkDeal(p.id, dealId);
    }
    const text = b.action === "approve" ? `Проект «${p.title}» одобрен${p.kind === "crowdfunding" ? ", сбор открыт: подпишите контракт, чтобы работа началась" : ", теперь его может поддержать грантодатель"}` : b.action === "reject" ? `Проект «${p.title}» отклонен: ${b.comment}` : `По проекту «${p.title}» есть замечания: ${b.comment}`;
    notify([p.ownerId], text, dealId);
    changed([p.ownerId, ...admins()]);
    return projectView(p, me);
  });

  app.get("/admin/audit", async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return platform.auditLog().slice(0, 200).map((e) => ({ ...e, byName: brief(e.by).name }));
  });

  app.get("/admin/grantors", async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return dir.allIds().filter((id) => dir.isGrantor(id)).map(brief);
  });

  app.post("/admin/grantors", async (req, reply) => {
    const me = adminOnly(req, reply);
    if (!me) return;
    const b = z.object({ phone: z.string().max(40), value: z.boolean() }).parse(req.body);
    const { normalizePhone } = await import("./users");
    const phone = normalizePhone(b.phone);
    const u = phone ? dir.byPhone(phone) : undefined;
    if (!u) return reply.code(404).send({ error: "Пользователь с таким номером не найден" });
    await dir.setGrantor(u.id, b.value);
    await platform.logAudit(me, b.value ? "Назначен грантодатель" : "Снят грантодатель", u.id, brief(u.id).name);
    return { ok: true, user: brief(u.id) };
  });

  // ───────── услуги ─────────

  const serviceFields = {
    title: z.string().trim().min(3, "Название от 3 символов").max(100),
    category: z.enum(SERVICE_CATEGORIES as [string, ...string[]]),
    description: z.string().trim().min(20, "Опишите услугу подробнее, от 20 символов").max(2000),
    priceFrom: money.optional(),
    photos: z.array(photoUrl).max(6).default([]),
  };

  const serviceItem = (s: Service) => ({ id: s.id, title: s.title, category: s.category, description: s.description, priceFrom: s.priceFrom, photos: s.photos, active: s.active, owner: brief(s.ownerId) });

  app.get("/services", async (req, reply) => {
    if (!c.authed(req, reply)) return;
    const q = z.object({ category: z.string().optional(), q: z.string().max(60).optional() }).parse(req.query);
    const needle = q.q?.trim().toLowerCase();
    return platform
      .services()
      .filter((s) => s.active && (!q.category || s.category === q.category))
      .filter((s) => !needle || s.title.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle))
      .map(serviceItem)
      .reverse();
  });

  app.get("/my/services", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    return platform.services().filter((s) => s.ownerId === me).map(serviceItem).reverse();
  });

  app.get("/services/:id", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const s = platform.service(id);
    if (!s || (!s.active && s.ownerId !== me)) return reply.code(404).send({ error: "Услуга не найдена" });
    return { ...serviceItem(s), mine: s.ownerId === me };
  });

  app.post("/services", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const b = z.object(serviceFields).parse(req.body);
    return serviceItem(await platform.createService(me, b));
  });

  app.post("/services/:id/update", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ ...serviceFields, active: z.boolean() }).partial().parse(req.body);
    return serviceItem(await platform.updateService(id, me, b));
  });

  app.post("/services/:id/remove", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await platform.removeService(id, me);
    return { ok: true };
  });

  // ───────── чаты ─────────

  const threadView = (th: NonNullable<ReturnType<Platform["thread"]>>, me: string) => {
    const service = platform.service(th.serviceId);
    const otherId = th.customerId === me ? th.executorId : th.customerId;
    return { id: th.id, role: th.customerId === me ? "customer" : "executor", service: { id: th.serviceId, title: service?.title ?? "Услуга" }, with: brief(otherId) };
  };

  app.post("/services/:id/chat", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { text } = z.object({ text: z.string().trim().max(2000).optional() }).parse(req.body ?? {});
    const th = await platform.openThread(id, me);
    if (text) {
      await platform.post(th.id, me, text);
      notify([th.executorId], `${brief(me).name}: ${text.slice(0, 80)}`);
      changed([th.executorId]);
    }
    return { id: th.id };
  });

  app.get("/chats", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    return platform.threadsOf(me).map((th) => {
      const last = th.messages[th.messages.length - 1];
      return { ...threadView(th, me), last: last ? { text: last.text, at: last.at, by: last.by, kind: last.kind } : null, unread: platform.unread(th, me), updatedAt: th.updatedAt };
    });
  });

  app.get("/chats/:id", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const th = platform.thread(id);
    if (!th || (th.customerId !== me && th.executorId !== me)) return reply.code(404).send({ error: "Чат не найден" });
    await platform.markRead(id, me);
    const deals = Object.values(c.getState().deals).filter((d) => d.meta?.chatId === id).map((d) => ({ ...summary(d), description: d.meta?.description }));
    return { ...threadView(th, me), messages: th.messages, deals, me: brief(me) };
  });

  app.post("/chats/:id/messages", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { text } = z.object({ text: z.string().trim().min(1).max(2000) }).parse(req.body);
    const th = platform.thread(id);
    if (!th || (th.customerId !== me && th.executorId !== me)) return reply.code(404).send({ error: "Чат не найден" });
    const m = await platform.post(id, me, text);
    const other = th.customerId === me ? th.executorId : th.customerId;
    notify([other], `${brief(me).name}: ${text.slice(0, 80)}`);
    changed([other, me]);
    return m;
  });

  /** Исполнитель регистрирует задачу после разговора: появляется сделка в статусе «Согласование». */
  app.post("/chats/:id/task", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ title: z.string().trim().min(3, "Название от 3 символов").max(120), description: z.string().trim().max(2000).optional() }).parse(req.body);
    const th = platform.thread(id);
    if (!th || th.executorId !== me) return reply.code(403).send({ error: "Задачу регистрирует исполнитель в чате с заказчиком" });
    const dealId = `t_${Math.random().toString(36).slice(2, 10)}${c.now().toString(36)}`;
    const t = c.now();
    await c.transact((s) => ({
      state: createDeal(s, { id: dealId, mode: "own", title: b.title, executorId: me, ownerId: th.customerId, arbiterId: "expert", status: "draft", signed: true, ...defaultDeadlines("own"), stages: [], meta: { serviceId: th.serviceId, chatId: id, description: b.description }, at: t }),
      result: true,
    }));
    await platform.post(id, me, `Зарегистрирована задача «${b.title}». Исполнитель согласует этапы и отправит условия.`, "system", dealId);
    notify([th.customerId], `${brief(me).name} зарегистрировал(а) задачу «${b.title}»`, dealId);
    changed([th.customerId, me]);
    return { dealId };
  });

}

export { PlatformError };
