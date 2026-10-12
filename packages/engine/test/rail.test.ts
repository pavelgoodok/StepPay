import { describe, expect, it } from "vitest";
import { EmulatedRail, RAIL_SCENARIOS, runScenario } from "../src";

describe("денежный рельс: эмулятор на ядре сделок", () => {
  for (const sc of RAIL_SCENARIOS) {
    it(sc.name, async () => {
      const r = await runScenario(new EmulatedRail(), sc);
      expect(r.accepted).toEqual(sc.steps.map((s) => !s.fails)); // отклоненные шаги отклонены, остальные приняты
      expect(r.balances).toEqual(sc.expect.balances);
      expect(r.state).toEqual({ status: sc.expect.status, stages: sc.expect.stages });
    });
  }

  it("в любом сценарии деньги сохраняются: всего столько, сколько выдали", async () => {
    for (const sc of RAIL_SCENARIOS) {
      const rail = new EmulatedRail();
      await runScenario(rail, sc);
      const s = rail.engineState;
      const total = Object.values(s.wallets).reduce((a, b) => a + b, 0) + Object.values(s.deals).reduce((a, d) => a + Object.values(d.reserves).reduce((x, y) => x + y, 0), 0);
      expect(total, sc.name).toBe(Object.values(sc.balances).reduce((a, b) => a + b, 0));
    }
  });
});
