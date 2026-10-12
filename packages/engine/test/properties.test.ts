import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  EngineError,
  approveStage,
  cancelDeal,
  createDeal,
  createState,
  fund,
  openDispute,
  proposeDeal,
  reopenDeal,
  replyDispute,
  rejectStage,
  resolveDispute,
  signContract,
  signatureStatus,
  splitProRata,
  submitStage,
  tick,
  topUp,
  updateTerms,
  verifyContract,
  verifyJournal,
  voteStage,
  type Deal,
  type Mode,
  type State,
} from "../src";

/**
 * Проверка свойств: случайные последовательности действий разных участников.
 * После каждого шага проверяются инварианты денег, этапов, журнала и контракта.
 * Любая ошибка, кроме EngineError (понятного отказа движка), считается багом.
 */

const R = 100;
const PEOPLE = { owner: "anna", executor: "ivan", arbiter: "expert", s1: "olga", s2: "max", s3: "pasha", stranger: "zed" } as const;
type Role = keyof typeof PEOPLE;
const roleArb = fc.constantFrom<Role>("owner", "owner", "owner", "executor", "executor", "executor", "arbiter", "s1", "s2", "s3", "stranger");
const dealArb = fc.integer({ min: 0, max: 2 });
const stageArb = fc.integer({ min: 0, max: 3 });
const money = fc.integer({ min: 1, max: 400_000 }).map((v) => v * 1 + 0);
const stagesArb = fc.array(fc.integer({ min: 1, max: 200_000 }), { minLength: 1, maxLength: 4 });

type Act =
  | { k: "topup"; role: Role; amt: number }
  | { k: "create"; d: number; mode: Mode; stages: number[]; signed: boolean; draft: boolean; fee: number; days: number }
  | { k: "terms"; d: number; role: Role; stages: number[] }
  | { k: "propose" | "reopen" | "sign" | "cancel"; d: number; role: Role }
  | { k: "fund"; d: number; role: Role; amt: number; full: boolean }
  | { k: "submit" | "approve" | "reject" | "dispute" | "reply"; d: number; role: Role; st: number }
  | { k: "vote"; d: number; role: Role; st: number; accept: boolean }
  | { k: "resolve"; d: number; role: Role; st: number; pay: boolean }
  | { k: "tick"; dt: number };

const actArb: fc.Arbitrary<Act> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ k: fc.constant("topup" as const), role: roleArb, amt: money }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("create" as const), d: dealArb, mode: fc.constantFrom<Mode>("own", "own", "crowdfunding", "grant"), stages: stagesArb, signed: fc.boolean(), draft: fc.boolean(), fee: fc.constantFrom(0, 0, 250, 1000), days: fc.constantFrom(1, 3) }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constant("terms" as const), d: dealArb, role: roleArb, stages: stagesArb }) },
  { weight: 2, arbitrary: fc.record({ k: fc.constantFrom("propose" as const, "reopen" as const, "sign" as const, "sign" as const, "cancel" as const), d: dealArb, role: roleArb }) },
  { weight: 6, arbitrary: fc.record({ k: fc.constant("fund" as const), d: dealArb, role: roleArb, amt: money, full: fc.boolean() }) },
  { weight: 8, arbitrary: fc.record({ k: fc.constantFrom("submit" as const, "approve" as const, "reject" as const, "dispute" as const, "reply" as const), d: dealArb, role: roleArb, st: stageArb }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant("vote" as const), d: dealArb, role: roleArb, st: stageArb, accept: fc.boolean() }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("resolve" as const), d: dealArb, role: roleArb, st: stageArb, pay: fc.boolean() }) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant("tick" as const), dt: fc.constantFrom(0, 3_600_000, DAY_MS, 4 * DAY_MS) }) },
);

const LEGAL: Record<string, string[]> = {
  draft: ["draft", "funding", "cancelled"],
  funding: ["funding", "draft", "active", "cancelled"],
  active: ["active", "completed", "cancelled"],
  completed: ["completed"],
  cancelled: ["cancelled"],
};

const stats = { runs: 0, completed: 0, cancelled: 0, signed: 0, accepted: 0, steps: 0, accepts: 0 };

