import {
  DAY_MS,
  PLATFORM_ID,
  type Deal,
  type LedgerType,
  type Mode,
  type Money,
  type Stage,
  type State,
  type UserId,
} from "./types";

export class EngineError extends Error {}

function fail(msg: string): never {
  throw new EngineError(msg);
}

export function createState(): State {
  return { wallets: {}, deals: {}, ledger: [] };
}

/** Все операции чистые: принимают состояние, возвращают новое. */
function mutate<T extends unknown[]>(
  fn: (s: State, ...a: T) => void,
): (state: State, ...a: T) => State {
  return (state, ...a) => {
    const next = structuredClone(state);
    fn(next, ...a);
    return next;
  };
}

function log(
  s: State,
  at: number,
  type: LedgerType,
  userId: UserId,
  amount: Money,
  extra: { dealId?: string; stageId?: string; note?: string } = {},
) {
  s.ledger.push({ id: s.ledger.length + 1, at, type, userId, amount, ...extra });
}

function getDeal(s: State, id: string): Deal {
  return s.deals[id] ?? fail(`Сделка ${id} не найдена`);
}

function getStage(d: Deal, id: string): Stage {
  return d.stages.find((x) => x.id === id) ?? fail(`Этап ${id} не найден`);
}

/** Делит amount по весам, сумма частей строго равна amount (метод наибольших остатков). */
export function splitProRata(amount: Money, weights: Record<UserId, Money>): Record<UserId, Money> {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (total === 0) return {};
  const parts = entries.map(([id, w]) => {
    const exact = (amount * w) / total;
    return { id, base: Math.floor(exact), rem: exact - Math.floor(exact) };
  });
  let left = amount - parts.reduce((a, p) => a + p.base, 0);
  [...parts].sort((a, b) => b.rem - a.rem).forEach((p) => {
    if (left > 0) {
      p.base += 1;
      left -= 1;
    }
  });
  return Object.fromEntries(parts.map((p) => [p.id, p.base]));
}

// ───────────────────────── кошелёк ─────────────────────────

export const topUp = mutate((s, userId: UserId, amount: Money, at: number) => {
  if (!Number.isInteger(amount) || amount <= 0) fail("Сумма должна быть положительной");
  s.wallets[userId] = (s.wallets[userId] ?? 0) + amount;
  log(s, at, "topup", userId, amount);
});

export function freeBalance(s: State, userId: UserId): Money {
  return s.wallets[userId] ?? 0;
}

export function reservedBalance(s: State, userId: UserId): Money {
  return Object.values(s.deals).reduce((a, d) => a + (d.reserves[userId] ?? 0), 0);
}

// ───────────────────────── сделка ─────────────────────────

export interface CreateDealInput {
  id: string;
  mode: Mode;
  title: string;
  executorId: UserId;
  ownerId?: UserId;
  arbiterId?: UserId;
  stages: { id?: string; title: string; amount: Money; criteria?: string[] }[];
  autoAcceptDays?: number;
  feeBps?: number;
  at: number;
}

export const createDeal = mutate((s, input: CreateDealInput) => {
  if (s.deals[input.id]) fail("Сделка уже существует");
  if (input.stages.length === 0) fail("Нужен хотя бы один этап");
  if (input.stages.some((x) => !Number.isInteger(x.amount) || x.amount <= 0))
    fail("Сумма этапа должна быть положительной");
  if (input.mode !== "crowdfunding" && !input.ownerId)
    fail("Для этого режима нужен заказчик/грантодатель");
  if (input.ownerId === input.executorId) fail("Заказчик и исполнитель должны различаться");

  const stages: Stage[] = input.stages.map((x, i) => ({
    id: x.id ?? `s${i + 1}`,
    title: x.title,
    amount: x.amount,
    criteria: x.criteria ?? [],
    status: "pending",
    votes: {},
  }));
  s.deals[input.id] = {
    id: input.id,
    mode: input.mode,
    title: input.title,
    executorId: input.executorId,
    ownerId: input.ownerId,
    arbiterId: input.arbiterId,
    stages,
    target: stages.reduce((a, x) => a + x.amount, 0),
    status: "funding",
    reserves: {},
    contributed: {},
    autoAcceptMs: (input.autoAcceptDays ?? 3) * DAY_MS,
    feeBps: input.feeBps ?? 0,
    createdAt: input.at,
  };
});

function totalReserved(d: Deal): Money {
  return Object.values(d.reserves).reduce((a, b) => a + b, 0);
}

function totalContributed(d: Deal): Money {
  return Object.values(d.contributed).reduce((a, b) => a + b, 0);
}

