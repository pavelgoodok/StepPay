export type Role = "customer" | "executor" | "sponsor" | "funder" | "arbiter" | "user" | "admin";

export interface User {
  id: string;
  name: string;
  role: Role;
  /** стартовый баланс демо-кошелька, ₽ */
  startBalance: number;
}

/** Демо-пользователи: вход в один клик, без паролей. */
export const DEMO_USERS: User[] = [
  { id: "anna", name: "Анна Смирнова", role: "customer", startBalance: 300_000 },
  { id: "ivan", name: "Иван Петров", role: "executor", startBalance: 0 },
  { id: "olga", name: "Ольга Н.", role: "sponsor", startBalance: 1_000_000 },
  { id: "max", name: "Максим К.", role: "sponsor", startBalance: 1_000_000 },
  { id: "games", name: "Студия «Кубик»", role: "executor", startBalance: 0 },
  { id: "studio", name: "ФинТех Студия", role: "executor", startBalance: 0 },
  { id: "tsj", name: "ТСЖ «Липки»", role: "executor", startBalance: 0 },
  { id: "fond", name: "Фонд «Развитие»", role: "funder", startBalance: 2_000_000 },
  { id: "expert", name: "Независимый приемщик", role: "arbiter", startBalance: 0 },
  { id: "expert2", name: "Запасной приемщик", role: "arbiter", startBalance: 0 },
  { id: "admin", name: "Администратор платформы", role: "admin", startBalance: 0 },
];

/** Зарегистрированный пользователь: одна учетная запись на все роли, роль определяет сделка. */
export type LegalStatus = "person" | "selfemployed" | "ip" | "org";

/** Анкета автора проектов: заполняется один раз и проверяется при подаче проекта. */
export interface AuthorProfile {
  legalStatus: LegalStatus;
  inn: string;
  orgName?: string;
  email?: string;
  /** результат сверки с ФНС */
  fns?: import("./fns").FnsCheck;
}

import type { DeviceKey } from "./devicekeys";

export interface RegisteredUser {
  id: string;
  phone: string;
  name: string;
  /** проверенный грантодатель: может финансировать проекты целиком */
  grantor?: boolean;
  /** независимый приемщик споров из реестра: назначается администратором */
  arbiter?: boolean;
  author?: AuthorProfile;
  /** анкета автора в зашифрованном виде (в базе открытой анкеты нет) */
  authorEnc?: string;
  /** токены, выданные не позже этого момента, отозваны */
  sessionsFrom?: number;
  /** ключи подписи на устройствах */
  keys?: DeviceKey[];
  /** ссылка вида /uploads/... на аватарку */
  avatar?: string;
  /** кем человек зарегистрировался: ищет исполнителя или сам исполнитель; права это не меняет */
  kind?: "customer" | "executor";
  createdAt: number;
}

export interface PublicAccount {
  id: string;
  name: string;
  role: Role;
  avatar?: string;
  grantor?: boolean;
  arbiter?: boolean;
  kind?: "customer" | "executor";
}

/** Приводит российский номер к виду +79991234567; null, если это не номер. */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "7" || d[0] === "8") && d[1] === "9") return `+7${d.slice(1)}`;
  if (d.length === 10 && d[0] === "9") return `+7${d}`;
  return null;
}

export const maskPhone = (p: string) => `${p.slice(0, 2)} ${p.slice(2, 5)} ***-**-${p.slice(-2)}`;

/** Каталог: демо-пользователи (всегда в памяти) и зарегистрированные (хранятся в базе). */
export class Directory {
  private registered = new Map<string, RegisteredUser>();
  constructor(
    private persist: (users: RegisteredUser[]) => Promise<void>,
    initial: RegisteredUser[] = [],
    /** при DEMO_MODE=off демо-аккаунты не входят и не ищутся, но приемщик споров нужен всегда */
    private demo = true,
    /** телефоны администраторов (переменная ADMIN_PHONES) */
    private adminPhones: string[] = [],
  ) {
    for (const r of initial) this.registered.set(r.id, r);
  }

  /** Подставляет пользователей, перечитанных из базы после изменений другого экземпляра. */
  replace(users: RegisteredUser[]) {
    this.registered = new Map(users.map((u) => [u.id, u]));
  }

  get(id: string): PublicAccount | undefined {
    const d = DEMO_USERS.find((x) => x.id === id);
    if (d && (this.demo || d.role === "arbiter")) return { id: d.id, name: d.name, role: d.role, grantor: d.role === "funder" || undefined, arbiter: d.role === "arbiter" || undefined, kind: this.demoKinds.get(id) ?? (d.role === "executor" ? "executor" : "customer") };
    const r = this.registered.get(id);
    if (!r) return undefined;
    return { id: r.id, name: r.name, role: this.adminPhones.includes(r.phone) ? "admin" : "user", avatar: r.avatar, grantor: r.grantor, arbiter: r.arbiter, kind: r.kind ?? "customer" };
  }

  private demoSessionsFrom = new Map<string, number>();
  private demoKinds = new Map<string, "customer" | "executor">();

  /** Переключение между личным (заказчик) и профессиональным (исполнитель) аккаунтом: один вход, два режима работы. */
  async setKind(id: string, kind: "customer" | "executor") {
    const r = this.registered.get(id);
    if (r) {
      r.kind = kind;
      await this.persist([...this.registered.values()]);
    } else if (this.get(id)) this.demoKinds.set(id, kind);
    else return false;
    return true;
  }

