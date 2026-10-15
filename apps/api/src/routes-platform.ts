import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createDeal, defaultDeadlines, fund, type State } from "@steppay/engine";
import { z } from "zod";
import { validInn } from "./inn";
import type { Hub } from "./hub";
import { PROJECT_CATEGORIES, PlatformError, SERVICE_CATEGORIES, projectGoal, projectProblems, type Platform, type Project, type Service } from "./platform";
import { summary } from "./summary";
import type { AuthorProfile, Directory } from "./users";
import type { FnsCheck } from "./fns";

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
  fns(a: AuthorProfile): Promise<FnsCheck>;
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
    const author: AuthorProfile = { legalStatus: b.legalStatus, inn: b.inn, orgName: b.orgName || undefined, email: b.email || undefined };
    author.fns = await c.fns(author);
    await dir.setAuthor(me, author);
    return { ok: true, fns: author.fns };
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
    const author = dir.authorOf(me);
    if (!author) return reply.code(400).send({ error: "Сначала заполните анкету автора: статус и ИНН" });
    // сверка с ФНС обновляется, если ее не было или она старше суток
    if (!author.fns || c.now() - author.fns.checkedAt > 24 * 3600_000) await dir.setAuthor(me, { ...author, fns: await c.fns(author) });
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
    const b = z.object({ action: z.enum(["approve", "reject", "changes"]), comment: z.string().trim().max(1000).optional(), acknowledgeFns: z.boolean().optional() }).parse(req.body);
    const found = platform.projects().find((x) => x.id === id);
    const fnsNow = found ? dir.authorOf(found.ownerId)?.fns : undefined;
    if (b.action === "approve" && fnsNow?.status === "mismatch" && !b.acknowledgeFns) return reply.code(400).send({ error: `ФНС не подтвердила данные автора: ${fnsNow.detail}. Одобрить можно, только подтвердив, что вы это учли`, fns: fnsNow });
    const p = await platform.decide(id, me, b.action, b.comment);
    if (b.action === "approve" && fnsNow?.status === "mismatch") await platform.logAudit(me, "Проект одобрен вопреки расхождению с ФНС", id, fnsNow.detail);
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

  /** Повторная сверка автора проекта с ФНС по кнопке администратора. */
  app.post("/admin/projects/:id/fns", async (req, reply) => {
    const me = adminOnly(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const p = platform.projects().find((x) => x.id === id);
    const author = p ? dir.authorOf(p.ownerId) : undefined;
    if (!p || !author) return reply.code(404).send({ error: "У проекта нет анкеты автора" });
    const fns = await c.fns(author);
    await dir.setAuthor(p.ownerId, { ...author, fns });
    await platform.logAudit(me, "Повторная сверка автора с ФНС", id, `${fns.status}: ${fns.detail}`.slice(0, 190));
    return fns;
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

  // ───────── реестр приемщиков ─────────

  /** Репутация приемщика по закрытым сделкам: сколько споров решил, в чью пользу, сколько раз промолчал до срока. */
  const arbiterStats = (id: string) => {
    let resolved = 0, paid = 0, refunded = 0, silent = 0, active = 0;
    for (const d of Object.values(c.getState().deals)) {
      if (d.arbiterId === id) {
        for (const st of d.stages) {
          if (st.status === "disputed") active++;
          if (st.resolution?.by === "expired" && st.disputedAt !== undefined) silent++;
        }
      }
      for (const e of d.journal ?? []) {
        if (e.by !== id || (e.type !== "stage_accepted" && e.type !== "stage_failed")) continue;
        if ((e.data as { closedBy?: string } | undefined)?.closedBy !== "arbiter") continue;
        resolved++;
        if (e.type === "stage_accepted") paid++; else refunded++;
      }
    }
    return { resolved, paid, refunded, silent, active };
  };
  const arbiterItem = (id: string) => ({ ...brief(id), ...arbiterStats(id) });

  app.get("/arbiters", async (req, reply) => {
    if (!c.authed(req, reply)) return;
    return dir.allIds().filter((id) => dir.isArbiter(id)).map(arbiterItem);
  });

  app.post("/admin/arbiters", async (req, reply) => {
    const me = adminOnly(req, reply);
    if (!me) return;
    const b = z.object({ phone: z.string().max(40), value: z.boolean() }).parse(req.body);
    const { normalizePhone } = await import("./users");
    const phone = normalizePhone(b.phone);
    const u = phone ? dir.byPhone(phone) : undefined;
    if (!u) return reply.code(404).send({ error: "Пользователь с таким номером не найден" });
    await dir.setArbiter(u.id, b.value);
    await platform.logAudit(me, b.value ? "Добавлен приемщик в реестр" : "Приемщик убран из реестра", u.id, brief(u.id).name);
    return { ok: true, user: arbiterItem(u.id) };
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
    return { ...serviceItem(s), mine: s.ownerId === me, chatId: platform.threadsOf(me).find((t) => t.serviceId === id && t.customerId === me)?.id };
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
      changed([th.executorId]);
    }
    return { id: th.id };
  });

  /** Кого и по каким сделкам можно оценить: оценивают после завершения, по одному отзыву от человека. */
  const reviewTarget = (d: NonNullable<ReturnType<typeof c.getState>["deals"][string]>, me: string): string | null => {
    if (d.status !== "completed") return null;
    if (me === d.executorId) return d.mode === "own" && d.ownerId ? d.ownerId : null;
    if (me === d.ownerId || me in d.contributed) return d.executorId;
    return null;
  };

  app.get("/reviews/pending", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    return Object.values(c.getState().deals).flatMap((d) => {
      const to = reviewTarget(d, me);
      if (!to || platform.reviewsOfDeal(d.id).some((r) => r.from === me)) return [];
      return [{ dealId: d.id, title: d.title, target: brief(to) }];
    });
  });

  app.get("/deals/:id/reviews", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const d = c.getState().deals[id];
    if (!d) return reply.code(404).send({ error: "Сделка не найдена" });
    const items = platform.reviewsOfDeal(id);
    const to = reviewTarget(d, me);
    return {
      items: items.map((r) => ({ ...r, from: brief(r.from), to: brief(r.to) })),
      mine: items.find((r) => r.from === me) ?? null,
      canReview: !!to && !items.some((r) => r.from === me),
      target: to ? brief(to) : null,
    };
  });

  app.post("/deals/:id/review", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ stars: z.number().int().min(1, "Поставьте оценку от 1 до 5").max(5, "Поставьте оценку от 1 до 5"), text: z.string().trim().max(1000).default("") }).parse(req.body);
    const d = c.getState().deals[id];
    if (!d) return reply.code(404).send({ error: "Сделка не найдена" });
    if (d.status !== "completed") return reply.code(400).send({ error: "Отзыв можно оставить после завершения сделки" });
    const to = reviewTarget(d, me);
    if (!to) return reply.code(403).send({ error: "Оценить сделку могут ее участники" });
    if (b.stars <= 2 && b.text.length < 10) return reply.code(400).send({ error: "К низкой оценке нужен комментарий: что пошло не так" });
    const review = await platform.addReview({ dealId: id, from: me, to, stars: b.stars, text: b.text });
    notify([to], `${brief(me).name} оставил(а) отзыв по сделке «${d.title}»: ${b.stars} из 5`, id);
    changed([to, me]);
    return review;
  });

  app.get("/users/:id/reviews", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const deals = c.getState().deals;
    return {
      user: brief(id),
      ...platform.ratingOf(id),
      items: platform.reviewsAbout(id).slice(0, 100).map((r) => ({ id: r.id, stars: r.stars, text: r.text, at: r.at, dealTitle: deals[r.dealId]?.title ?? "Сделка", from: brief(r.from) })),
    };
  });

  app.get("/notifications", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    return platform.notesOf(me);
  });

  app.post("/notifications/read", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    await platform.markNotesSeen(me);
    return { ok: true };
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
    const deals = Object.values(c.getState().deals).filter((d) => d.meta?.chatId === id).map((d) => ({ ...summary(d), description: d.meta?.description, agreed: d.meta?.agreed }));
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
    changed([other, me]);
    return m;
  });

  /** Исполнитель регистрирует задачу после разговора: появляется сделка в статусе «Согласование». */
  app.post("/chats/:id/task", async (req, reply) => {
    const me = c.authed(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ title: z.string().trim().min(3, "Название от 3 символов").max(120), description: z.string().trim().max(2000).optional(), amount: z.number().int().min(100, "Укажите сумму, на которую договорились").max(100_000_000_00), arbiterId: z.string().max(60).optional(), backupArbiterId: z.string().max(60).optional().or(z.literal("")) }).parse(req.body);
    const th = platform.thread(id);
    if (!th || th.executorId !== me) return reply.code(403).send({ error: "Задачу регистрирует исполнитель в чате с заказчиком" });
    // приемщик выбирается из реестра: по умолчанию первый, запасной по умолчанию второй, если он есть
    const registry = dir.allIds().filter((x) => dir.isArbiter(x) && x !== th.customerId && x !== me);
    const arbiterId = b.arbiterId ?? registry[0];
    if (!arbiterId || !registry.includes(arbiterId)) return reply.code(400).send({ error: "Выберите приемщика из реестра" });
    const backupArbiterId = b.backupArbiterId === "" ? undefined : (b.backupArbiterId ?? registry.find((x) => x !== arbiterId));
    if (backupArbiterId && (!registry.includes(backupArbiterId) || backupArbiterId === arbiterId)) return reply.code(400).send({ error: "Запасной приемщик должен быть другим человеком из реестра" });
    const dealId = `t_${Math.random().toString(36).slice(2, 10)}${c.now().toString(36)}`;
    const t = c.now();
    await c.transact((s) => ({
      state: createDeal(s, { id: dealId, mode: "own", title: b.title, executorId: me, ownerId: th.customerId, arbiterId, backupArbiterId, status: "draft", signed: true, ...defaultDeadlines("own"), stages: [], meta: { serviceId: th.serviceId, chatId: id, description: b.description, agreed: b.amount }, at: t }),
      result: true,
    }));
    await platform.post(id, me, `Зарегистрирована задача «${b.title}» на ${(b.amount / 100).toLocaleString("ru-RU")} ₽. Исполнитель согласует этапы и отправит условия.`, "system", dealId);
    notify([th.customerId], `${brief(me).name} зарегистрировал(а) задачу «${b.title}» на ${(b.amount / 100).toLocaleString("ru-RU")} ₽`, dealId);
    changed([th.customerId, me]);
    return { dealId };
  });

}

export { PlatformError };