function activate(d: Deal) {
  d.status = "active";
  const first = d.stages.find((x) => x.status === "pending");
  if (first) first.status = "active";
}

/** Резерв денег. own/grant — ровно вся сумма от заказчика; crowdfunding — любые взносы до цели. */
export const fund = mutate((s, dealId: string, userId: UserId, amount: Money, at: number) => {
  const d = getDeal(s, dealId);
  if (d.status !== "funding") fail("Сделка уже не принимает деньги");
  if (!Number.isInteger(amount) || amount <= 0) fail("Сумма должна быть положительной");

  if (d.mode === "crowdfunding") {
    if (userId === d.executorId) fail("Автор не может спонсировать себя");
    if (amount > d.target - totalReserved(d)) fail("Взнос превышает недостающую сумму");
  } else {
    if (userId !== d.ownerId) fail("Резервировать может только заказчик");
    if (amount !== d.target) fail("Нужно зарезервировать всю сумму сделки");
  }
  if ((s.wallets[userId] ?? 0) < amount) fail("Недостаточно средств в кошельке");

  s.wallets[userId] = (s.wallets[userId] ?? 0) - amount;
  d.reserves[userId] = (d.reserves[userId] ?? 0) + amount;
  d.contributed[userId] = (d.contributed[userId] ?? 0) + amount;
  log(s, at, "reserve", userId, amount, { dealId });

  if (totalReserved(d) === d.target) activate(d);
});

// ───────────────────────── движение денег ─────────────────────────

function payout(s: State, d: Deal, stage: Stage, at: number) {
  const parts = splitProRata(stage.amount, d.reserves);
  let paid = 0;
  for (const [uid, part] of Object.entries(parts)) {
    d.reserves[uid] = (d.reserves[uid] ?? 0) - part;
    paid += part;
  }
  if (paid !== stage.amount) fail("Нарушен инвариант резерва");
  const fee = Math.floor((stage.amount * d.feeBps) / 10000);
  s.wallets[d.executorId] = (s.wallets[d.executorId] ?? 0) + stage.amount - fee;
  log(s, at, "payout", d.executorId, stage.amount - fee, { dealId: d.id, stageId: stage.id });
  if (fee > 0) {
    s.wallets[PLATFORM_ID] = (s.wallets[PLATFORM_ID] ?? 0) + fee;
    log(s, at, "fee", PLATFORM_ID, fee, { dealId: d.id, stageId: stage.id });
  }
}

/** Возвращает плательщикам весь оставшийся резерв. */
function refundAll(s: State, d: Deal, at: number, note: string) {
  for (const [uid, left] of Object.entries(d.reserves)) {
    if (left <= 0) continue;
    s.wallets[uid] = (s.wallets[uid] ?? 0) + left;
    d.reserves[uid] = 0;
    log(s, at, "refund", uid, left, { dealId: d.id, note });
  }
}

function acceptStage(s: State, d: Deal, stage: Stage, at: number) {
  payout(s, d, stage, at);
  stage.status = "accepted";
  const next = d.stages.find((x) => x.status === "pending");
  if (next) next.status = "active";
  else {
    d.status = "completed";
    refundAll(s, d, at, "Остаток после завершения"); // страховка от округлений: обычно 0
  }
}

function failDeal(s: State, d: Deal, stage: Stage, at: number, note: string) {
  stage.status = "failed";
  d.status = "cancelled";
  refundAll(s, d, at, note);
}

// ───────────────────────── этапы ─────────────────────────

export const submitStage = mutate(
  (
    s,
    dealId: string,
    stageId: string,
    userId: UserId,
    evidence: { note?: string; photos?: string[] },
    at: number,
  ) => {
    const d = getDeal(s, dealId);
    const st = getStage(d, stageId);
    if (userId !== d.executorId) fail("Сдать этап может только исполнитель");
    if (d.status !== "active" || st.status !== "active") fail("Этап сейчас нельзя сдать");
    st.status = "submitted";
    st.submittedAt = at;
    st.evidence = evidence;
    st.votes = {};
  },
);

/** Приёмка: own — заказчик, grant — грантодатель. В краудфандинге принимают голосованием. */
export const approveStage = mutate((s, dealId: string, stageId: string, userId: UserId, at: number) => {
  const d = getDeal(s, dealId);
  const st = getStage(d, stageId);
  if (d.mode === "crowdfunding") fail("В краудфандинге этап принимают голосованием");
  if (userId !== d.ownerId) fail("Принять этап может только заказчик");
  if (st.status !== "submitted") fail("Этап не ожидает приёмки");
  acceptStage(s, d, st, at);
});

/**
 * Отказ. own → спор, деньги за этап заморожены.
 * grant → этап провален, остаток возвращается грантодателю.
 */
