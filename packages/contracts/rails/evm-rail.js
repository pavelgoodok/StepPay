const hre = require("hardhat");
const { ethers } = hre;

const MODE = { own: 0, crowdfunding: 1, grant: 2 };
const STATUS = ["funding", "active", "completed", "cancelled"];
const STAGE = ["pending", "active", "submitted", "accepted", "disputed", "failed"];
/** Участники сценариев: каждому достается свой адрес в тестовой сети. */
const ACTORS = ["anna", "ivan", "expert", "olga", "max", "pasha", "author", "stranger", "fond", "studio", "reserve"];

/**
 * Денежный рельс на эталонном контракте StepEscrow. Реализует тот же интерфейс MoneyRail, что и эмулятор
 * на ядре сделок (packages/engine/src/rail.ts): одни сценарии, одни ожидаемые результаты.
 */
class EvmRail {
  async init(balances) {
    const signers = await ethers.getSigners();
    this.who = Object.fromEntries(ACTORS.map((name, i) => [name, signers[i]]));
    this.platform = signers[19];
    this.token = await (await ethers.getContractFactory("TestRub")).deploy();
    this.escrow = await (await ethers.getContractFactory("StepEscrow")).deploy(await this.token.getAddress(), this.platform.address);
    this.escrowAddress = await this.escrow.getAddress();
    for (const [name, v] of Object.entries(balances)) {
      await (await this.token.mint(this.who[name].address, BigInt(v))).wait();
      await (await this.token.connect(this.who[name]).approve(this.escrowAddress, ethers.MaxUint256)).wait();
    }
    this.minted = Object.values(balances).reduce((a, b) => a + BigInt(b), 0n);
  }

  async open(spec) {
    const zero = ethers.ZeroAddress;
    const day = 86_400;
    // все условия одной структурой, включая неустойку (createDealWith)
    await (
      await this.escrow.createDealWith(
        {
          mode: MODE[spec.mode],
          executor: this.who[spec.executor].address,
          owner: spec.owner ? this.who[spec.owner].address : zero,
          arbiter: spec.arbiter ? this.who[spec.arbiter].address : zero,
          autoAcceptSecs: spec.autoAcceptDays * 86_400,
          feeBps: spec.feeBps,
          contractHash: ethers.id("rail-deal"),
          deadlines: { fundingSecs: (spec.fundingDeadlineDays ?? 0) * day, stageSecs: (spec.stageDeadlineDays ?? 0) * day, disputeSecs: (spec.disputeDays ?? 0) * day },
          backupArbiter: spec.backupArbiter ? this.who[spec.backupArbiter].address : zero,
          penalty: { bpsPerDay: spec.penaltyBpsPerDay ?? 0, capBps: spec.penaltyCapBps ?? 0 },
        },
        spec.stages.map(BigInt),
      )
    ).wait();
  }

  async #send(by, fn) {
    const signer = this.who[by];
    if (!signer) throw new Error(`неизвестный участник ${by}`);
    await (await fn(this.escrow.connect(signer))).wait();
  }

  sign(by) { return this.#send(by, (c) => c.sign(1)); }
  reserve(by, amount) { return this.#send(by, (c) => c.fund(1, BigInt(amount))); }
  submit(by, stage) { return this.#send(by, (c) => c.submitStage(1, stage, ethers.id("evidence"))); }
  approve(by, stage) { return this.#send(by, (c) => c.approveStage(1, stage)); }
  reject(by, stage) { return this.#send(by, (c) => c.rejectStage(1, stage, ethers.id("reason"))); }
  vote(by, stage, accept) { return this.#send(by, (c) => c.vote(1, stage, accept)); }
  dispute(by, stage) { return this.#send(by, (c) => c.openDispute(1, stage, ethers.id("reason"))); }
  resolve(by, stage, pay) { return this.#send(by, (c) => c.resolveDispute(1, stage, pay)); }
  autoAccept(by, stage) { return this.#send(by ?? "stranger", (c) => c.autoAccept(1, stage)); }
  cancel(by) { return this.#send(by, (c) => c.cancel(1)); }

  expire(by, what, stage) {
    return this.#send(by ?? "stranger", (c) => (what === "funding" ? c.expireFunding(1) : what === "stage" ? c.expireStage(1, stage) : c.expireDispute(1, stage)));
  }

  async wait(seconds) {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine");
  }

  async balance(who) {
    const addr = who === "platform" ? this.platform.address : this.who[who].address;
    return Number(await this.token.balanceOf(addr));
  }

  async state() {
    const d = await this.escrow.getDeal(1);
    const stages = [];
    for (let i = 0; i < Number(d.stageCount ?? d[8]); i++) stages.push(STAGE[Number((await this.escrow.getStage(1, i))[1])]);
    return { status: STATUS[Number(d[1])], stages };
  }
}

module.exports = { EvmRail };
