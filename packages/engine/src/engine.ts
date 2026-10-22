import {
  DAY_MS,
  PLATFORM_ID,
  type ChainLink,
  type SignatureProof,
  type Deal,
  type LedgerType,
  type Mode,
  type Money,
  type Stage,
  type State,
  type UserId,
} from "./types";
import { sealContract, signaturesComplete, verifyContract } from "./contract";
import { record, verifyJournal } from "./journal";
import { requiredSigners as requiredSignersOf } from "./contract";

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

// ───────────────────────── кошелек ─────────────────────────

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
  /** запасной приемщик; нужен срок на спор, решать он может со второй половины этого срока */
  backupArbiterId?: UserId;
  stages: { id?: string; title: string; amount: Money; criteria?: string[] }[];
  autoAcceptDays?: number;
  /** сроки в днях; не заданы или 0: без срока */
  fundingDeadlineDays?: number;
  stageDeadlineDays?: number;
  disputeDays?: number;
  /** неустойка за каждые начатые сутки просрочки этапа и ее предел, в базисных пунктах суммы этапа; нужен срок этапа */
  penaltyBpsPerDay?: number;
  penaltyCapBps?: number;
  feeBps?: number;
  /** draft: условия согласует исполнитель (только «Свой проект»); по умолчанию funding */
  status?: "draft" | "funding";
  /** контракт вступает в силу после подписей сторон */
  signed?: boolean;
  meta?: Deal["meta"];
  at: number;
}

export const createDeal = mutate((s, input: CreateDealInput) => {
  if (s.deals[input.id]) fail("Сделка уже существует");
  if (input.stages.length === 0 && input.status !== "draft") fail("Нужен хотя бы один этап");
  if (input.stages.some((x) => !Number.isInteger(x.amount) || x.amount <= 0))
    fail("Сумма этапа должна быть положительной");
  if (input.mode !== "crowdfunding" && !input.ownerId)
    fail("Для этого режима нужен заказчик/грантодатель");
  if (input.ownerId === input.executorId) fail("Заказчик и исполнитель должны различаться");
  if (input.status === "draft" && input.mode !== "own") fail("Черновик бывает только у личной сделки");
  if (input.backupArbiterId) {
    if (input.mode !== "own" || !input.arbiterId) fail("Запасной приемщик бывает только рядом с основным в личной сделке");
    if (!input.disputeDays) fail("Запасной приемщик работает вместе со сроком на спор");
    if ([input.arbiterId, input.executorId, input.ownerId].includes(input.backupArbiterId)) fail("Запасной приемщик должен быть независимым от сторон и основного приемщика");
  }

  checkPenalty(input.mode, input.stageDeadlineDays, input.penaltyBpsPerDay, input.penaltyCapBps);

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
    backupArbiterId: input.backupArbiterId,
    stages,
    target: stages.reduce((a, x) => a + x.amount, 0),
    status: input.status ?? "funding",
    reserves: {},
    contributed: {},
    autoAcceptMs: (input.autoAcceptDays ?? 3) * DAY_MS,
    fundingDeadlineMs: input.fundingDeadlineDays ? input.fundingDeadlineDays * DAY_MS : undefined,
    stageDeadlineMs: input.stageDeadlineDays ? input.stageDeadlineDays * DAY_MS : undefined,
    disputeMs: input.disputeDays ? input.disputeDays * DAY_MS : undefined,
    penaltyBpsPerDay: input.penaltyBpsPerDay || undefined,
    penaltyCapBps: input.penaltyCapBps || undefined,
    feeBps: input.feeBps ?? 0,
    createdAt: input.at,
    signing: input.signed ? true : undefined,
    meta: input.meta,
  };
  const nd = s.deals[input.id]!;
  if (input.status !== "draft") sealContract(nd, input.at);
  record(nd, input.at, "created", "system", { mode: nd.mode, target: nd.target, status: nd.status, contract: nd.contract?.hash });
});

export const MAX_PENALTY_BPS = 5000;

/** Неустойка: только своя сделка со сроком этапа, ставка не больше предела, предел не больше половины этапа. Как в StepEscrow. */
function checkPenalty(mode: Mode, stageDeadlineDays: number | undefined, rate: number | undefined, cap: number | undefined) {
  if (!rate && !cap) return;
  if (mode !== "own") fail("Неустойка бывает только в личной сделке");
  if (!stageDeadlineDays) fail("Для неустойки нужен срок этапа");
  if (!Number.isInteger(rate) || !Number.isInteger(cap) || !rate || !cap || rate <= 0 || cap <= 0) fail("Укажите ставку неустойки и ее предел");
  if (rate! > cap!) fail("Ставка неустойки за сутки не может быть больше предела");
  if (cap! > MAX_PENALTY_BPS) fail("Предел неустойки не больше 50 % суммы этапа");
}