function check(s: State, topped: number, prev: Record<string, string>, where: string) {
  const wallets = Object.entries(s.wallets);
  for (const [u, v] of wallets) {
    expect(Number.isInteger(v) && v >= 0, `${where}: кошелек ${u} = ${v}`).toBe(true);
  }
  let reservedTotal = 0;
  for (const d of Object.values(s.deals)) {
    const reserves = Object.values(d.reserves);
    expect(reserves.every((v) => Number.isInteger(v) && v >= 0), `${where}: резервы ${d.id}`).toBe(true);
    const reserved = reserves.reduce((a, b) => a + b, 0);
    reservedTotal += reserved;
    const accepted = d.stages.filter((x) => x.status === "accepted");
    const open = d.stages.filter((x) => ["pending", "active", "submitted", "disputed"].includes(x.status));
    const openSum = open.reduce((a, x) => a + x.amount, 0);

    if (d.status === "completed" || d.status === "cancelled") expect(reserved, `${where}: резерв в закрытой сделке ${d.id}`).toBe(0);
    if (d.status === "active") expect(reserved, `${where}: резерв активной сделки ${d.id}`).toBe(openSum);
    if (d.status === "draft") expect(reserved).toBe(0);
    if (d.status === "funding") {
      expect(reserved).toBeLessThanOrEqual(d.target);
      if (d.mode !== "crowdfunding") expect([0, d.target]).toContain(reserved); // заказчик вносит всю сумму или ничего
    }
    expect(d.target, `${where}: цель ${d.id}`).toBe(d.stages.reduce((a, x) => a + x.amount, 0));

    // этапы: принятые идут префиксом, в работе не больше одного
    let seenOpen = false;
    for (const st of d.stages) {
      if (st.status === "accepted") expect(seenOpen, `${where}: принятый этап после непринятого`).toBe(false);
      else seenOpen = true;
    }
    const live = d.stages.filter((x) => ["active", "submitted", "disputed"].includes(x.status));
    expect(live.length).toBeLessThanOrEqual(1);
    if (d.status === "active") expect(live.length, `${where}: активная сделка без этапа в работе`).toBe(1);
    if (d.status === "completed") expect(accepted.length).toBe(d.stages.length);

    // деньги сделки: все резервы ушли в выплаты, комиссию и возвраты
    const led = s.ledger.filter((e) => e.dealId === d.id);
    const sum = (t: string) => led.filter((e) => e.type === t).reduce((a, e) => a + e.amount, 0);
    expect(sum("reserve"), `${where}: баланс сделки ${d.id}`).toBe(sum("payout") + sum("fee") + sum("refund") + reserved);
    expect(sum("payout") + sum("fee"), `${where}: выплаты ${d.id} не равны принятым этапам`).toBe(accepted.reduce((a, x) => a + x.amount, 0));
    expect(sum("fee")).toBe(accepted.reduce((a, x) => a + Math.floor((x.amount * d.feeBps) / 10000), 0));

    // цепочки: журнал и условия не нарушены
    expect(verifyJournal(d).ok, `${where}: журнал ${d.id}`).toBe(true);
    if (d.contract) expect(verifyContract(d).ok, `${where}: контракт ${d.id}`).toBe(true);
    if (d.status === "active" && d.signing) expect(signatureStatus(d).complete, `${where}: работа без подписей ${d.id}`).toBe(true);
    if (d.status === "active" && d.contract) expect(d.contract.hash).toHaveLength(64);

    // допустимые переходы статусов
    const before = prev[d.id];
    if (before) expect(LEGAL[before], `${where}: переход ${before} -> ${d.status} в ${d.id}`).toContain(d.status);
    prev[d.id] = d.status;
  }
  // деньги не появляются и не исчезают
  const free = wallets.reduce((a, [, v]) => a + v, 0);
  expect(free + reservedTotal, `${where}: сумма денег изменилась`).toBe(topped);
  // кошельки восстанавливаются из журнала операций
  const byUser: Record<string, number> = {};
  for (const e of s.ledger) {
    const sign = e.type === "reserve" ? -1 : 1;
    byUser[e.userId] = (byUser[e.userId] ?? 0) + sign * e.amount;
  }
  for (const [u, v] of Object.entries(byUser)) expect(s.wallets[u] ?? 0, `${where}: кошелек ${u} не сходится с журналом операций`).toBe(v);
}

const dealId = (d: number) => `d${d}`;
const stageId = (n: number) => `s${n + 1}`;

