export type Role = "customer" | "executor" | "sponsor" | "funder" | "arbiter" | "user";

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
  { id: "expert", name: "Независимый приёмщик", role: "arbiter", startBalance: 0 },
];

/** Зарегистрированный пользователь: одна учётная запись на все роли, роль определяет сделка. */
export interface RegisteredUser {
  id: string;
  phone: string;
  name: string;
  createdAt: number;
}

export interface PublicAccount {
  id: string;
  name: string;
  role: Role;
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
    /** при DEMO_MODE=off демо-аккаунты не входят и не ищутся, но приёмщик споров нужен всегда */
    private demo = true,
  ) {
    for (const r of initial) this.registered.set(r.id, r);
  }

  get(id: string): PublicAccount | undefined {
    const d = DEMO_USERS.find((x) => x.id === id);
    if (d && (this.demo || d.role === "arbiter")) return { id: d.id, name: d.name, role: d.role };
    const r = this.registered.get(id);
    return r ? { id: r.id, name: r.name, role: "user" } : undefined;
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

  async register(phone: string, name: string, at: number): Promise<RegisteredUser> {
    const user: RegisteredUser = { id: `u_${at.toString(36)}${Math.random().toString(36).slice(2, 7)}`, phone, name, createdAt: at };
    this.registered.set(user.id, user);
    await this.persist([...this.registered.values()]);
    return user;
  }

  async rename(id: string, name: string) {
    const r = this.registered.get(id);
    if (!r) return false;
    r.name = name;
    await this.persist([...this.registered.values()]);
    return true;
  }

  /** Поиск исполнителя: точный номер или начало имени (от 3 букв). Демо-аккаунты показываются только в демо-режиме. */
  search(q: string, exceptId: string): { id: string; name: string; phone?: string }[] {
    const phone = normalizePhone(q);
    const needle = q.trim().toLowerCase();
    const pool: { id: string; name: string; phone?: string }[] = [
      ...this.demoUsers().filter((u) => u.role !== "arbiter").map((u) => ({ id: u.id, name: u.name })),
      ...[...this.registered.values()].map((r) => ({ id: r.id, name: r.name, phone: r.phone })),
    ];
    return pool
      .filter((u) => u.id !== exceptId)
      .filter((u) => (phone ? u.phone === phone : needle.length >= 3 && u.name.toLowerCase().includes(needle)))
      .slice(0, 8)
      .map((u) => ({ id: u.id, name: u.name, phone: u.phone ? maskPhone(u.phone) : undefined }));
  }
}
