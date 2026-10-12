// Дифференциальная проверка: случайные сценарии идут на ядре сделок и на контракте StepEscrow,
// принятые и отклоненные шаги, балансы и статусы обязаны совпасть до копейки.
require("tsx/cjs");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const { EmulatedRail, runScenario } = require("@steppay/engine");
const { EvmRail } = require("../rails/evm-rail");

const R = 100;
const START = 1_000_000 * R;
const HOUR = 3600;

const CAST = {
  own: { executor: "ivan", owner: "anna", arbiter: "expert", sponsors: [] },
  crowdfunding: { executor: "author", sponsors: ["olga", "max", "pasha"] },
  grant: { executor: "studio", owner: "fond", sponsors: [] },
};
const ALL = ["anna", "ivan", "expert", "olga", "max", "pasha", "author", "stranger", "fond", "studio"];

const waitArb = fc.constantFrom(0, HOUR, 12 * HOUR, 23 * HOUR, 24 * HOUR, 48 * HOUR, 72 * HOUR, 96 * HOUR);

/** Случайный шаг любого участника: чаще неверный, проверяет, что оба рельса отказывают одинаково. */
const noise = (mode) =>
  fc.oneof(
    fc.record({ do: fc.constantFrom("sign", "cancel"), by: fc.constantFrom(...ALL) }),
    fc.record({ do: fc.constant("reserve"), by: fc.constantFrom(...ALL), amount: fc.integer({ min: 1, max: 400_000 }).map((v) => v * R) }),
    fc.record({ do: fc.constantFrom("submit", "approve", "reject", "dispute"), by: fc.constantFrom(...ALL), stage: fc.integer({ min: 0, max: 3 }) }),
    fc.record({ do: fc.constant("vote"), by: fc.constantFrom(...ALL), stage: fc.integer({ min: 0, max: 3 }), accept: fc.boolean() }),
    fc.record({ do: fc.constant("resolve"), by: fc.constantFrom(...ALL), stage: fc.integer({ min: 0, max: 3 }), pay: fc.boolean() }),
    fc.record({ do: fc.constant("autoAccept"), by: fc.constant("stranger"), stage: fc.integer({ min: 0, max: 3 }) }),
    fc.record({ do: fc.constant("wait"), seconds: waitArb }),
  ).map((s) => ({ ...s, mode }));

/** Правильный ход этапа: сдача и затем один из способов закрыть его. */
function stagePlan(mode, c, stage) {
  const submit = { do: "submit", by: c.executor, stage };
  if (mode === "own")
    return fc.oneof(
      fc.constant([submit, { do: "approve", by: c.owner, stage }]),
      fc.constant([submit, { do: "reject", by: c.owner, stage }, { do: "resolve", by: c.arbiter, stage, pay: true }]),
      fc.constant([submit, { do: "reject", by: c.owner, stage }, { do: "resolve", by: c.arbiter, stage, pay: false }]),
      fc.constant([submit, { do: "dispute", by: c.executor, stage }, { do: "resolve", by: c.arbiter, stage, pay: true }]),
      waitArb.map((w) => [submit, { do: "wait", seconds: w }, { do: "autoAccept", by: "stranger", stage }]),
    );
  if (mode === "grant") return fc.oneof(fc.constant([submit, { do: "approve", by: c.owner, stage }]), fc.constant([submit, { do: "reject", by: c.owner, stage }]));
  return fc.oneof(
    fc.constant([submit, ...c.sponsors.map((by) => ({ do: "vote", by, stage, accept: true }))]),
    fc.constant([submit, ...c.sponsors.map((by) => ({ do: "vote", by, stage, accept: false }))]),
    fc.constant([submit, { do: "vote", by: c.sponsors[0], stage, accept: true }, { do: "vote", by: c.sponsors[1], stage, accept: false }, { do: "vote", by: c.sponsors[2], stage, accept: true }]),
    waitArb.map((w) => [submit, { do: "wait", seconds: w }, { do: "autoAccept", by: "stranger", stage }]),
  );
}