/** Сколько этап еще можно сдать после срока: пока неустойка не дошла до предела. */
export function penaltyGraceMs(d: Pick<Deal, "penaltyBpsPerDay" | "penaltyCapBps">): number {
  if (!d.penaltyBpsPerDay || !d.penaltyCapBps) return 0;
  return Math.ceil(d.penaltyCapBps / d.penaltyBpsPerDay) * DAY_MS;
}

/** Неустойка при сдаче в момент at: сдача в момент срока и позже считается просрочкой с первых суток, далее за каждые начатые сутки. */
export function penaltyAt(d: Deal, st: Stage, at: number): Money {
  if (!d.penaltyBpsPerDay || !d.penaltyCapBps || !d.stageDeadlineMs || st.activeSince === undefined) return 0;
  const due = st.activeSince + d.stageDeadlineMs;
  if (at < due) return 0;
  const bps = Math.min((Math.floor((at - due) / DAY_MS) + 1) * d.penaltyBpsPerDay, d.penaltyCapBps);
  return Math.floor((st.amount * bps) / 10000);
}

function toStages(items: NonNullable<CreateDealInput["stages"]>): Stage[] {
  if (items.length === 0) fail("Нужен хотя бы один этап");
  if (items.some((x) => !x.title.trim() || !Number.isInteger(x.amount) || x.amount <= 0)) fail("У каждого этапа нужны название и сумма");
  return items.map((x, i) => ({ id: x.id ?? `s${i + 1}`, title: x.title.trim(), amount: x.amount, criteria: x.criteria ?? [], status: "pending", votes: {} }));
}

/** Согласование: исполнитель правит название, описание и этапы, пока условия не отправлены заказчику. */
export const updateTerms = mutate(
  (s, dealId: string, userId: UserId, patch: { title?: string; description?: string; stages?: CreateDealInput["stages"]; penalty?: { bpsPerDay: number; capBps: number } | null }) => {
    const d = getDeal(s, dealId);
    if (d.status !== "draft") fail("Условия уже отправлены, чтобы изменить их, верните сделку на согласование");
    if (userId !== d.executorId) fail("Условия правит исполнитель");
    if (patch.title !== undefined) {
      if (!patch.title.trim()) fail("Название не может быть пустым");
      d.title = patch.title.trim();
    }
    if (patch.description !== undefined) d.meta = { ...d.meta, description: patch.description.trim() };
    if (patch.stages) {
      d.stages = toStages(patch.stages);
      d.target = d.stages.reduce((a, x) => a + x.amount, 0);
    }
    if (patch.penalty !== undefined) {
      const p = patch.penalty;
      checkPenalty(d.mode, d.stageDeadlineMs ? d.stageDeadlineMs / DAY_MS : undefined, p?.bpsPerDay, p?.capBps);
      d.penaltyBpsPerDay = p?.bpsPerDay || undefined;
      d.penaltyCapBps = p?.capBps || undefined;
    }
  },
);

/** Исполнитель отправляет условия заказчику: теперь заказчик может зарезервировать деньги. */
export const proposeDeal = mutate((s, dealId: string, userId: UserId, at: number) => {
  const d = getDeal(s, dealId);
  if (d.status !== "draft") fail("Условия уже отправлены");
  if (userId !== d.executorId) fail("Отправить условия может исполнитель");
  if (d.stages.length === 0 || d.target <= 0) fail("Сначала добавьте этапы");
  d.status = "funding";
  d.signatures = undefined;
  sealContract(d, at);
  record(d, at, "terms_sealed", userId, { target: d.target, stages: d.stages.length, contract: d.contract!.hash });
});

/** Вернуть условия на правку, пока заказчик ничего не зарезервировал. */
export const reopenDeal = mutate((s, dealId: string, userId: UserId, at: number) => {
  const d = getDeal(s, dealId);
  if (d.status !== "funding" || d.mode !== "own") fail("Вернуть на согласование нельзя");
  if (userId !== d.executorId) fail("Вернуть условия может исполнитель");
  if (totalReserved(d) > 0) fail("Заказчик уже зарезервировал деньги");
  d.status = "draft";
  delete d.contract;
  d.signatures = undefined;
  record(d, at, "terms_reopened", userId);
});

