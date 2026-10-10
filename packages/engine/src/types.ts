/** Все суммы — в копейках (целые числа). */
export type Money = number;
export type UserId = string;

export type Mode = "own" | "crowdfunding" | "grant";

export type StageStatus =
  | "pending" // ждёт своей очереди
  | "active" // исполнитель работает
  | "submitted" // сдан, ждёт приёмки
  | "accepted" // принят, деньги выплачены
  | "disputed" // спор, деньги заморожены
  | "failed"; // провален, остаток возвращён

export type DealStatus = "funding" | "active" | "completed" | "cancelled";

export interface Stage {
  id: string;
  title: string;
  amount: Money;
  criteria: string[];
  status: StageStatus;
  submittedAt?: number;
  evidence?: { note?: string; photos?: string[] };
  /** голоса спонсоров (только краудфандинг) */
  votes: Record<UserId, "accept" | "reject">;
  disputeReason?: string;
}

export interface Deal {
  id: string;
  mode: Mode;
  title: string;
  executorId: UserId;
  /** own: заказчик, grant: грантодатель, crowdfunding: не задан (голосование) */
  ownerId?: UserId;
  /** независимый приёмщик для споров */
  arbiterId?: UserId;
  stages: Stage[];
  target: Money;
  status: DealStatus;
  /** сколько ещё зарезервировано каждым плательщиком */
  reserves: Record<UserId, Money>;
  /** сколько внесено в сумме (для весов голосования и пропорционального возврата) */
  contributed: Record<UserId, Money>;
  autoAcceptMs: number;
  feeBps: number;
  createdAt: number;
}

export type LedgerType = "topup" | "reserve" | "payout" | "refund" | "fee";

export interface LedgerEntry {
  id: number;
  at: number;
  type: LedgerType;
  userId: UserId;
  dealId?: string;
  stageId?: string;
  /** положительное число; направление определяет type */
  amount: Money;
  note?: string;
}

export interface State {
  /** свободные деньги */
  wallets: Record<UserId, Money>;
  deals: Record<string, Deal>;
  ledger: LedgerEntry[];
}

export const PLATFORM_ID = "platform";
export const DAY_MS = 24 * 60 * 60 * 1000;