const scenarioArb = fc.constantFrom("own", "crowdfunding", "grant").chain((mode) => {
  const c = CAST[mode];
  return fc
    .record({
      stages: fc.array(fc.integer({ min: 1, max: 150_000 }), { minLength: 1, maxLength: 3 }),
      fee: fc.constantFrom(0, 0, 100, 250),
      days: fc.constantFrom(1, 3),
      // взносы: заказчик вносит всю сумму, спонсоры произвольные доли (в копейках, неровные)
      shares: fc.array(fc.integer({ min: 1, max: 100_000_00 }), { minLength: 3, maxLength: 3 }),
      order: fc.shuffledSubarray(["sign-a", "sign-b", "reserve"], { minLength: 3, maxLength: 3 }),
      noiseBefore: fc.array(noise(mode), { maxLength: 4 }),
    })
    .chain((base) => {
      const stageAmounts = base.stages.map((v) => v * R + (mode === "crowdfunding" ? (v % 97) : 0));
      const total = stageAmounts.reduce((a, b) => a + b, 0);
      return fc
        .tuple(...stageAmounts.map((_, i) => fc.tuple(stagePlan(mode, c, i), fc.array(noise(mode), { maxLength: 2 }))))
        .map((plans) => ({ mode, c, base, stageAmounts, total, plans }));
    });
});

function build({ mode, c, base, stageAmounts, total, plans }) {
  const steps = [...base.noiseBefore];
  const owner = c.owner;
  const prelude = [];
  for (const o of base.order) {
    if (o === "sign-a") prelude.push({ do: "sign", by: c.executor });
    if (o === "sign-b") prelude.push(...(mode === "crowdfunding" ? [{ do: "sign", by: c.executor }] : [{ do: "sign", by: owner }]));
    if (o === "reserve") {
      if (mode === "crowdfunding") {
        // три спонсора вносят неровные доли, сумма не больше цели
        const raw = base.shares;
        const sum = raw.reduce((a, b) => a + b, 0);
        let left = total;
        raw.forEach((r, i) => {
          const part = i === raw.length - 1 ? left : Math.max(1, Math.floor((r / sum) * total));
          const amount = Math.min(part, left);
          left -= amount;
          if (amount > 0) prelude.push({ do: "reserve", by: c.sponsors[i], amount });
        });
      } else prelude.push({ do: "reserve", by: owner, amount: total });
    }
  }
  steps.push(...prelude);
  for (const [plan, nz] of plans) steps.push(...plan, ...nz);
  const balances = Object.fromEntries(ALL.map((a) => [a, START]));
  return {
    name: "случайный",
    balances,
    deal: { mode, executor: c.executor, owner: c.owner, arbiter: c.arbiter, stages: stageAmounts, autoAcceptDays: mode === "grant" ? 0 : base.days, feeBps: base.fee },
    steps,
    expect: { balances: { ...balances, platform: 0 }, status: "funding", stages: [] },
  };
}

describe("дифференциальная проверка рельсов на случайных сценариях", () => {
  it("ядро сделок и контракт StepEscrow дают одинаковые результаты", async function () {
    this.timeout(280_000);
    const runs = Number(process.env.FC_DIFF_RUNS ?? 40);
    let completed = 0;
    let cancelled = 0;
    let rejected = 0;
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (raw) => {
        const sc = build(raw);
        const emu = await runScenario(new EmulatedRail(), sc);
        const evm = await runScenario(new EvmRail(), sc);
        assert.deepEqual(evm.accepted, emu.accepted, "принятые и отклоненные шаги разошлись");
        assert.deepEqual(evm.balances, emu.balances, "балансы разошлись");
        assert.deepEqual(evm.state, emu.state, "статусы разошлись");
        // деньги сохраняются на обоих рельсах
        const total = Object.values(evm.balances).reduce((a, b) => a + b, 0);
        assert.ok(total <= ALL.length * START, "создались лишние деньги");
        if (evm.state.status === "completed") completed++;
        if (evm.state.status === "cancelled") cancelled++;
        rejected += evm.accepted.filter((x) => !x).length;
      }),
      { numRuns: runs, seed: 20260103, endOnFailure: true },
    );
    console.log(`      прогонов ${runs}: завершено ${completed}, отменено ${cancelled}, отклоненных шагов ${rejected}`);
    assert.ok(completed + cancelled > runs / 4, "случайные сценарии слишком редко доходят до конца");
  });
});
