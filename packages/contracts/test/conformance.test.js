// Одни и те же сценарии идут на эмуляторе (ядро сделок) и на контракте StepEscrow с одинаковыми ожидаемыми результатами.
require("tsx/cjs");
const assert = require("node:assert/strict");
const { EmulatedRail, RAIL_SCENARIOS, runScenario } = require("@steppay/engine");
const { EvmRail } = require("../rails/evm-rail");

describe("денежные рельсы: контракт StepEscrow дает те же результаты, что и ядро сделок", () => {
  for (const sc of RAIL_SCENARIOS) {
    it(sc.name, async () => {
      const evm = await runScenario(new EvmRail(), sc);
      assert.deepEqual(evm.accepted, sc.steps.map((s) => !s.fails), "принятые и отклоненные шаги");
      assert.deepEqual(evm.balances, sc.expect.balances, "итоговые балансы");
      assert.deepEqual(evm.state, { status: sc.expect.status, stages: sc.expect.stages }, "статусы сделки и этапов");
      // прямое сравнение с эмулятором: любой сценарий дает одинаковый результат на обоих рельсах
      const emu = await runScenario(new EmulatedRail(), sc);
      assert.deepEqual(evm, emu, "рельсы разошлись");
    });
  }
});