function totalReserved(d: Deal): Money {
  return Object.values(d.reserves).reduce((a, b) => a + b, 0);
}

function totalContributed(d: Deal): Money {
  return Object.values(d.contributed).reduce((a, b) => a + b, 0);
}

/** Условия не должны меняться после фиксации. Сделки без контракта (созданные раньше) фиксируются при первом движении денег. */
function assertContract(d: Deal, at: number) {
  if (!d.contract) return sealContract(d, at);
  if (!verifyContract(d).ok) fail("Условия сделки изменены после фиксации, операция остановлена");
  if (!verifyJournal(d).ok) fail("Журнал сделки нарушен, операция остановлена");
}

function activate(d: Deal, at: number) {
  d.status = "active";
  const first = d.stages.find((x) => x.status === "pending");
  if (first) {
    first.status = "active";
    first.activeSince = at;
  }
}

/** Резерв денег. own/grant - ровно вся сумма от заказчика; crowdfunding - любые взносы до цели. */
export const fund = mutate((s, dealId: string, userId: UserId, amount: Money, at: number) => {
  const d = getDeal(s, dealId);
  if (d.status === "draft") fail("Исполнитель еще не отправил условия");
  if (d.status !== "funding") fail("Сделка уже не принимает деньги");
  assertContract(d, at);
  if (!Number.isInteger(amount) || amount <= 0) fail("Сумма должна быть положительной");

  if (totalReserved(d) >= d.target) fail("Нужная сумма уже зарезервирована");
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
  record(d, at, "reserved", userId, { amount });

  if (totalReserved(d) === d.target && signaturesComplete(d)) {
    activate(d, at);
    if (d.signing) record(d, at, "activated", "system");
  }
});

/** Подпись стороны под хешем контракта. Работа начинается, когда деньги зарезервированы и все подписи на месте. */
export const signContract = mutate((s, dealId: string, userId: UserId, at: number, sig: string, proof?: SignatureProof) => {
  const d = getDeal(s, dealId);
  if (!d.signing) fail("Эта сделка подписывается без отдельной подписи");
  if (!d.contract) fail("Контракт еще не зафиксирован: исполнитель не отправил условия");
  if (d.status !== "funding") fail("Подписать можно, пока сделка не началась");
  if (!verifyContract(d).ok) fail("Условия сделки изменены после фиксации, подпись невозможна");
  if (!(requiredSignersOf(d) ?? []).includes(userId)) fail("Вы не сторона этого контракта");
  if (d.signatures?.[userId]?.hash === d.contract.hash) fail("Вы уже подписали контракт");
  (d.signatures ??= {})[userId] = { at, hash: d.contract.hash, sig, ...(proof ? { proof } : {}) };
  record(d, at, "signed", userId, { contract: d.contract.hash, method: proof ? "device" : "server", ...(proof ? { keyId: proof.keyId } : {}) });
  if (totalReserved(d) === d.target && signaturesComplete(d)) {
    activate(d, at);
    record(d, at, "activated", "system");
  }
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
  // неустойка за просрочку возвращается заказчику, комиссия считается с суммы после неустойки
  const penalty = d.ownerId ? stage.penalty ?? 0 : 0;
  const net = stage.amount - penalty;
  const fee = Math.floor((net * d.feeBps) / 10000);
  s.wallets[d.executorId] = (s.wallets[d.executorId] ?? 0) + net - fee;
  log(s, at, "payout", d.executorId, net - fee, { dealId: d.id, stageId: stage.id });
  record(d, at, "payout", "system", { amount: net - fee, fee, ...(penalty ? { penalty } : {}) }, stage.id);
  if (fee > 0) {
    s.wallets[PLATFORM_ID] = (s.wallets[PLATFORM_ID] ?? 0) + fee;
    log(s, at, "fee", PLATFORM_ID, fee, { dealId: d.id, stageId: stage.id });
  }
  if (penalty > 0) {
    s.wallets[d.ownerId!] = (s.wallets[d.ownerId!] ?? 0) + penalty;
    log(s, at, "penalty", d.ownerId!, penalty, { dealId: d.id, stageId: stage.id, note: "Неустойка за просрочку этапа" });
    record(d, at, "penalty", "system", { to: d.ownerId, amount: penalty }, stage.id);
  }
}

/** Возвращает плательщикам весь оставшийся резерв. */
function refundAll(s: State, d: Deal, at: number, note: string) {
  for (const [uid, left] of Object.entries(d.reserves)) {
    if (left <= 0) continue;
    s.wallets[uid] = (s.wallets[uid] ?? 0) + left;
    d.reserves[uid] = 0;
    log(s, at, "refund", uid, left, { dealId: d.id, note });
    record(d, at, "refund", "system", { to: uid, amount: left, note });
  }
}

type ClosedBy = NonNullable<Stage["resolution"]>["by"];

function acceptStage(s: State, d: Deal, stage: Stage, at: number, by: ClosedBy, comment?: string, actor = "system") {
  assertContract(d, at);
  payout(s, d, stage, at);
  stage.status = "accepted";
  stage.resolution = { by, decision: "accepted", comment, at };
  record(d, at, "stage_accepted", actor, { closedBy: by, comment }, stage.id);
  const next = d.stages.find((x) => x.status === "pending");
  if (next) {
    next.status = "active";
    next.activeSince = at;
  }
  else {
    d.status = "completed";
    record(d, at, "completed", "system");
    refundAll(s, d, at, "Остаток после завершения"); // страховка от округлений: обычно 0
  }
}

function failDeal(s: State, d: Deal, stage: Stage, at: number, note: string, by: ClosedBy, comment?: string, actor = "system") {
  stage.status = "failed";
  stage.resolution = { by, decision: "failed", comment, at };
  d.status = "cancelled";
  record(d, at, "stage_failed", actor, { closedBy: by, comment }, stage.id);
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
    const penalty = penaltyAt(d, st, at);
    st.penalty = penalty || undefined;
    record(d, at, "stage_submitted", userId, { note: evidence.note, photos: evidence.photos?.length ? evidence.photos : undefined, ...(penalty ? { penalty } : {}) }, st.id);
  },
);