/** Применяет действие; бросает EngineError, если движок отказал. Возвращает новое состояние и сумму пополнения. */
function exec(s: State, a: Act, now: number): { s: State; topped: number; now: number } {
  const id = dealId;
  const who = (d: number, r: Role) => {
    const deal: Deal | undefined = s.deals[id(d)];
    if (deal && r === "owner") return deal.ownerId ?? PEOPLE.s1;
    return PEOPLE[r];
  };
  const stg = stageId;
  let topped = 0;
  switch (a.k) {
    case "topup": s = topUp(s, PEOPLE[a.role], a.amt * R, now); topped = a.amt * R; break;
    case "create":
      s = createDeal(s, {
        id: id(a.d), mode: a.mode, title: "x", executorId: PEOPLE.executor, ownerId: a.mode === "crowdfunding" ? undefined : PEOPLE.owner,
        arbiterId: a.mode === "own" ? PEOPLE.arbiter : undefined, signed: a.signed, status: a.draft && a.mode === "own" ? "draft" : "funding",
        stages: a.draft && a.mode === "own" ? [] : a.stages.map((v, i) => ({ id: `s${i + 1}`, title: `Э${i + 1}`, amount: v * R })), feeBps: a.fee, autoAcceptDays: a.days, at: now,
      });
      break;
    case "terms": s = updateTerms(s, id(a.d), who(a.d, a.role), { stages: a.stages.map((v, i) => ({ id: `s${i + 1}`, title: `Э${i + 1}`, amount: v * R })) }); break;
    case "propose": s = proposeDeal(s, id(a.d), who(a.d, a.role), now); break;
    case "reopen": s = reopenDeal(s, id(a.d), who(a.d, a.role), now); break;
    case "sign": s = signContract(s, id(a.d), who(a.d, a.role), now, "sig"); break;
    case "cancel": s = cancelDeal(s, id(a.d), who(a.d, a.role), now); break;
    case "fund": {
      const target = s.deals[id(a.d)]?.target ?? 1;
      s = fund(s, id(a.d), who(a.d, a.role), a.full ? target : a.amt * R, now);
      break;
    }
    case "submit": s = submitStage(s, id(a.d), stg(a.st), who(a.d, a.role), { note: "готово" }, now); break;
    case "approve": s = approveStage(s, id(a.d), stg(a.st), who(a.d, a.role), now); break;
    case "reject": s = rejectStage(s, id(a.d), stg(a.st), who(a.d, a.role), "причина", now); break;
    case "dispute": s = openDispute(s, id(a.d), stg(a.st), who(a.d, a.role), "причина", now); break;
    case "reply": s = replyDispute(s, id(a.d), stg(a.st), who(a.d, a.role), "ответ", [], now); break;
    case "vote": s = voteStage(s, id(a.d), stg(a.st), who(a.d, a.role), a.accept ? "accept" : "reject", now); break;
    case "resolve": s = resolveDispute(s, id(a.d), stg(a.st), who(a.d, a.role), a.pay ? "pay" : "refund", now); break;
    case "tick": now += a.dt; s = tick(s, now); break;
  }
  return { s, topped, now };
}

function finish() {
  stats.runs++;
}
function tally(s: State) {
  for (const d of Object.values(s.deals)) {
    if (d.status === "completed") stats.completed++;
    if (d.status === "cancelled") stats.cancelled++;
    if (d.signing && d.signatures && Object.keys(d.signatures).length > 0) stats.signed++;
    stats.accepted += d.stages.filter((x) => x.status === "accepted").length;
  }
}

/** Хаос: независимые случайные действия, в основном неверные. Проверяет, что движок отказывает, а не ломается. */
function run(acts: Act[]) {
  let s = createState();
  let now = 1_000_000;
  let topped = 0;
  const prev: Record<string, string> = {};
  for (const a of acts) {
    stats.steps++;
    now += 1000;
    try {
      const r = exec(s, a, now);
      s = r.s;
      topped += r.topped;
      now = r.now;
    } catch (e) {
      if (!(e instanceof EngineError)) throw e; // нештатная ошибка: баг, а не отказ движка
    }
    check(s, topped, prev, `шаг ${stats.steps}`);
  }
  finish();
  tally(s);
}

/** Направляемый прогон: на каждом шаге из допустимых действий выбирается одно (иногда неверное), поэтому сделки доходят до конца. */
function candidates(s: State, d: number): Act[] {
  const out: Act[] = [];
  const deal = s.deals[dealId(d)];
  for (const role of ["owner", "s1", "s2", "s3"] as Role[]) out.push({ k: "topup", role, amt: 500_000 });
  if (!deal) {
    for (const [mode, signed, draft] of [["own", true, false], ["own", true, true], ["own", false, false], ["crowdfunding", true, false], ["grant", true, false], ["own", true, false]] as [Mode, boolean, boolean][]) {
      out.push({ k: "create", d, mode, stages: [60_000, 40_000, 30_001], signed, draft, fee: [0, 250][d % 2]!, days: 1 });
    }
    return out;
  }
  const roles = Object.keys(PEOPLE) as Role[];
  const st = Math.max(0, deal.stages.findIndex((x) => ["active", "submitted", "disputed"].includes(x.status)));
  for (const role of roles) {
    out.push({ k: "sign", d, role }, { k: "propose", d, role }, { k: "cancel", d, role }, { k: "reopen", d, role });
    out.push({ k: "fund", d, role, amt: 1, full: true }, { k: "fund", d, role, amt: Math.max(1, Math.floor(deal.target / R / 3)), full: false });
    for (const k of ["submit", "approve", "reject", "dispute", "reply"] as const) out.push({ k, d, role, st });
    out.push({ k: "vote", d, role, st, accept: true }, { k: "vote", d, role, st, accept: false });
    out.push({ k: "resolve", d, role, st, pay: true }, { k: "resolve", d, role, st, pay: false });
  }
  out.push({ k: "terms", d, role: "executor", stages: [70_000, 30_000, 20_001] });
  for (const dt of [3_600_000, DAY_MS, 4 * DAY_MS]) out.push({ k: "tick", dt });
  return out;
}