export const rejectStage = mutate(
  (s, dealId: string, stageId: string, userId: UserId, reason: string, at: number) => {
    const d = getDeal(s, dealId);
    const st = getStage(d, stageId);
    if (d.mode === "crowdfunding") fail("В краудфандинге этап оценивают голосованием");
    if (userId !== d.ownerId) fail("Отказать может только заказчик");
    if (st.status !== "submitted") fail("Этап не ожидает приёмки");
    if (!reason.trim()) fail("Отказ возможен только с причиной");
    if (d.mode === "grant") {
      st.disputeReason = reason;
      failDeal(s, d, st, at, "Этап не принят грантодателем");
    } else {
      st.status = "disputed";
      st.disputeReason = reason;
    }
  },
);

/** Голос спонсора (вес = внесённая сумма). >50% «за» — принят, >50% «против» — провал и возврат. */
export const voteStage = mutate(
  (
    s,
    dealId: string,
    stageId: string,
    userId: UserId,
    vote: "accept" | "reject",
    at: number,
  ) => {
    const d = getDeal(s, dealId);
    const st = getStage(d, stageId);
    if (d.mode !== "crowdfunding") fail("Голосование только в краудфандинге");
    if (st.status !== "submitted") fail("Этап не ожидает приёмки");
    if ((d.contributed[userId] ?? 0) <= 0) fail("Голосовать могут только спонсоры");
    st.votes[userId] = vote;
    const total = totalContributed(d);
    const weight = (v: "accept" | "reject") =>
      Object.entries(st.votes)
        .filter(([, x]) => x === v)
        .reduce((a, [uid]) => a + (d.contributed[uid] ?? 0), 0);
    if (weight("accept") * 2 > total) acceptStage(s, d, st, at);
    else if (weight("reject") * 2 >= total) failDeal(s, d, st, at, "Спонсоры не приняли этап");
  },
);

/** Исполнитель/заказчик открывают спор по сданному этапу (для own). */
export const openDispute = mutate(
  (s, dealId: string, stageId: string, userId: UserId, reason: string) => {
    const d = getDeal(s, dealId);
    const st = getStage(d, stageId);
    if (d.mode !== "own") fail("Споры по приёмщику есть только в режиме «Свой проект»");
    if (userId !== d.ownerId && userId !== d.executorId) fail("Нет доступа к сделке");
    if (st.status !== "submitted") fail("Спор можно открыть только по сданному этапу");
    if (!reason.trim()) fail("Укажите причину");
    st.status = "disputed";
    st.disputeReason = reason;
  },
);

/** Решение независимого приёмщика: pay — выплатить исполнителю, refund — вернуть деньги заказчику. */
export const resolveDispute = mutate(
  (
    s,
    dealId: string,
    stageId: string,
    userId: UserId,
    decision: "pay" | "refund",
    at: number,
  ) => {
    const d = getDeal(s, dealId);
    const st = getStage(d, stageId);
    if (!d.arbiterId || userId !== d.arbiterId) fail("Решить спор может только приёмщик");
    if (st.status !== "disputed") fail("Этап не в споре");
    if (decision === "pay") acceptStage(s, d, st, at);
    else failDeal(s, d, st, at, "Спор решён в пользу заказчика");
  },
);

/** Отмена сделки заказчиком: возвращается всё, кроме этапов на сдаче/в споре — их нужно сначала закрыть. */
export const cancelDeal = mutate((s, dealId: string, userId: UserId, at: number) => {
  const d = getDeal(s, dealId);
  if (d.status === "completed" || d.status === "cancelled") fail("Сделка уже завершена");
  if (d.mode !== "crowdfunding" && userId !== d.ownerId) fail("Отменить может только заказчик");
  if (d.mode === "crowdfunding" && userId !== d.executorId) fail("Отменить может только автор");
  if (d.stages.some((x) => x.status === "submitted" || x.status === "disputed"))
    fail("Сначала закройте этап на приёмке или в споре");
  d.status = "cancelled";
  refundAll(s, d, at, "Сделка отменена");
});

/** Часы: автоприёмка через autoAcceptMs без ответа (own и краудфандинг). */
export const tick = mutate((s, now: number) => {
  for (const d of Object.values(s.deals)) {
    if (d.status !== "active" || d.mode === "grant") continue;
    for (const st of d.stages) {
      if (
        st.status === "submitted" &&
        st.submittedAt !== undefined &&
        now - st.submittedAt >= d.autoAcceptMs
      ) {
        acceptStage(s, d, st, now);
        break; // один этап за тик, следующий начнёт новый круг
      }
    }
  }
});
