import type { DealSummary, PublicUser } from "./api";

export const nameOf = (users: PublicUser[], id?: string) => users.find((u) => u.id === id)?.name ?? id ?? "-";

export const MODE_LABEL = { own: "Свой проект", crowdfunding: "Краудфандинг", grant: "Грант" } as const;

export function dealChip(d: Pick<DealSummary, "status" | "currentStage" | "mode">): { text: string; tone: string } {
  if (d.status === "completed") return { text: "Завершена", tone: "gray" };
  if (d.status === "cancelled") return { text: "Отменена", tone: "red" };
  if (d.status === "funding") return { text: d.mode === "crowdfunding" ? "Сбор средств" : "Ждет резерва", tone: "amber" };
  switch (d.currentStage?.status) {
    case "submitted": return { text: "Ждет приемки", tone: "amber" };
    case "disputed": return { text: "Спор", tone: "red" };
    default: return { text: "В работе", tone: "" };
  }
}

export const STAGE_LABEL: Record<string, string> = {
  pending: "Ждет очереди",
  active: "В работе",
  submitted: "Сдан, ждет приемки",
  accepted: "Принят, оплачен",
  disputed: "Спор",
  failed: "Не принят",
};

export const LEDGER_LABEL: Record<string, string> = {
  topup: "Пополнение",
  reserve: "Резерв по сделке",
  payout: "Выплата за этап",
  refund: "Возврат по сделке",
  fee: "Комиссия сервиса",
};
