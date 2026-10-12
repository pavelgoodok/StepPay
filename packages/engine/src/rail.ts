import {
  approveStage,
  cancelDeal,
  createDeal,
  createState,
  freeBalance,
  fund,
  openDispute,
  rejectStage,
  resolveDispute,
  signContract,
  submitStage,
  tick,
  topUp,
  voteStage,
} from "./engine";
import { PLATFORM_ID, type Deal, type Mode, type State } from "./types";

/**
 * Денежный рельс: то, на чем исполняются условия сделки и где лежат деньги.
 * Ядро сделок, работающее на эмуляторе кошелька, и эталонный контракт StepEscrow на EVM реализуют один интерфейс
 * и проходят одни и те же сценарии с одинаковыми ожидаемыми результатами (см. RAIL_SCENARIOS).
 * Суммы в копейках, участники названы по имени (например "anna"), комиссия платформы лежит у участника "platform".
 */
export interface MoneyRail {
  /** выдать участникам стартовые деньги в кошельке рельса */
  init(balances: Record<string, number>): Promise<void>;
  /** создать сделку с условиями */
  open(spec: DealSpec): Promise<void>;
  /** подпись стороны под контрактом */
  sign(by: string): Promise<void>;
  /** зарезервировать деньги: заказчик всю сумму, спонсор любую часть */
  reserve(by: string, amount: number): Promise<void>;
  submit(by: string, stage: number): Promise<void>;
  approve(by: string, stage: number): Promise<void>;
  reject(by: string, stage: number): Promise<void>;
  vote(by: string, stage: number, accept: boolean): Promise<void>;
  dispute(by: string, stage: number): Promise<void>;
  resolve(by: string, stage: number, pay: boolean): Promise<void>;
  /** автоприемка: срабатывает, только если срок вышел */
  autoAccept(by: string, stage: number): Promise<void>;
  cancel(by: string): Promise<void>;
  /** сдвинуть время вперед */
  wait(seconds: number): Promise<void>;
  balance(who: string): Promise<number>;
  state(): Promise<RailState>;
}

export type RailStatus = "funding" | "active" | "completed" | "cancelled";
export type RailStage = "pending" | "active" | "submitted" | "accepted" | "disputed" | "failed";
export interface RailState {
  status: RailStatus;
  stages: RailStage[];
}

export interface DealSpec {
  mode: Mode;
  executor: string;
  /** заказчик или грантодатель; у краудфандинга не задан */
  owner?: string;
  arbiter?: string;
  stages: number[];
  autoAcceptDays: number;
  feeBps: number;
}

export type StepKind = "sign" | "reserve" | "submit" | "approve" | "reject" | "vote" | "dispute" | "resolve" | "autoAccept" | "cancel" | "wait";
export interface Step {
  do: StepKind;
  by?: string;
  stage?: number;
  amount?: number;
  accept?: boolean;
  pay?: boolean;
  seconds?: number;
  /** шаг должен быть отклонен рельсом, состояние не меняется */
  fails?: true;
}

export interface Scenario {
  name: string;
  balances: Record<string, number>;
  deal: DealSpec;
  steps: Step[];
  expect: { balances: Record<string, number>; status: RailStatus; stages: RailStage[] };
}

/** Выполняет шаг на рельсе; возвращает true, если рельс его принял. */
export async function applyStep(rail: MoneyRail, s: Step): Promise<boolean> {
  try {
    switch (s.do) {
      case "sign": await rail.sign(s.by!); break;
      case "reserve": await rail.reserve(s.by!, s.amount!); break;
      case "submit": await rail.submit(s.by!, s.stage!); break;
      case "approve": await rail.approve(s.by!, s.stage!); break;
      case "reject": await rail.reject(s.by!, s.stage!); break;
      case "vote": await rail.vote(s.by!, s.stage!, s.accept!); break;
      case "dispute": await rail.dispute(s.by!, s.stage!); break;
      case "resolve": await rail.resolve(s.by!, s.stage!, s.pay!); break;
      case "autoAccept": await rail.autoAccept(s.by ?? "stranger", s.stage!); break;
      case "cancel": await rail.cancel(s.by!); break;
      case "wait": await rail.wait(s.seconds!); break;
    }
    return true;
  } catch {
    return false;
  }
}

