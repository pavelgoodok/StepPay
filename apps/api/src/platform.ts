import type { MirrorData } from "./chain";
import { randomUUID } from "node:crypto";
import type { Anchor } from "@steppay/engine";

/** Проекты (краудфандинг и гранты, с проверкой), карточки услуг и личные чаты. Деньгами не занимается: это делает движок сделок. */

export const SERVICE_CATEGORIES = ["Ремонт и строительство", "Разработка и дизайн", "Мероприятия", "Обучение", "Красота и здоровье", "Другое"];
export const PROJECT_CATEGORIES = ["Игры", "Музыка и творчество", "Технологии", "Образование", "Городская среда", "Социальные проекты", "Другое"];

export type ProjectKind = "crowdfunding" | "grant";
export type ProjectStatus = "draft" | "review" | "changes" | "approved" | "rejected";

export interface ProjectDoc {
  id: string;
  name: string;
  /** ссылка вида /uploads/... */
  url: string;
  kind: "photo" | "doc";
}

export interface ProjectStage {
  title: string;
  amount: number;
  criteria: string[];
}

export interface ReviewEvent {
  at: number;
  by: string;
  action: "submit" | "resubmit" | "approve" | "reject" | "changes";
  comment?: string;
}

export interface Project {
  id: string;
  ownerId: string;
  kind: ProjectKind;
  title: string;
  summary: string;
  description: string;
  category: string;
  stages: ProjectStage[];
  docs: ProjectDoc[];
  status: ProjectStatus;
  history: ReviewEvent[];
  /** сделка в движке: у краудфандинга создается при одобрении, у гранта при финансировании */
  dealId?: string;
  funderId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Service {
  id: string;
  ownerId: string;
  title: string;
  category: string;
  description: string;
  /** цена от, в копейках */
  priceFrom?: number;
  photos: string[];
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  by: string;
  text: string;
  at: number;
  kind: "text" | "system";
  dealId?: string;
}

export interface Thread {
  id: string;
  serviceId: string;
  customerId: string;
  executorId: string;
  messages: ChatMessage[];
  read: Record<string, number>;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEvent {
  at: number;
  by: string;
  action: string;
  target?: string;
  detail?: string;
}

export interface PlatformData {
  projects: Project[];
  services: Service[];
  threads: Thread[];
  /** действия администраторов и доступ к закрытым данным */
  audit?: AuditEvent[];
  /** якоря истории и куда их опубликовали */
  anchors?: Anchor[];
  anchorPubs?: Record<number, AnchorPub[]>;
  /** перенос сделок на контракт в тестовой сети: что уже перенесено и хеши транзакций */
  mirror?: MirrorData;
  /** уведомления по участникам и время, до которого они прочитаны */
  notes?: Record<string, Note[]>;
  notesSeen?: Record<string, number>;
}

export interface Note {
  id: string;
  at: number;
  text: string;
  dealId: string;
}

export interface AnchorPub {
  at: number;
  target: string;
  ok: boolean;
  /** ссылка или номер записи во внешнем месте */
  ref?: string;
  error?: string;
}

export class PlatformError extends Error {}
const fail = (m: string): never => {
  throw new PlatformError(m);
};

export interface ProjectInput {
  kind: ProjectKind;
  title: string;
  summary: string;
  description: string;
  category: string;
  stages: ProjectStage[];
  docs: ProjectDoc[];
}

export interface ServiceInput {
  title: string;
  category: string;
  description: string;
  priceFrom?: number;
  photos: string[];
}

export const projectGoal = (p: Pick<Project, "stages">) => p.stages.reduce((a, s) => a + s.amount, 0);

/** Что должно быть заполнено, чтобы отправить проект на проверку. Возвращает список замечаний. */
export function projectProblems(p: Project): string[] {
  const out: string[] = [];
  if (p.title.trim().length < 3) out.push("Укажите название проекта");
  if (p.summary.trim().length < 20) out.push("Краткое описание от 20 символов");
  if (p.description.trim().length < 100) out.push("Подробное описание от 100 символов: что делаете, для кого и зачем");
  if (p.stages.length === 0) out.push("Добавьте хотя бы один этап с суммой");
  if (projectGoal(p) <= 0) out.push("Сумма проекта должна быть больше нуля");
  if (!p.docs.some((d) => d.kind === "photo")) out.push("Приложите хотя бы одно фото проекта");
  if (!p.docs.some((d) => d.kind === "doc")) out.push("Приложите подтверждающий документ: смету, план или договор");
  return out;
}

export class Platform {
  /** Данные переноса на контракт: создаются при первом обращении, момент включения запоминается. */
  mirrorData(): MirrorData {
    return (this.data.mirror ??= { since: this.now(), deals: {} });
  }