/** Приемка: own - заказчик, grant - грантодатель. В краудфандинге принимают голосованием. */
export const approveStage = mutate((s, dealId: string, stageId: string, userId: UserId, at: number) => {
  const d = getDeal(s, dealId);
  const st = getStage(d, stageId);
  if (d.mode === "crowdfunding") fail("В краудфандинге этап принимают голосованием");
  if (userId !== d.ownerId) fail("Принять этап может только заказчик");
  if (st.status !== "submitted") fail("Этап не ожидает приемки");
  acceptStage(s, d, st, at, "owner", undefined, userId);
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
    if (st.status !== "submitted") fail("Этап не ожидает приемки");
    if (!reason.trim()) fail("Отказ возможен только с причиной");
    if (d.mode === "grant") {
      st.disputeReason = reason;
      failDeal(s, d, st, at, "Этап не принят грантодателем", "owner", reason, userId);
    } else {
      st.status = "disputed";
      st.disputedAt = at;
      st.disputeReason = reason;
      st.messages = [{ by: userId, text: reason, at }];
      record(d, at, "stage_rejected", userId, { reason }, st.id);
    }
  },
);

/** Голос спонсора (вес = внесенная сумма). >50% «за» - принят, >50% «против» - провал и возврат. */
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
    if (st.status !== "submitted") fail("Этап не ожидает приемки");
    if ((d.contributed[userId] ?? 0) <= 0) fail("Голосовать могут только спонсоры");
    st.votes[userId] = vote;
    record(d, at, "vote", userId, { vote }, st.id);
    const total = totalContributed(d);
    const weight = (v: "accept" | "reject") =>
      Object.entries(st.votes)
        .filter(([, x]) => x === v)
        .reduce((a, [uid]) => a + (d.contributed[uid] ?? 0), 0);
    if (weight("accept") * 2 > total) acceptStage(s, d, st, at, "votes", undefined, userId);
    else if (weight("reject") * 2 >= total) failDeal(s, d, st, at, "Спонсоры не приняли этап", "votes", undefined, userId);
  },
);

/** Исполнитель/заказчик открывают спор по сданному этапу (для own). */
export const openDispute = mutate(
  (s, dealId: string, stageId: string, userId: UserId, reason: string, at: number) => {
    const d = getDeal(s, dealId);
    const st = getStage(d, stageId);
    if (d.mode !== "own") fail("Споры по приемщику есть только в режиме «Свой проект»");
    if (userId !== d.ownerId && userId !== d.executorId) fail("Нет доступа к сделке");
    if (st.status !== "submitted") fail("Спор можно открыть только по сданному этапу");
    if (!reason.trim()) fail("Укажите причину");
    st.status = "disputed";
    st.disputedAt = at;
    st.disputeReason = reason;
    st.messages = [{ by: userId, text: reason, at }];
    record(d, at, "dispute_opened", userId, { reason }, st.id);
  },
);

