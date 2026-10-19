import type { Person } from "./api";

export interface AdminDashboard {
  users: { total: number; executors: number; customers: number; verified: number; newWeek: number };
  deals: { total: number; active: number; funding: number; completed: number; cancelled: number; disputed: number };
  money: { reserved: number; paid: number; refunded: number; fees: number; topups: number };
  queue: { projects: number; verifications: number; disputes: number };
  series: { day: string; topup: number; payout: number; deals: number }[];
  recent: { id: number; at: number; type: string; amount: number; user: string; dealTitle?: string }[];
}

export interface AdminTx {
  id: number;
  at: number;
  type: string;
  amount: number;
  userId: string;
  userName: string;
  dealId?: string;
  dealTitle?: string;
  stageId?: string;
  note?: string;
}

export interface AdminDispute {
  dealId: string;
  dealTitle: string;
  stageId: string;
  stageTitle: string;
  amount: number;
  reason?: string;
  openedAt?: number;
  deadline?: number;
  messages: number;
  executor: Person;
  owner?: Person;
  arbiter?: Person;
  resolution?: { by: string; decision: "accepted" | "failed"; comment?: string; at: number };
}

export interface AdminVerification {
  id: string;
  userId: string;
  legalStatus: "person" | "selfemployed" | "ip" | "org";
  inn: string;
  orgName?: string;
  email?: string;
  status: "pending" | "approved" | "rejected";
  at: number;
  decidedAt?: number;
  decidedByName?: string;
  comment?: string;
  user: Person;
  kind?: "customer" | "executor";
  fns: { status: "match" | "mismatch" | "unavailable" | "none"; checkedAt: number; source: string; name?: string; detail: string } | null;
}

export interface AdminUser {
  id: string;
  name: string;
  role: string;
  kind?: "customer" | "executor";
  grantor: boolean;
  arbiter: boolean;
  phone?: string;
  createdAt?: number;
  demo: boolean;
  verified: boolean;
  rating: number | null;
  reviews: number;
  deals: number;
  free: number;
  reserved: number;
}

export const LEGAL_LABEL: Record<string, string> = { person: "Физическое лицо", selfemployed: "Самозанятый", ip: "Индивидуальный предприниматель", org: "Организация" };
export const RESOLVED_BY: Record<string, string> = { owner: "Заказчик", votes: "Голосование", auto: "Автоприемка", arbiter: "Приемщик", expired: "Истек срок" };

export const dateTime = (ts: number) =>
  new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
