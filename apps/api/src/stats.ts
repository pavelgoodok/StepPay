import type { State } from "@steppay/engine";

export interface PublicProfile {
  acceptedStages: number;
  failedStages: number;
  disputes: number;
  autoAccepted: number;
  dealsCompleted: number;
  received: number;
}

/** Репутация исполнителя считается только из принятых и проваленных этапов. */
export function executorStats(s: State, userId: string): PublicProfile {
  let accepted = 0, failed = 0, disputes = 0, auto = 0, completed = 0;
  for (const d of Object.values(s.deals)) {
    if (d.executorId !== userId) continue;
    if (d.status === "completed") completed++;
    for (const st of d.stages) {
      if (st.status === "accepted") accepted++;
      if (st.status === "failed") failed++;
      if (st.messages?.length) disputes++;
      if (st.resolution?.by === "auto") auto++;
    }
  }
  const received = s.ledger.filter((l) => l.type === "payout" && l.userId === userId).reduce((a, l) => a + l.amount, 0);
  return { acceptedStages: accepted, failedStages: failed, disputes, autoAccepted: auto, dealsCompleted: completed, received };
}

export interface Receipt {
  id: number;
  number: string;
  at: number;
  amount: number;
  service: string;
  dealId: string;
  payerId: string | null;
}

/** Демо-чеки самозанятого по каждой выплате за этап (в продукте - чек «Мой налог» через API ФНС). */
export function receiptsFor(s: State, userId: string): Receipt[] {
  return s.ledger
    .filter((l) => l.type === "payout" && l.userId === userId && l.dealId)
    .map((l) => {
      const d = s.deals[l.dealId!];
      const stage = d?.stages.find((x) => x.id === l.stageId);
      return {
        id: l.id,
        number: `${new Date(l.at).getFullYear()}-${String(l.id).padStart(6, "0")}`,
        at: l.at,
        amount: l.amount,
        service: `Работы по этапу «${stage?.title ?? "-"}», проект «${d?.title ?? "-"}»`,
        dealId: l.dealId!,
        payerId: d?.ownerId ?? null,
      };
    })
    .reverse();
}