  async addNotes(userIds: string[], text: string, dealId: string) {
    const notes = (this.data.notes ??= {});
    const at = this.now();
    for (const u of userIds) {
      const list = (notes[u] ??= []);
      list.push({ id: this.id("n"), at, text, dealId });
      if (list.length > 100) list.splice(0, list.length - 100);
    }
    await this.save();
  }

  notesOf(userId: string): { items: Note[]; unread: number } {
    const seen = this.data.notesSeen?.[userId] ?? 0;
    const items = [...(this.data.notes?.[userId] ?? [])].reverse();
    return { items, unread: items.filter((n) => n.at > seen).length };
  }

  async markNotesSeen(userId: string) {
    (this.data.notesSeen ??= {})[userId] = this.now();
    await this.save();
  }

  saveMirror() {
    return this.save();
  }

  constructor(
    private data: PlatformData,
    private persist: (d: PlatformData) => Promise<void>,
    private now: () => number,
  ) {}

  private save() {
    return this.persist(this.data);
  }

  private id(prefix: string) {
    return `${prefix}_${randomUUID().slice(0, 8)}`;
  }

  /** Записывает действие администратора или доступ к закрытым данным. Хранятся последние 1000 записей. */
  async logAudit(by: string, action: string, target?: string, detail?: string) {
    const list = (this.data.audit ??= []);
    list.push({ at: this.now(), by, action, ...(target ? { target } : {}), ...(detail ? { detail: detail.slice(0, 200) } : {}) });
    if (list.length > 1000) list.splice(0, list.length - 1000);
    await this.save();
  }

  anchors(): Anchor[] {
    return this.data.anchors ?? [];
  }

  anchorPubs(n: number): AnchorPub[] {
    return this.data.anchorPubs?.[n] ?? [];
  }

  async addAnchor(a: Anchor) {
    (this.data.anchors ??= []).push(a);
    await this.save();
  }

  async addAnchorPub(n: number, pub: AnchorPub) {
    const all = (this.data.anchorPubs ??= {});
    all[n] = [...(all[n] ?? []), pub].slice(-10);
    await this.save();
  }

  /** Демо-данные удалены или сброшены: якоря к ним больше не относятся. */
  async clearAnchors() {
    this.data.anchors = [];
    this.data.anchorPubs = {};
    await this.save();
  }

  auditLog(): AuditEvent[] {
    return [...(this.data.audit ?? [])].reverse();
  }

  get snapshot() {
    return this.data;
  }

  isEmpty() {
    return this.data.projects.length + this.data.services.length + this.data.threads.length === 0;
  }

  /** Заменяет все данные (сброс демо). */
  async reset(data: PlatformData) {
    this.data = data;
    await this.save();
  }

  /** Убирает проекты, услуги и чаты демо-аккаунтов. Возвращает true, если что-то удалено. */
  async purgeDemo(demoIds: Set<string>, dealGone: (dealId: string) => boolean) {
    const before = this.data.projects.length + this.data.services.length + this.data.threads.length;
    this.data.projects = this.data.projects.filter((p) => !demoIds.has(p.ownerId) && !(p.dealId && dealGone(p.dealId)));
    this.data.services = this.data.services.filter((s) => !demoIds.has(s.ownerId));
    this.data.threads = this.data.threads.filter((t) => !demoIds.has(t.customerId) && !demoIds.has(t.executorId));
    const changed = before !== this.data.projects.length + this.data.services.length + this.data.threads.length;
    if (changed) await this.save();
    return changed;
  }

  // ── проекты ──

  project(id: string) {
    return this.data.projects.find((p) => p.id === id);
  }

  projects() {
    return this.data.projects;
  }

  async createProject(ownerId: string, input: ProjectInput): Promise<Project> {
    const t = this.now();
    const p: Project = { id: this.id("p"), ownerId, ...input, status: "draft", history: [], createdAt: t, updatedAt: t };
    this.data.projects.push(p);
    await this.save();
    return p;
  }

  /** Править можно черновик и проект, возвращенный на доработку. */
  async updateProject(id: string, ownerId: string, patch: Partial<ProjectInput>): Promise<Project> {
    const p = this.project(id) ?? fail("Проект не найден");
    if (p.ownerId !== ownerId) fail("Это не ваш проект");
    if (p.status !== "draft" && p.status !== "changes") fail("Проект на проверке или уже рассмотрен, править его нельзя");
    Object.assign(p, patch, { updatedAt: this.now() });
    await this.save();
    return p;
  }

