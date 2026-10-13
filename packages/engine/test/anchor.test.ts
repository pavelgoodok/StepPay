import { describe, expect, it } from "vitest";
import { ANCHOR_GENESIS, buildAnchor, changedSince, checkAgainstAnchors, createDeal, createState, fund, signContract, submitStage, approveStage, topUp, verifyAnchorChain, verifyMoney, type Anchor, type State } from "../src";

const R = 100;
const T0 = 1_000_000;

function world(): State {
  let s = topUp(createState(), "anna", 300 * R, T0);
  s = createDeal(s, { id: "d1", mode: "own", title: "x", executorId: "ivan", ownerId: "anna", arbiterId: "expert", signed: true, stages: [{ title: "a", amount: 100 * R }, { title: "b", amount: 200 * R }], at: T0 });
  s = signContract(s, "d1", "ivan", T0 + 1, "s");
  s = signContract(s, "d1", "anna", T0 + 1, "s");
  return fund(s, "d1", "anna", 300 * R, T0 + 2);
}

describe("якоря истории", () => {
  it("цепочка якорей и сверка с историей", () => {
    let s = world();
    const a1 = buildAnchor(s, null, T0 + 10);
    expect(a1.prev).toBe(ANCHOR_GENESIS);
    s = submitStage(s, "d1", "s1", "ivan", {}, T0 + 20);
    s = approveStage(s, "d1", "s1", "anna", T0 + 30);
    expect(changedSince(s, a1)).toBe(true);
    const a2 = buildAnchor(s, a1, T0 + 40);
    expect(a2.prev).toBe(a1.root);
    expect(changedSince(s, a2)).toBe(false);
    expect(verifyAnchorChain([a1, a2]).ok).toBe(true);
    expect(checkAgainstAnchors(s, [a1, a2])).toEqual([]);
    expect(verifyMoney(s)).toEqual([]);
  });

  it("находит переписанный журнал сделки, даже если цепочка пересчитана заново", () => {
    const s = world();
    const a1 = buildAnchor(s, null, T0 + 10);
    const forged = structuredClone(s);
    const j = forged.deals.d1!.journal!;
    j[2]!.data = { ...(j[2]!.data ?? {}), forged: true };
    expect(checkAgainstAnchors(forged, [a1]).some((p) => p.reason.includes("цепочка журнала нарушена") || p.reason.includes("изменены"))).toBe(true);
  });

  it("находит обрезанный журнал и удаленную сделку", () => {
    const s = world();
    const a1 = buildAnchor(s, null, T0 + 10);
    const cut = structuredClone(s);
    cut.deals.d1!.journal!.pop();
    expect(checkAgainstAnchors(cut, [a1]).map((p) => p.reason)).toContain("журнал стал короче, чем в якоре");
    const gone = structuredClone(s);
    delete gone.deals.d1;
    expect(checkAgainstAnchors(gone, [a1]).map((p) => p.reason)).toContain("сделка из якоря пропала");
  });

  it("находит правку журнала операций и кошельков", () => {
    const s = world();
    const a1 = buildAnchor(s, null, T0 + 10);
    const bad = structuredClone(s);
    bad.ledger[0]!.amount += 1;
    expect(checkAgainstAnchors(bad, [a1]).map((p) => p.reason)).toContain("журнал операций изменен после якоря");
    const rich = structuredClone(s);
    rich.wallets.ivan = (rich.wallets.ivan ?? 0) + 5 * R;
    expect(verifyMoney(rich).some((m) => m.includes("ivan"))).toBe(true);
    const held = structuredClone(s);
    held.deals.d1!.reserves.anna = 1;
    expect(verifyMoney(held).some((m) => m.includes("d1"))).toBe(true);
  });

  it("находит подмену самих якорей: порядок, ссылки, содержимое", () => {
    const s = world();
    const a1 = buildAnchor(s, null, T0 + 10);
    const a2 = buildAnchor(s, a1, T0 + 20);
    expect(verifyAnchorChain([a2]).ok).toBe(false);
    expect(verifyAnchorChain([a1, { ...a2, prev: "00" }]).ok).toBe(false);
    const edited: Anchor = { ...a1, at: a1.at + 1 };
    expect(verifyAnchorChain([edited, a2]).brokenAt).toBe(1);
    expect(verifyAnchorChain([a1, { ...a2, ledgerLen: 0 }]).brokenAt).toBe(2);
  });
});