export interface ScenarioResult {
  accepted: boolean[];
  balances: Record<string, number>;
  state: RailState;
}

export async function runScenario(rail: MoneyRail, sc: Scenario): Promise<ScenarioResult> {
  await rail.init(sc.balances);
  await rail.open(sc.deal);
  const accepted: boolean[] = [];
  for (const step of sc.steps) accepted.push(await applyStep(rail, step));
  const balances: Record<string, number> = {};
  for (const who of Object.keys(sc.expect.balances)) balances[who] = await rail.balance(who);
  return { accepted, balances, state: await rail.state() };
}

// ───────────────────────── эмулятор: ядро сделок ─────────────────────────

const DAY_S = 86_400;

/** Рельс на ядре сделок: деньги в эмулируемом кошельке цифрового рубля. */
export class EmulatedRail implements MoneyRail {
  private s: State = createState();
  private now = 1_000_000;
  private spec!: DealSpec;
  private readonly id = "rail-deal";

  private get deal(): Deal {
    return this.s.deals[this.id]!;
  }

  async init(balances: Record<string, number>) {
    for (const [who, v] of Object.entries(balances)) this.s = topUp(this.s, who, v, this.now);
  }

  async open(spec: DealSpec) {
    this.spec = spec;
    this.s = createDeal(this.s, {
      id: this.id,
      mode: spec.mode,
      title: "Сделка",
      executorId: spec.executor,
      ownerId: spec.owner,
      arbiterId: spec.arbiter,
      signed: true,
      stages: spec.stages.map((amount, i) => ({ id: `s${i + 1}`, title: `Этап ${i + 1}`, amount })),
      autoAcceptDays: spec.autoAcceptDays,
      feeBps: spec.feeBps,
      at: this.now,
    });
  }

  async sign(by: string) {
    this.s = signContract(this.s, this.id, by, this.now, `sig:${by}`);
  }
  async reserve(by: string, amount: number) {
    this.s = fund(this.s, this.id, by, amount, this.now);
  }
  async submit(by: string, stage: number) {
    this.s = submitStage(this.s, this.id, `s${stage + 1}`, by, {}, this.now);
  }
  async approve(by: string, stage: number) {
    this.s = approveStage(this.s, this.id, `s${stage + 1}`, by, this.now);
  }
  async reject(by: string, stage: number) {
    this.s = rejectStage(this.s, this.id, `s${stage + 1}`, by, "причина", this.now);
  }
  async vote(by: string, stage: number, accept: boolean) {
    this.s = voteStage(this.s, this.id, `s${stage + 1}`, by, accept ? "accept" : "reject", this.now);
  }
  async dispute(by: string, stage: number) {
    this.s = openDispute(this.s, this.id, `s${stage + 1}`, by, "причина", this.now);
  }
  async resolve(by: string, stage: number, pay: boolean) {
    this.s = resolveDispute(this.s, this.id, `s${stage + 1}`, by, pay ? "pay" : "refund", this.now);
  }
  async autoAccept(_by: string, stage: number) {
    const before = this.deal.stages[stage]?.status;
    if (before !== "submitted") throw new Error("этап не ждет приемки");
    this.s = tick(this.s, this.now);
    if (this.deal.stages[stage]?.status === "submitted") throw new Error("срок автоприемки не вышел");
  }
  async cancel(by: string) {
    this.s = cancelDeal(this.s, this.id, by, this.now);
  }
  async wait(seconds: number) {
    this.now += seconds * 1000;
  }
  async balance(who: string) {
    return freeBalance(this.s, who === "platform" ? PLATFORM_ID : who);
  }
  async state(): Promise<RailState> {
    const d = this.deal;
    return { status: d.status === "draft" ? "funding" : d.status, stages: d.stages.map((x) => x.status) };
  }
  /** для проверок: полное состояние ядра */
  get engineState(): State {
    return this.s;
  }
}

export const DAY_SECONDS = DAY_S;
