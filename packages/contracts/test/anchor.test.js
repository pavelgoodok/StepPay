const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { ethers, reverts, increaseTime } = require("./helpers");
const { publishAnchors, checkAnchors } = require("../rails/anchor-chain");

const root = (i) => createHash("sha256").update(`root-${i}`).digest("hex");
const anchors = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1, root: root(i + 1) }));

describe("StepAnchor: внешний якорь истории", () => {
  let anchor, publisher, other;
  beforeEach(async () => {
    [publisher, other] = await ethers.getSigners();
    anchor = await (await ethers.getContractFactory("StepAnchor")).deploy(publisher.address);
  });

  it("записывает корни по порядку и отдает их обратно", async () => {
    assert.deepEqual(await publishAnchors(anchor, anchors(3)), [1, 2, 3]);
    assert.equal(await anchor.count(), 3n);
    assert.equal((await anchor.roots(2)).slice(2), root(2));
    assert.deepEqual(await publishAnchors(anchor, anchors(5)), [4, 5]); // только новые
    assert.deepEqual(await checkAnchors(anchor, anchors(5)), []);
  });

  it("не принимает чужого издателя, пропуск номера, перезапись и пустой корень", async () => {
    await reverts(anchor.connect(other).anchor(1, "0x" + root(1)), "Unauthorized");
    await reverts(anchor.anchor(2, "0x" + root(2)), "BadNumber");
    await anchor.anchor(1, "0x" + root(1));
    await reverts(anchor.anchor(1, "0x" + root(9)), "BadNumber"); // раз записанный корень не меняется
    await reverts(anchor.anchor(2, ethers.ZeroHash), "BadNumber");
  });

  it("сверка находит переписанную историю платформы и урезанный список", async () => {
    await publishAnchors(anchor, anchors(3));
    const forged = anchors(3);
    forged[1].root = root(99); // платформа пересчитала второй якорь
    const p = await checkAnchors(anchor, forged);
    assert.equal(p.length, 1);
    assert.match(p[0], /№2/);
    assert.match((await checkAnchors(anchor, anchors(2)))[0], /урезана/);
  });

  it("запоминает время записи", async () => {
    await anchor.anchor(1, "0x" + root(1));
    const t1 = await anchor.anchoredAt(1);
    await increaseTime(3600);
    await anchor.anchor(2, "0x" + root(2));
    assert.ok((await anchor.anchoredAt(2)) >= t1 + 3600n);
  });
});