  async submitProject(id: string, ownerId: string): Promise<Project> {
    const p = this.project(id) ?? fail("Проект не найден");
    if (p.ownerId !== ownerId) fail("Это не ваш проект");
    if (p.status !== "draft" && p.status !== "changes") fail("Проект уже отправлен");
    const problems = projectProblems(p);
    if (problems.length) fail(problems[0]!);
    p.history.push({ at: this.now(), by: ownerId, action: p.status === "changes" ? "resubmit" : "submit" });
    p.status = "review";
    p.updatedAt = this.now();
    await this.save();
    return p;
  }

  async decide(id: string, adminId: string, action: "approve" | "reject" | "changes", comment?: string): Promise<Project> {
    const p = this.project(id) ?? fail("Проект не найден");
    if (p.status !== "review") fail("Проект не ждет проверки");
    if (action !== "approve" && !comment?.trim()) fail("Напишите автору причину решения");
    p.status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "changes";
    p.history.push({ at: this.now(), by: adminId, action, comment: comment?.trim() || undefined });
    p.updatedAt = this.now();
    await this.save();
    return p;
  }

  async linkDeal(id: string, dealId: string, funderId?: string) {
    const p = this.project(id) ?? fail("Проект не найден");
    p.dealId = dealId;
    if (funderId) p.funderId = funderId;
    p.updatedAt = this.now();
    await this.save();
  }

  /** Вставляет готовый проект (для демо-данных). */
  async seedProject(p: Project) {
    this.data.projects.push(p);
    await this.save();
  }

  // ── услуги ──

  service(id: string) {
    return this.data.services.find((s) => s.id === id);
  }

  services() {
    return this.data.services;
  }

  async createService(ownerId: string, input: ServiceInput): Promise<Service> {
    const t = this.now();
    const s: Service = { id: this.id("s"), ownerId, ...input, active: true, createdAt: t, updatedAt: t };
    this.data.services.push(s);
    await this.save();
    return s;
  }

  async updateService(id: string, ownerId: string, patch: Partial<ServiceInput> & { active?: boolean }): Promise<Service> {
    const s = this.service(id) ?? fail("Услуга не найдена");
    if (s.ownerId !== ownerId) fail("Это не ваша услуга");
    Object.assign(s, patch, { updatedAt: this.now() });
    await this.save();
    return s;
  }

  async removeService(id: string, ownerId: string) {
    const s = this.service(id) ?? fail("Услуга не найдена");
    if (s.ownerId !== ownerId) fail("Это не ваша услуга");
    // чаты и сделки по услуге остаются, поэтому карточку только скрываем
    s.active = false;
    s.updatedAt = this.now();
    await this.save();
  }

  async seedService(s: Service) {
    this.data.services.push(s);
    await this.save();
  }

  // ── чаты ──

  thread(id: string) {
    return this.data.threads.find((t) => t.id === id);
  }

  threadsOf(userId: string) {
    return this.data.threads.filter((t) => t.customerId === userId || t.executorId === userId).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Заказчик открывает чат с исполнителем по его услуге; повторное обращение возвращает тот же чат. */
  async openThread(serviceId: string, customerId: string): Promise<Thread> {
    const s = this.service(serviceId) ?? fail("Услуга не найдена");
    if (!s.active) fail("Услуга сейчас недоступна");
    if (s.ownerId === customerId) fail("Это ваша собственная услуга");
    const existing = this.data.threads.find((t) => t.serviceId === serviceId && t.customerId === customerId);
    if (existing) return existing;
    const t = this.now();
    const th: Thread = { id: this.id("c"), serviceId, customerId, executorId: s.ownerId, messages: [], read: { [customerId]: t }, createdAt: t, updatedAt: t };
    this.data.threads.push(th);
    await this.save();
    return th;
  }

  async post(threadId: string, userId: string, text: string, kind: ChatMessage["kind"] = "text", dealId?: string): Promise<ChatMessage> {
    const th = this.thread(threadId) ?? fail("Чат не найден");
    if (kind === "text" && userId !== th.customerId && userId !== th.executorId) fail("Нет доступа к чату");
    const t = this.now();
    const m: ChatMessage = { id: this.id("m"), by: userId, text, at: t, kind, dealId };
    th.messages.push(m);
    if (th.messages.length > 1000) th.messages.splice(0, th.messages.length - 1000);
    th.updatedAt = t;
    th.read[userId] = t;
    await this.save();
    return m;
  }

  async markRead(threadId: string, userId: string) {
    const th = this.thread(threadId);
    if (!th || (userId !== th.customerId && userId !== th.executorId)) return;
    th.read[userId] = this.now();
    await this.save();
  }

  unread(th: Thread, userId: string) {
    const since = th.read[userId] ?? 0;
    return th.messages.filter((m) => m.at > since && m.by !== userId).length;
  }
}
