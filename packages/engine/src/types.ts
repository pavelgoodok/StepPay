/** Все суммы - в копейках (целые числа). */
export type Money = number;
export type UserId = string;

export type Mode = "own" | "crowdfunding" | "grant";

export type StageStatus =
  | "pending" // ждет своей очереди
  | "active" // исполнитель работает
  | "submitted" // сдан, ждет приемки
  | "accepted" // принят, деньги выплачены
  | "disputed" // спор, деньги заморожены
  | "failed"; // провален, остаток возвращен

/** draft: исполнитель согласует условия, денег еще нет; funding: ждет резерва; дальше как раньше */
export type DealStatus = "draft" | "funding" | "active" | "completed" | "cancelled";

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
  /** переписка по спору: причина, ответы сторон, пояснения приемщика */
  messages?: DisputeMessage[];
  /** как этап был закрыт */
  resolution?: { by: "owner" | "votes" | "auto" | "arbiter"; decision: "accepted" | "failed"; comment?: string; at: number };
}

export interface DisputeMessage {
  by: UserId;
  text: string;
  photos?: string[];
  at: number;
}

export interface Deal {
  id: string;
  mode: Mode;
  title: string;
  executorId: UserId;
  /** own: заказчик, grant: грантодатель, crowdfunding: не задан (голосование) */
  ownerId?: UserId;
  /** независимый приемщик для споров */
  arbiterId?: UserId;
  stages: Stage[];
  target: Money;
  status: DealStatus;
  /** сколько еще зарезервировано каждым плательщиком */
  reserves: Record<UserId, Money>;
  /** сколько внесено в сумме (для весов голосования и пропорционального возврата) */
  contributed: Record<UserId, Money>;
  autoAcceptMs: number;
  feeBps: number;
  createdAt: number;
  /** связи с платформой: услуга, проект, описание задачи. Движок их не использует */
  meta?: { serviceId?: string; projectId?: string; chatId?: string; description?: string };
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