/** Реплика в споре: стороны сделки добавляют аргументы и фото, приемщик - вопросы. */
export const replyDispute = mutate(
  (s, dealId: string, stageId: string, userId: UserId, text: string, photos: string[], at: number) => {
    const d = getDeal(s, dealId);
    const st = getStage(d, stageId);
    if (st.status !== "disputed") fail("Этап не в споре");
    if (userId !== d.ownerId && userId !== d.executorId && userId !== d.arbiterId && userId !== d.backupArbiterId) fail("Нет доступа к спору");
    if (!text.trim() && photos.length === 0) fail("Напишите сообщение или приложите фото");
    (st.messages ??= []).push({ by: userId, text: text.trim(), photos: photos.length ? photos : undefined, at });
    record(d, at, "dispute_reply", userId, { text: text.trim() || undefined, photos: photos.length ? photos : undefined }, st.id);
  },
);

/** Решение независимого приемщика: pay - выплатить исполнителю, refund - вернуть деньги заказчику. */
export const resolveDispute = mutate(
  (
    s,
    dealId: string,
    stageId: string,
    userId: UserId,
    decision: "pay" | "refund",
    at: number,
    comment?: string,
  ) => {
    const d = getDeal(s, dealId);
    const st = getStage(d, stageId);
    if (st.status !== "disputed") fail("Этап не в споре");
    const primary = !!d.arbiterId && userId === d.arbiterId;
    const backup = !!d.backupArbiterId && userId === d.backupArbiterId;
    if (!primary && !backup) fail("Решить спор может только приемщик");
    if (backup && !(d.disputeMs && st.disputedAt !== undefined && at >= st.disputedAt + Math.floor(d.disputeMs / 2))) fail("Запасной приемщик решает спор, если основной молчит половину срока");
    const note = comment?.trim() || undefined;
    if (decision === "pay") acceptStage(s, d, st, at, "arbiter", note, userId);
    else failDeal(s, d, st, at, "Спор решен в пользу заказчика", "arbiter", note, userId);
  },
);

/** Отмена сделки заказчиком: возвращается все, кроме этапов на сдаче/в споре - их нужно сначала закрыть. */
export const cancelDeal = mutate((s, dealId: string, userId: UserId, at: number) => {
  const d = getDeal(s, dealId);
  if (d.status === "completed" || d.status === "cancelled") fail("Сделка уже завершена");
  if (d.status === "draft") {
    if (userId !== d.executorId && userId !== d.ownerId) fail("Нет доступа к сделке");
    d.status = "cancelled";
    record(d, at, "cancelled", userId);
    return;
  }
  if (d.mode !== "crowdfunding" && userId !== d.ownerId) fail("Отменить может только заказчик");
  if (d.mode === "crowdfunding" && userId !== d.executorId) fail("Отменить может только автор");
  if (d.stages.some((x) => x.status === "submitted" || x.status === "disputed"))
    fail("Сначала закройте этап на приемке или в споре");
  d.status = "cancelled";
  record(d, at, "cancelled", userId);
  refundAll(s, d, at, "Сделка отменена");
});

/** Срок сбора истек: сделка отменяется, деньги возвращаются плательщикам. Вызвать может любой. */
/** Сроки платформы по умолчанию (дни): без них пропавшая сторона держала бы чужие деньги бесконечно. */
export function defaultDeadlines(mode: Mode): { fundingDeadlineDays?: number; stageDeadlineDays?: number; disputeDays?: number } {
  if (mode === "crowdfunding") return { fundingDeadlineDays: 30, stageDeadlineDays: 30 };
  if (mode === "grant") return { stageDeadlineDays: 60 };
  return { stageDeadlineDays: 30, disputeDays: 14 };
}

export const expireFunding = mutate((s, dealId: string, at: number) => {
  const d = getDeal(s, dealId);
  if (d.status !== "funding") fail("Сделка уже не собирает деньги");
  const since = d.contract?.sealedAt ?? d.createdAt;
  if (!d.fundingDeadlineMs || at < since + d.fundingDeadlineMs) fail("Срок сбора еще не истек");
  d.status = "cancelled";
  record(d, at, "funding_expired", "system");
  refundAll(s, d, at, "Срок сбора истек");
});

