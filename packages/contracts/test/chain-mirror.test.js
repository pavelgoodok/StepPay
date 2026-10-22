// Зеркало сделок на контракте: действия идут в ядре сделок, а ChainMirror повторяет их на StepEscrow и сверяет итог.
require("tsx/cjs");
const assert = require("node:assert/strict");
const hre = require("hardhat");
const { ethers } = hre;
const E = require("@steppay/engine");
const { ChainMirror, EthersChain } = require("../../../apps/api/src/chain.ts");

const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // первый тестовый аккаунт Hardhat
const R = 100;
const DAY = 86_400_000;
let T = 1_700_000_000_000;
const tick = (ms = 1000) => (T += ms);

async function setup() {
  const token = await (await ethers.getContractFactory("TestRub")).deploy();
  const [deployer] = await ethers.getSigners();
  const escrow = await (await ethers.getContractFactory("StepEscrow")).deploy(await token.getAddress(), deployer.address);
  const chain = new EthersChain({ provider: ethers.provider, network: "Hardhat", chainId: 31337, escrow: await escrow.getAddress(), token: await token.getAddress(), deployerKey: DEPLOYER_KEY, seed: "test-seed" });
  const data = { since: 0, deals: {} };
  const mirror = new ChainMirror({ chain, data, persist: async () => {}, now: () => T, eligible: () => true, retryMs: 3_600_000 });
  return { chain, mirror, data, token, escrow };
}

/** Применяет действие ядра и отдает новое состояние зеркалу, как это делает транзакция API. */
async function run(ctx, st, fn) {
  const next = fn(st);
  ctx.mirror.notify(next);
  await ctx.mirror.idle();
  return next;
}

const base = (extra) => ({ id: "d1", title: "Ремонт", stages: [{ title: "Плитка", amount: 1000 * R }, { title: "Сантехника", amount: 500 * R }], signed: true, at: T, ...extra });

