import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Deal } from "@steppay/engine";
import { summary } from "./summary";
import type { Ctx } from "./routes-platform";

const MSK = 3 * 3600_000;
const dayKey = (at: number) => new Date(at + MSK).toISOString().slice(0, 10);

/** Отдельный интерфейс администратора: показатели, операции участников, споры, заявки на подтверждение, участники. */
export function registerAdminRoutes(c: Ctx) {
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

  // ───────── показатели ─────────

  app.get("/admin/dashboard", async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const s = c.getState();
    const deals = Object.values(s.deals);
    const people = dir.accounts().filter((a) => a.role !== "arbiter" && a.role !== "admin");
    const sums = deals.map(summary);
    const dealsBy = (st: string) => deals.filter((d) => d.status === st).length;
    const disputed = deals.filter((d) => d.stages.some((x) => x.status === "disputed")).length;

    const days = 14;
    const today = c.now();
    const series = Array.from({ length: days }, (_, i) => ({ day: dayKey(today - (days - 1 - i) * 86400_000), topup: 0, payout: 0, deals: 0 }));
    const at = new Map(series.map((x) => [x.day, x]));
    for (const e of s.ledger) {
      const row = at.get(dayKey(e.at));
      if (!row) continue;
      if (e.type === "topup") row.topup += e.amount;
      if (e.type === "payout") row.payout += e.amount;
    }
    for (const d of deals) {
      const row = at.get(dayKey(d.createdAt));
      if (row) row.deals++;
    }

    const volume = (type: string) => s.ledger.filter((e) => e.type === type).reduce((a, e) => a + e.amount, 0);
    return {
      users: {
        total: people.length,
        executors: people.filter((a) => a.kind === "executor").length,
        customers: people.filter((a) => a.kind !== "executor").length,
        verified: people.filter((a) => platform.isVerified(a.id)).length,
        newWeek: people.filter((a) => a.createdAt && today - a.createdAt < 7 * 86400_000).length,
      },
      deals: { total: deals.length, active: dealsBy("active"), funding: dealsBy("funding"), completed: dealsBy("completed"), cancelled: dealsBy("cancelled"), disputed },
      money: { reserved: sums.reduce((a, x) => a + x.reserved, 0), paid: volume("payout"), refunded: volume("refund"), fees: volume("fee"), topups: volume("topup") },
      queue: {
        projects: platform.projects().filter((p) => p.status === "review").length,
        verifications: platform.verifications().filter((v) => v.status === "pending").length,
        disputes: disputed,
      },
      series,
      recent: s.ledger.slice(-8).reverse().map((e) => ({ id: e.id, at: e.at, type: e.type, amount: e.amount, user: brief(e.userId).name, dealTitle: e.dealId ? s.deals[e.dealId]?.title : undefined })),
    };
  });

  // ───────── операции участников ─────────

  app.get("/admin/transactions", async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const q = z
      .object({
        type: z.enum(["topup", "reserve", "payout", "refund", "fee"]).optional(),
        userId: z.string().max(60).optional(),
        dealId: z.string().max(80).optional(),
        q: z.string().trim().max(80).optional(),
        before: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const s = c.getState();
    const text = q.q?.toLowerCase();
    const out: unknown[] = [];
    let total = 0;
    let count = 0;
    let next: number | null = null;
    for (let i = s.ledger.length - 1; i >= 0; i--) {
      const e = s.ledger[i]!;
      if (q.type && e.type !== q.type) continue;
      if (q.userId && e.userId !== q.userId) continue;
      if (q.dealId && e.dealId !== q.dealId) continue;
      const name = brief(e.userId).name;
      const title = e.dealId ? s.deals[e.dealId]?.title : undefined;
      if (text && !`${name} ${title ?? ""} ${e.note ?? ""}`.toLowerCase().includes(text)) continue;
      total += e.amount;
      count++;
      if (q.before !== undefined && e.id >= q.before) continue;
      if (out.length >= q.limit) {
        next ??= (out.at(-1) as { id: number }).id;
        continue;
      }
      out.push({ id: e.id, at: e.at, type: e.type, amount: e.amount, userId: e.userId, userName: name, dealId: e.dealId, dealTitle: title, stageId: e.stageId, note: e.note });
    }
    return { items: out, next, count, total };
  });

  // ───────── споры ─────────

  const disputeItem = (d: Deal, st: Deal["stages"][number]) => ({
    dealId: d.id,
    dealTitle: d.title,
    stageId: st.id,
    stageTitle: st.title,
    amount: st.amount,
    reason: st.disputeReason,
    openedAt: st.disputedAt,
    deadline: st.disputedAt !== undefined && d.disputeMs ? st.disputedAt + d.disputeMs : undefined,
    messages: st.messages?.length ?? 0,
    executor: brief(d.executorId),
    owner: d.ownerId ? brief(d.ownerId) : undefined,
    arbiter: d.arbiterId ? brief(d.arbiterId) : undefined,
    resolution: st.resolution,
  });

  app.get("/admin/disputes", async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const { status } = z.object({ status: z.enum(["open", "resolved"]).default("open") }).parse(req.query);
    const items = Object.values(c.getState().deals).flatMap((d) =>
      d.stages
        .filter((st) => (status === "open" ? st.status === "disputed" : st.disputedAt !== undefined && st.resolution !== undefined))
        .map((st) => disputeItem(d, st)),
    );
    return items
      .sort((a, b) => (status === "open" ? (a.deadline ?? a.openedAt ?? 0) - (b.deadline ?? b.openedAt ?? 0) : (b.resolution?.at ?? 0) - (a.resolution?.at ?? 0)))
      .slice(0, 200);
  });

  // ───────── подтверждение компаний ─────────

  const verificationItem = (v: ReturnType<typeof platform.verifications>[number]) => ({
    ...v,
    user: brief(v.userId),
    kind: dir.get(v.userId)?.kind,
    fns: dir.authorOf(v.userId)?.fns ?? null,
    decidedByName: v.decidedBy ? brief(v.decidedBy).name : undefined,
  });

  app.get("/admin/verifications", async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const { status } = z.object({ status: z.enum(["pending", "approved", "rejected"]).default("pending") }).parse(req.query);
    return platform
      .verifications()
      .filter((v) => v.status === status)
      .map(verificationItem)
      .sort((a, b) => (status === "pending" ? a.at - b.at : (b.decidedAt ?? 0) - (a.decidedAt ?? 0)));
  });

  app.post("/admin/verifications/:id/decision", async (req, reply) => {
    const me = adminOnly(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ action: z.enum(["approve", "reject"]), comment: z.string().trim().max(1000).optional(), acknowledgeFns: z.boolean().optional() }).parse(req.body);
    const found = platform.verifications().find((x) => x.id === id);
    const fnsNow = found ? dir.authorOf(found.userId)?.fns : undefined;
    if (b.action === "approve" && fnsNow?.status === "mismatch" && !b.acknowledgeFns) return reply.code(400).send({ error: `ФНС не подтвердила данные: ${fnsNow.detail}. Подтвердить можно, только отметив, что вы это учли`, fns: fnsNow });
    const v = await platform.decideVerification(id, me, b.action, b.comment);
    await platform.logAudit(me, b.action === "approve" ? "Данные компании подтверждены" : "В подтверждении отказано", v.userId, brief(v.userId).name);
    hub.send([v.userId], "notify", {
      dealId: "",
      text: b.action === "approve" ? "Ваши данные подтверждены: в профиле отображается отметка «Проверено»" : `В подтверждении данных отказано: ${v.comment}`,
    });
    hub.send([v.userId, ...admins()], "changed", {});
    return verificationItem(v);
  });

  app.post("/admin/verifications/:id/fns", async (req, reply) => {
    const me = adminOnly(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const v = platform.verifications().find((x) => x.id === id);
    const author = v ? dir.authorOf(v.userId) : undefined;
    if (!v || !author) return reply.code(404).send({ error: "Анкета не найдена" });
    const fns = await c.fns(author);
    await dir.setAuthor(v.userId, { ...author, fns });
    await platform.logAudit(me, "Повторная сверка с ФНС", v.userId, `${fns.status}: ${fns.detail}`.slice(0, 190));
    return fns;
  });

  // ───────── участники ─────────

  app.get("/admin/users", async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const q = z.object({ q: z.string().trim().max(60).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(req.query);
    const s = c.getState();
    const text = q.q?.toLowerCase();
    const dealsOf = new Map<string, number>();
    for (const d of Object.values(s.deals)) for (const id of new Set([d.executorId, d.ownerId].filter((x): x is string => !!x))) dealsOf.set(id, (dealsOf.get(id) ?? 0) + 1);
    return dir
      .accounts()
      .filter((a) => a.role !== "arbiter" || a.demo === false)
      .filter((a) => !text || `${a.name} ${a.phone ?? ""}`.toLowerCase().includes(text))
      .map((a) => ({
        ...a,
        verified: platform.isVerified(a.id),
        ...platform.ratingOf(a.id),
        deals: dealsOf.get(a.id) ?? 0,
        free: s.wallets[a.id] ?? 0,
        reserved: Object.values(s.deals).reduce((sum, d) => sum + (d.reserves[a.id] ?? 0), 0),
      }))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, q.limit);
  });

  // сброс ключей приложения: участник или администратор потерял устройство и создаст новый ключ при следующем входе
  app.post("/admin/users/:id/keys/reset", async (req, reply) => {
    const me = adminOnly(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string().max(80) }).parse(req.params);
    if (!dir.get(id)) return reply.code(404).send({ error: "Участник не найден" });
    if (id === me) return reply.code(400).send({ error: "Свои ключи отзываются в профиле" });
    const active = dir.keysOf(id).filter((k) => !k.revokedAt);
    for (const k of active) await dir.revokeKey(id, k.id, Date.now());
    await dir.revokeSessions(id, Date.now());
    await platform.logAudit(me, "Сброс ключей приложения", id, `ключей: ${active.length}`);
    return { revoked: active.length };
  });

  // сброс кода доступа администратора: код утерян, при следующем входе администратор создаст новый
  app.post("/admin/users/:id/admin-code/reset", async (req, reply) => {
    const me = adminOnly(req, reply);
    if (!me) return;
    const { id } = z.object({ id: z.string().max(80) }).parse(req.params);
    if (!dir.get(id)) return reply.code(404).send({ error: "Участник не найден" });
    if (id === me) return reply.code(400).send({ error: "Свой код сбрасывает другой администратор" });
    await dir.setAdminCode(id, undefined);
    await dir.revokeSessions(id, Date.now());
    await platform.logAudit(me, "Сброс кода доступа администратора", id);
    return { ok: true };
  });
}