/** Исполнитель не сдал этап в срок: этап провален, остаток возвращается. Вызвать может любой. */
export const expireStage = mutate((s, dealId: string, stageId: string, at: number) => {
  const d = getDeal(s, dealId);
  const st = getStage(d, stageId);
  if (d.status !== "active" || st.status !== "active") fail("Этап сейчас не в работе");
  if (!d.stageDeadlineMs || st.activeSince === undefined || at < st.activeSince + d.stageDeadlineMs + penaltyGraceMs(d)) fail("Срок этапа еще не истек");
  failDeal(s, d, st, at, "Срок этапа истек", "expired");
});

/** Приемщик не решил спор в срок: этап провален, остаток возвращается плательщику. Вызвать может любой. */
export const expireDispute = mutate((s, dealId: string, stageId: string, at: number) => {
  const d = getDeal(s, dealId);
  const st = getStage(d, stageId);
  if (d.status !== "active" || st.status !== "disputed") fail("Этап не в споре");
  if (!d.disputeMs || st.disputedAt === undefined || at < st.disputedAt + d.disputeMs) fail("Срок решения спора еще не истек");
  failDeal(s, d, st, at, "Спор не решен в срок", "expired");
});

/** Часы: истекшие сроки (сбор, этап, спор) и автоприемка через autoAcceptMs без ответа (own и краудфандинг). */
export const tick = mutate((s, now: number) => {
  for (const d of Object.values(s.deals)) {
    // возвраты по истекшим срокам выполняются всегда, даже если условия или журнал нарушены
    if (d.status === "funding" && d.fundingDeadlineMs && now >= (d.contract?.sealedAt ?? d.createdAt) + d.fundingDeadlineMs) {
      d.status = "cancelled";
      record(d, now, "funding_expired", "system");
      refundAll(s, d, now, "Срок сбора истек");
      continue;
    }
    if (d.status !== "active") continue;
    const overdue = d.stages.find((st) => (st.status === "active" && d.stageDeadlineMs && st.activeSince !== undefined && now >= st.activeSince + d.stageDeadlineMs + penaltyGraceMs(d)) || (st.status === "disputed" && d.disputeMs && st.disputedAt !== undefined && now >= st.disputedAt + d.disputeMs));
    if (overdue) {
      failDeal(s, d, overdue, now, overdue.status === "disputed" ? "Спор не решен в срок" : "Срок этапа истек", "expired");
      continue;
    }
    if (d.mode === "grant") continue;
    if (d.contract && !verifyContract(d).ok) continue; // условия подменены: автоприемка не выплачивает
    for (const st of d.stages) {
      if (
        st.status === "submitted" &&
        st.submittedAt !== undefined &&
        now - st.submittedAt >= d.autoAcceptMs
      ) {
        acceptStage(s, d, st, now, "auto");
        break; // один этап за тик, следующий начнет новый круг
      }
    }
  }
});

const HEX_HASH = /^0x[0-9a-fA-F]{64}$/;
const HEX_ADDR = /^0x[0-9a-fA-F]{40}$/;

/** Привязывает к сделке отчет о прогоне на контракте в сети (адреса, номера и хеши транзакций). */
export const linkChain = mutate((s, dealId: string, chain: ChainLink, at: number) => {
  const d = getDeal(s, dealId);
  if (!HEX_ADDR.test(chain.contract)) fail("Адрес контракта должен быть вида 0x и 40 символов");
  if (!Number.isInteger(chain.chainId) || chain.chainId <= 0 || !Number.isInteger(chain.dealId) || chain.dealId <= 0) fail("Неверный номер сети или сделки");
  if (!chain.network.trim() || chain.txs.length === 0 || chain.txs.length > 100) fail("Нужны название сети и от 1 до 100 транзакций");
  if (chain.txs.some((x) => !HEX_HASH.test(x.hash) || !x.label.trim())) fail("Хеш транзакции должен быть вида 0x и 64 символа, у каждой нужна подпись");
  if (chain.explorer && !/^https:\/\/[a-z0-9.-]+(\/[\w./-]*)?$/i.test(chain.explorer)) fail("Адрес обозревателя должен начинаться с https://");
  d.chain = { ...chain, network: chain.network.trim(), explorer: chain.explorer?.replace(/\/+$/, "") };
  record(d, at, "chain_linked", "system", { network: d.chain.network, address: chain.contract, txs: chain.txs.length });
});