describe("зеркало контракта: сделка в ядре повторяется на StepEscrow", () => {
  it("личная сделка до конца: подписи, резерв, приемка этапов, комиссия", async () => {
    const ctx = await setup();
    let s = E.topUp(E.createState(), "anna", 2000 * R, T);
    s = await run(ctx, s, (x) => E.createDeal(x, base({ mode: "own", executorId: "ivan", ownerId: "anna", arbiterId: "expert", autoAcceptDays: 3, feeBps: 100, stageDeadlineDays: 30, disputeDays: 14 })));
    s = await run(ctx, s, (x) => E.signContract(x, "d1", "ivan", tick(), "sig"));
    s = await run(ctx, s, (x) => E.signContract(x, "d1", "anna", tick(), "sig"));
    s = await run(ctx, s, (x) => E.fund(x, "d1", "anna", 1500 * R, tick()));
    assert.equal(s.deals.d1.status, "active");
    s = await run(ctx, s, (x) => E.submitStage(x, "d1", "s1", "ivan", { note: "готово" }, tick()));
    s = await run(ctx, s, (x) => E.approveStage(x, "d1", "s1", "anna", tick()));
    s = await run(ctx, s, (x) => E.submitStage(x, "d1", "s2", "ivan", { note: "готово" }, tick()));
    s = await run(ctx, s, (x) => E.approveStage(x, "d1", "s2", "anna", tick()));
    assert.equal(s.deals.d1.status, "completed");
    assert.equal(ctx.mirror.state("d1").state, "synced", ctx.mirror.state("d1").error);
    const v = await ctx.mirror.verify(s, "d1");
    assert.deepEqual(v.diffs, []);
    assert.ok(v.ok && v.applied);
    // деньги исполнителя и комиссия совпадают с ядром
    assert.equal(Number(await ctx.token.balanceOf(ctx.chain.addressOf("ivan"))), s.wallets.ivan);
    assert.equal(Number(await ctx.token.balanceOf((await ethers.getSigners())[0].address)), s.wallets.platform);
    const link = ctx.mirror.link("d1");
    assert.ok(link.txs.length >= 8 && link.dealId === 1 && link.contract);
  });

  it("отказ, спор и решение приемщика в пользу исполнителя", async () => {
    const ctx = await setup();
    let s = E.topUp(E.createState(), "anna", 1500 * R, T);
    s = await run(ctx, s, (x) => E.createDeal(x, base({ mode: "own", executorId: "ivan", ownerId: "anna", arbiterId: "expert", autoAcceptDays: 3, stageDeadlineDays: 30, disputeDays: 14 })));
    s = await run(ctx, s, (x) => E.signContract(x, "d1", "ivan", tick(), "sig"));
    s = await run(ctx, s, (x) => E.signContract(x, "d1", "anna", tick(), "sig"));
    s = await run(ctx, s, (x) => E.fund(x, "d1", "anna", 1500 * R, tick()));
    s = await run(ctx, s, (x) => E.submitStage(x, "d1", "s1", "ivan", { note: "готово" }, tick()));
    s = await run(ctx, s, (x) => E.rejectStage(x, "d1", "s1", "anna", "швы кривые", tick()));
    s = await run(ctx, s, (x) => E.replyDispute(x, "d1", "s1", "ivan", "переделаю", [], tick())); // реплики остаются вне сети
    s = await run(ctx, s, (x) => E.resolveDispute(x, "d1", "s1", "expert", "pay", tick(), "швы в допуске"));
    const v = await ctx.mirror.verify(s, "d1");
    assert.deepEqual(v.diffs, []);
    assert.equal(s.deals.d1.stages[0].status, "accepted");
  });

  it("краудфандинг: взносы спонсоров и приемка этапа голосованием", async () => {
    const ctx = await setup();
    let s = E.topUp(E.topUp(E.createState(), "max", 600 * R, T), "olga", 400 * R, T);
    s = await run(ctx, s, (x) => E.createDeal(x, base({ id: "c1", mode: "crowdfunding", executorId: "author", stages: [{ title: "Прототип", amount: 600 * R }, { title: "Запуск", amount: 400 * R }], autoAcceptDays: 3, fundingDeadlineDays: 30, stageDeadlineDays: 30 })));
    s = await run(ctx, s, (x) => E.signContract(x, "c1", "author", tick(), "sig"));
    s = await run(ctx, s, (x) => E.fund(x, "c1", "max", 600 * R, tick()));
    s = await run(ctx, s, (x) => E.fund(x, "c1", "olga", 400 * R, tick()));
    s = await run(ctx, s, (x) => E.submitStage(x, "c1", "s1", "author", { note: "готово" }, tick()));
    s = await run(ctx, s, (x) => E.voteStage(x, "c1", "s1", "max", "accept", tick()));
    assert.equal(s.deals.c1.stages[0].status, "accepted");
    const v = await ctx.mirror.verify(s, "c1");
    assert.deepEqual(v.diffs, []);
  });

  it("отмена с возвратом и срок сбора", async () => {
    const ctx = await setup();
    let s = E.topUp(E.createState(), "anna", 1500 * R, T);
    s = await run(ctx, s, (x) => E.createDeal(x, base({ mode: "own", executorId: "ivan", ownerId: "anna", arbiterId: "expert", autoAcceptDays: 3 })));
    s = await run(ctx, s, (x) => E.signContract(x, "d1", "ivan", tick(), "sig"));
    s = await run(ctx, s, (x) => E.signContract(x, "d1", "anna", tick(), "sig"));
    s = await run(ctx, s, (x) => E.fund(x, "d1", "anna", 1500 * R, tick()));
    s = await run(ctx, s, (x) => E.cancelDeal(x, "d1", "anna", tick()));
    const v = await ctx.mirror.verify(s, "d1");
    assert.deepEqual(v.diffs, []);
    assert.equal(s.deals.d1.status, "cancelled");
  });

  it("автоприемка по времени: пока срок на цепочке не вышел, действие ждет, потом проходит", async () => {
    const ctx = await setup();
    let s = E.topUp(E.createState(), "anna", 1500 * R, T);
    s = await run(ctx, s, (x) => E.createDeal(x, base({ mode: "own", executorId: "ivan", ownerId: "anna", arbiterId: "expert", autoAcceptDays: 3, stageDeadlineDays: 30 })));
    s = await run(ctx, s, (x) => E.signContract(x, "d1", "ivan", tick(), "sig"));
    s = await run(ctx, s, (x) => E.signContract(x, "d1", "anna", tick(), "sig"));
    s = await run(ctx, s, (x) => E.fund(x, "d1", "anna", 1500 * R, tick()));
    s = await run(ctx, s, (x) => E.submitStage(x, "d1", "s1", "ivan", { note: "готово" }, tick()));
    s = await run(ctx, s, (x) => E.tick(x, T + 4 * DAY)); // в ядре срок вышел, на цепочке время не сдвинули
    assert.equal(s.deals.d1.stages[0].status, "accepted");
    const st = ctx.mirror.state("d1");
    assert.equal(st.state, "syncing", "контракт отказал: срок еще не вышел");
    await hre.network.provider.send("evm_increaseTime", [4 * 86_400]);
    await hre.network.provider.send("evm_mine");
    ctx.mirror.notify(s);
    await ctx.mirror.idle();
    ctx.mirror.stop();
    assert.equal(ctx.mirror.state("d1").state, "synced", ctx.mirror.state("d1").error);
    assert.deepEqual((await ctx.mirror.verify(s, "d1")).diffs, []);
  });

  it("сверка замечает расхождение, а сделки до включения зеркала не переносятся", async () => {
    const ctx = await setup();
    ctx.data.since = T + 10 * DAY; // зеркало включили позже создания сделки
    let s = E.topUp(E.createState(), "anna", 1500 * R, T);
    s = await run(ctx, s, (x) => E.createDeal(x, base({ mode: "own", executorId: "ivan", ownerId: "anna", arbiterId: "expert", autoAcceptDays: 3 })));
    assert.equal(ctx.mirror.state("d1"), undefined);
    ctx.data.since = 0;
    s = await run(ctx, s, (x) => E.signContract(x, "d1", "ivan", tick(), "sig"));
    s = await run(ctx, s, (x) => E.signContract(x, "d1", "anna", tick(), "sig"));
    s = await run(ctx, s, (x) => E.fund(x, "d1", "anna", 1500 * R, tick()));
    // портим ядро: резерв в ядре стал другим
    const bad = structuredClone(s);
    bad.deals.d1.reserves.anna -= 100;
    const v = await ctx.mirror.verify(bad, "d1");
    assert.equal(v.ok, false);
    assert.ok(v.diffs.some((x) => x.includes("Резерв")));
  });

  it("кошелек участника: адрес, эфир на газ и выдача тестовых токенов на настоящем контракте", async () => {
    const ctx = await setup();
    const before = await ctx.chain.wallet("anna");
    assert.match(before.address, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(before.tokens, 0);
    const hash = await ctx.chain.faucet("anna", 12_345);
    assert.match(hash, /^0x[0-9a-f]{64}$/);
    const after = await ctx.chain.wallet("anna");
    assert.equal(after.tokens, 12_345);
    assert.ok(BigInt(after.eth) > 0n, "участник получил эфир на газ");
    assert.equal(ctx.chain.addressOf("anna"), before.address, "адрес стабилен");
    assert.notEqual(ctx.chain.addressOf("ivan"), before.address);
  });

  it("новый адрес контракта: прежние сделки за ним не переносятся, новые создаются в новом контракте", async () => {
    const ctx = await setup();
    let s = E.topUp(E.createState(), "anna", 5000 * R, T);
    s = await run(ctx, s, (x) => E.createDeal(x, base({ mode: "own", executorId: "ivan", ownerId: "anna", arbiterId: "expert", autoAcceptDays: 3 })));
    s = await run(ctx, s, (x) => E.signContract(x, "d1", "ivan", tick(), "sig"));
    assert.equal(ctx.mirror.link("d1").contract, await ctx.escrow.getAddress());
    // развернута новая версия: тот же токен и та же история зеркала, другой адрес
    const [deployer] = await ethers.getSigners();
    const escrow2 = await (await ethers.getContractFactory("StepEscrow")).deploy(await ctx.token.getAddress(), deployer.address);
    const chain2 = new EthersChain({ provider: ethers.provider, network: "Hardhat", chainId: 31337, escrow: await escrow2.getAddress(), token: await ctx.token.getAddress(), deployerKey: DEPLOYER_KEY, seed: "test-seed" });
    const mirror2 = new ChainMirror({ chain: chain2, data: ctx.data, persist: async () => {}, now: () => T, eligible: () => true, retryMs: 3_600_000 });
    s = E.createDeal(s, { ...base({ mode: "own", executorId: "ivan", ownerId: "anna", arbiterId: "expert", autoAcceptDays: 3, stageDeadlineDays: 10, penaltyBpsPerDay: 50, penaltyCapBps: 1000 }), id: "d2", at: tick() });
    s = E.signContract(s, "d1", "anna", tick(), "sig");
    s = E.signContract(s, "d2", "ivan", tick(), "sig"); // сделка попадает в контракт с первой подписью
    mirror2.notify(s);
    await mirror2.idle();
    assert.equal(mirror2.state("d1").state, "failed"); // старая сделка осталась в прежнем контракте
    assert.equal(mirror2.link("d1").contract, await ctx.escrow.getAddress());
    assert.equal(mirror2.state("d2").state, "synced", mirror2.state("d2").error);
    assert.equal(mirror2.link("d2").contract, await escrow2.getAddress());
    assert.equal(mirror2.link("d2").dealId, 1);
    assert.deepEqual([...(await escrow2.getPenalty(1, 0))].slice(0, 2), [50n, 1000n]); // неустойка перенесена в контракт
    assert.equal(Number((await ctx.escrow.getDeal(1))[1]), 0); // в старом контракте сделка не тронута
  });
});