function runGuided(steps: { pick: number; junk: boolean; d: number }[]) {
  let s = createState();
  let now = 1_000_000;
  let topped = 0;
  const prev: Record<string, string> = {};
  for (const step of steps) {
    stats.steps++;
    now += 1000;
    const cands = candidates(s, step.d);
    const ok: Act[] = [];
    for (const a of cands) {
      try {
        exec(s, a, now);
        ok.push(a);
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
      }
    }
    // чаще выбираем действия, двигающие сделку вперед, а не отмену, возврат на правку и пополнения
    const quiet = (x: Act) => x.k === "cancel" || x.k === "reopen" || x.k === "terms" || x.k === "topup";
    const forward = ok.filter((x) => !quiet(x));
    const pool = forward.length > 0 && step.pick % 100 >= 6 ? forward : ok;
    const a = step.junk || ok.length === 0 ? cands[step.pick % cands.length]! : pool[Math.floor(step.pick / 100) % pool.length]!;
    try {
      const r = exec(s, a, now);
      s = r.s;
      topped += r.topped;
      now = r.now;
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
    }
    check(s, topped, prev, `шаг ${stats.steps}`);
  }
  finish();
  tally(s);
}

describe("свойства ядра сделок на случайных последовательностях", () => {
  it("деньги, этапы, журнал и контракты сохраняют инварианты при любых действиях", () => {
    fc.assert(fc.property(fc.array(actArb, { minLength: 10, maxLength: 120 }), (acts) => run(acts)), { numRuns: Number(process.env.FC_RUNS ?? 400), seed: 20260101 });
  }, 120_000);

  it("направляемые прогоны: сделки проходят до приемки, завершения и отмены, и инварианты держатся", () => {
    const stepArb = fc.record({ pick: fc.nat(100_000), junk: fc.integer({ min: 0, max: 99 }).map((v) => v < 12), d: dealArb });
    fc.assert(fc.property(fc.array(stepArb, { minLength: 30, maxLength: 70 }), (steps) => runGuided(steps)), { numRuns: Number(process.env.FC_GUIDED_RUNS ?? 50), seed: 20260102 });
  }, 280_000);

  it("прогоны не пустые: сделки доходят до приемки, завершения и отмены", () => {
    // статистика накоплена предыдущими тестами (тесты файла идут по порядку)
    expect(stats.runs).toBeGreaterThan(50);
    expect(stats.accepted, JSON.stringify(stats)).toBeGreaterThan(25);
    expect(stats.completed, JSON.stringify(stats)).toBeGreaterThan(1);
    expect(stats.cancelled, JSON.stringify(stats)).toBeGreaterThan(10);
    expect(stats.signed, JSON.stringify(stats)).toBeGreaterThan(50);
  });
});

describe("свойства деления денег", () => {
  it("части делят сумму без потерь и отличаются от точной доли не больше чем на копейку", () => {
    const weights = fc.dictionary(fc.constantFrom("a", "b", "c", "d", "e", "f"), fc.integer({ min: 0, max: 10_000_000 }), { minKeys: 1 });
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), weights, (amount, w) => {
        const total = Object.values(w).reduce((a, b) => a + b, 0);
        const parts = splitProRata(amount, w);
        if (total === 0) return expect(parts).toEqual({});
        expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBe(amount);
        for (const [k, v] of Object.entries(parts)) {
          const exact = (amount * w[k]!) / total;
          expect(Number.isInteger(v) && v >= 0).toBe(true);
          expect(Math.abs(v - exact)).toBeLessThan(1);
          if (w[k] === 0) expect(v).toBe(0);
        }
      }),
      { numRuns: 1000, seed: 7 },
    );
  });

  it("доля не уменьшается с ростом веса при равных остальных", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 1, max: 100_000 }), (amount, a, b, c) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const p = splitProRata(amount, { x: lo, y: hi, z: c });
        expect(p.y!).toBeGreaterThanOrEqual(p.x! - 1); // допускается разница в одну копейку из-за округления
      }),
      { numRuns: 500, seed: 11 },
    );
  });
});