  sessionsFrom(id: string): number {
    return this.registered.get(id)?.sessionsFrom ?? this.demoSessionsFrom.get(id) ?? 0;
  }

  /** Завершает все сессии пользователя: ранее выданные токены перестают действовать. */
  async revokeSessions(id: string, at: number) {
    const r = this.registered.get(id);
    if (r) {
      r.sessionsFrom = at;
      await this.persist([...this.registered.values()]);
    } else this.demoSessionsFrom.set(id, at);
  }

  /** Ключи подписи. У демо-аккаунтов хранятся в памяти и пропадают при перезапуске. */
  private demoKeys = new Map<string, DeviceKey[]>();

  keysOf(id: string): DeviceKey[] {
    return this.registered.get(id)?.keys ?? this.demoKeys.get(id) ?? [];
  }

  activeKey(id: string, keyId: string): DeviceKey | undefined {
    return this.keysOf(id).find((k) => k.id === keyId && !k.revokedAt);
  }

  hasActiveKey(id: string): boolean {
    return this.keysOf(id).some((k) => !k.revokedAt);
  }

  async addKey(id: string, key: DeviceKey) {
    const r = this.registered.get(id);
    if (r) {
      r.keys = [...(r.keys ?? []), key];
      await this.persist([...this.registered.values()]);
    } else this.demoKeys.set(id, [...(this.demoKeys.get(id) ?? []), key]);
  }

  async revokeKey(id: string, keyId: string, at: number): Promise<boolean> {
    const list = this.keysOf(id);
    const k = list.find((x) => x.id === keyId && !x.revokedAt);
    if (!k) return false;
    k.revokedAt = at;
    if (this.registered.has(id)) await this.persist([...this.registered.values()]);
    return true;
  }

  isAdmin(id: string) {
    return this.get(id)?.role === "admin";
  }

  isGrantor(id: string) {
    return !!this.get(id)?.grantor;
  }

  /** Приемщик из реестра: демо-приемщик или пользователь, которому администратор дал эту роль. */
  isArbiter(id: string) {
    return !!this.get(id)?.arbiter;
  }

  async setArbiter(id: string, value: boolean) {
    const r = this.registered.get(id);
    if (!r) return false;
    r.arbiter = value || undefined;
    await this.persist([...this.registered.values()]);
    return true;
  }

  async setGrantor(id: string, value: boolean) {
    const r = this.registered.get(id);
    if (!r) return false;
    r.grantor = value || undefined;
    await this.persist([...this.registered.values()]);
    return true;
  }

  /** анкеты демо-аккаунтов не хранятся в базе */
  private demoAuthors = new Map<string, AuthorProfile>();

  authorOf(id: string) {
    return this.registered.get(id)?.author ?? this.demoAuthors.get(id);
  }

  async setAuthor(id: string, author: AuthorProfile) {
    const r = this.registered.get(id);
    if (!r) {
      if (!this.demo || !DEMO_USERS.some((u) => u.id === id)) return false;
      this.demoAuthors.set(id, author);
      return true;
    }
    r.author = author;
    await this.persist([...this.registered.values()]);
    return true;
  }

  demoUsers(): PublicAccount[] {
    return this.demo ? DEMO_USERS.map(({ id, name, role }) => ({ id, name, role })) : [];
  }

  allIds(): string[] {
    return [...(this.demo ? DEMO_USERS.map((u) => u.id) : []), ...this.registered.keys()];
  }

  byPhone(phone: string) {
    return [...this.registered.values()].find((r) => r.phone === phone);
  }

  phoneOf(id: string) {
    return this.registered.get(id)?.phone;
  }

  async register(phone: string, name: string, at: number, kind: "customer" | "executor" = "customer"): Promise<RegisteredUser> {
    const user: RegisteredUser = { id: `u_${at.toString(36)}${Math.random().toString(36).slice(2, 7)}`, phone, name, kind, createdAt: at };
    this.registered.set(user.id, user);
    await this.persist([...this.registered.values()]);
    return user;
  }

  async updateProfile(id: string, patch: { name?: string; avatar?: string | null }) {
    const r = this.registered.get(id);
    if (!r) return false;
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.avatar !== undefined) r.avatar = patch.avatar ?? undefined;
    await this.persist([...this.registered.values()]);
    return true;
  }

  /** Поиск исполнителя: точный номер или начало имени (от 3 букв). Демо-аккаунты показываются только в демо-режиме. */
  search(q: string, exceptId: string): { id: string; name: string; phone?: string }[] {
    const phone = normalizePhone(q);
    const needle = q.trim().toLowerCase();
    const pool: { id: string; name: string; phone?: string }[] = [
      ...this.demoUsers().filter((u) => u.role !== "arbiter" && u.role !== "admin").map((u) => ({ id: u.id, name: u.name })),
      ...[...this.registered.values()].map((r) => ({ id: r.id, name: r.name, phone: r.phone })),
    ];
    return pool
      .filter((u) => u.id !== exceptId)
      .filter((u) => (phone ? u.phone === phone : needle.length >= 3 && u.name.toLowerCase().includes(needle)))
      .slice(0, 8)
      .map((u) => ({ id: u.id, name: u.name, phone: u.phone ? maskPhone(u.phone) : undefined }));
  }
}
