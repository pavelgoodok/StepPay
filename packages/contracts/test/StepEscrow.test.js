const assert = require("node:assert/strict");
const { ethers, Mode, DealStatus, StageStatus, R, DAY, ZERO, hash, deploy, giveTokens, reverts, increaseTime, splitProRata } = require("./helpers");

describe("StepEscrow: свои сделки", () => {
  let token, escrow, escrowAddress, anna, ivan, expert, olga, feeTo, stranger;
  beforeEach(async () => {
    const d = await deploy();
    ({ token, escrow, escrowAddress } = d);
    [anna, ivan, expert, olga, , , , , stranger, feeTo] = d.signers;
    await giveTokens(token, escrowAddress, anna, 1_000_000n * R);
  });

  const createOwn = (amounts = [120_000n * R, 60_000n * R, 90_000n * R, 30_000n * R], fee = 0) =>
    escrow.createDeal(Mode.Own, ivan.address, anna.address, expert.address, amounts, 3 * DAY, fee, hash("условия"));

  it("работа начинается после резерва и подписей обеих сторон, в любом порядке", async () => {
    await createOwn();
    const total = 300_000n * R;
    await escrow.connect(anna).fund(1, total);
    let [, status] = await escrow.getDeal(1);
    assert.equal(status, BigInt(DealStatus.Funding)); // деньги есть, подписей нет
    await reverts(escrow.connect(ivan).submitStage(1, 0, hash("x")), "BadState");
    await escrow.connect(anna).sign(1);
    [, status] = await escrow.getDeal(1);
    assert.equal(status, BigInt(DealStatus.Funding));
    await escrow.connect(ivan).sign(1);
    [, status] = await escrow.getDeal(1);
    assert.equal(status, BigInt(DealStatus.Active));
    assert.equal((await escrow.getStage(1, 0))[1], BigInt(StageStatus.Active));
  });

  it("сделка проходит от резерва до завершения, деньги сходятся", async () => {
    await createOwn();
    await escrow.connect(ivan).sign(1);
    await escrow.connect(anna).sign(1);
    await escrow.connect(anna).fund(1, 300_000n * R);
    assert.equal(await token.balanceOf(escrowAddress), 300_000n * R);
    assert.equal(await escrow.totalLocked(), 300_000n * R);

    await escrow.connect(ivan).submitStage(1, 0, hash("плитка"));
    await escrow.connect(anna).approveStage(1, 0);
    assert.equal(await token.balanceOf(ivan.address), 120_000n * R);
    for (const [i, amount] of [[1, 60_000n], [2, 90_000n], [3, 30_000n]]) {
      await escrow.connect(ivan).submitStage(1, i, hash("этап" + i));
      await escrow.connect(anna).approveStage(1, i);
      assert.ok((await token.balanceOf(ivan.address)) >= amount * R);
    }
    assert.equal(await token.balanceOf(ivan.address), 300_000n * R);
    assert.equal((await escrow.getDeal(1))[1], BigInt(DealStatus.Completed));
    assert.equal(await token.balanceOf(escrowAddress), 0n);
    assert.equal(await escrow.totalLocked(), 0n);
  });

  it("хеш контракта хранится в сделке", async () => {
    await createOwn();
    assert.equal((await escrow.getDeal(1))[5], hash("условия"));
  });

  it("права и состояния: чужие вызовы, повторный резерв, неверная сумма", async () => {
    await createOwn();
    await reverts(escrow.connect(stranger).sign(1), "Unauthorized");
    await reverts(escrow.connect(stranger).fund(1, 300_000n * R), "Unauthorized");
    await reverts(escrow.connect(anna).fund(1, 100n * R), "BadInput"); // нужна вся сумма
    await escrow.connect(anna).fund(1, 300_000n * R);
    await reverts(escrow.connect(anna).fund(1, 300_000n * R), "BadInput"); // повторный резерв
    await escrow.connect(ivan).sign(1);
    await reverts(escrow.connect(ivan).sign(1), "BadState"); // подпись одна
    await escrow.connect(anna).sign(1);
    await reverts(escrow.connect(anna).submitStage(1, 0, hash("x")), "Unauthorized"); // сдает только исполнитель
    await escrow.connect(ivan).submitStage(1, 0, hash("x"));
    await reverts(escrow.connect(ivan).submitStage(1, 0, hash("x")), "BadState");
    await reverts(escrow.connect(ivan).submitStage(1, 1, hash("x")), "BadState"); // этап еще не в работе
    await reverts(escrow.connect(ivan).approveStage(1, 0), "Unauthorized"); // принимает заказчик
    await reverts(escrow.connect(anna).approveStage(1, 1), "BadState");
    await reverts(escrow.connect(anna).approveStage(1, 9), "BadInput");
    await reverts(escrow.connect(anna).cancel(1), "BadState"); // этап на приемке: сначала закрыть
  });

  it("отказ открывает спор: приемщик выплачивает или возвращает остаток", async () => {
    await createOwn();
    await escrow.connect(ivan).sign(1);
    await escrow.connect(anna).sign(1);
    await escrow.connect(anna).fund(1, 300_000n * R);
    await escrow.connect(ivan).submitStage(1, 0, hash("плитка"));
    await reverts(escrow.connect(anna).rejectStage(1, 0, ethers.ZeroHash), "BadInput"); // причина обязательна
    await escrow.connect(anna).rejectStage(1, 0, hash("швы кривые"));
    assert.equal((await escrow.getStage(1, 0))[1], BigInt(StageStatus.Disputed));
    await reverts(escrow.connect(anna).resolveDispute(1, 0, true), "Unauthorized");
    await escrow.connect(expert).resolveDispute(1, 0, false);
    assert.equal(await token.balanceOf(anna.address), 1_000_000n * R); // все вернулось заказчику
    assert.equal(await token.balanceOf(ivan.address), 0n);
    assert.equal((await escrow.getDeal(1))[1], BigInt(DealStatus.Cancelled));
    assert.equal(await token.balanceOf(escrowAddress), 0n);
  });

  it("исполнитель открывает спор сам, приемщик решает в его пользу", async () => {
    await createOwn();
    await escrow.connect(ivan).sign(1);
    await escrow.connect(anna).sign(1);
    await escrow.connect(anna).fund(1, 300_000n * R);
    await escrow.connect(ivan).submitStage(1, 0, hash("плитка"));
    await escrow.connect(ivan).openDispute(1, 0, hash("заказчик молчит"));
    await escrow.connect(expert).resolveDispute(1, 0, true);
    assert.equal(await token.balanceOf(ivan.address), 120_000n * R);
    assert.equal((await escrow.getStage(1, 1))[1], BigInt(StageStatus.Active)); // следующий этап начался
  });

  it("автоприемка срабатывает только после срока и доступна любому", async () => {
    await createOwn();
    await escrow.connect(ivan).sign(1);
    await escrow.connect(anna).sign(1);
    await escrow.connect(anna).fund(1, 300_000n * R);
    await escrow.connect(ivan).submitStage(1, 0, hash("плитка"));
    await reverts(escrow.connect(stranger).autoAccept(1, 0), "BadState");
    await increaseTime(3 * DAY + 5);
    await escrow.connect(stranger).autoAccept(1, 0);
    assert.equal(await token.balanceOf(ivan.address), 120_000n * R);
  });

  it("комиссия уходит получателю, исполнителю остается остаток", async () => {
    await createOwn([100_000n * R], 250); // 2,5 процента
    await escrow.connect(ivan).sign(1);
    await escrow.connect(anna).sign(1);
    await escrow.connect(anna).fund(1, 100_000n * R);
    await escrow.connect(ivan).submitStage(1, 0, hash("готово"));
    await escrow.connect(anna).approveStage(1, 0);
    assert.equal(await token.balanceOf(feeTo.address), 2_500n * R);
    assert.equal(await token.balanceOf(ivan.address), 97_500n * R);
  });

  it("отмена до начала и в процессе возвращает остаток", async () => {
    await createOwn();
    await escrow.connect(anna).fund(1, 300_000n * R);
    await reverts(escrow.connect(ivan).cancel(1), "Unauthorized"); // отменяет заказчик
    await escrow.connect(anna).cancel(1);
    assert.equal(await token.balanceOf(anna.address), 1_000_000n * R);

    await createOwn();
    await escrow.connect(ivan).sign(2);
    await escrow.connect(anna).sign(2);
    await escrow.connect(anna).fund(2, 300_000n * R);
    await escrow.connect(ivan).submitStage(2, 0, hash("плитка"));
    await escrow.connect(anna).approveStage(2, 0);
    await escrow.connect(anna).cancel(2);
    assert.equal(await token.balanceOf(ivan.address), 120_000n * R);
    assert.equal(await token.balanceOf(anna.address), 1_000_000n * R - 120_000n * R);
    assert.equal(await token.balanceOf(escrowAddress), 0n);
    await reverts(escrow.connect(anna).cancel(2), "BadState");
  });

  it("проверка входных данных при создании", async () => {
    await reverts(escrow.createDeal(Mode.Own, ZERO, anna.address, expert.address, [1n], DAY, 0, hash("x")), "BadInput");
    await reverts(escrow.createDeal(Mode.Own, ivan.address, ivan.address, expert.address, [1n], DAY, 0, hash("x")), "BadInput"); // заказчик и исполнитель различаются
    await reverts(escrow.createDeal(Mode.Own, ivan.address, anna.address, ZERO, [1n], DAY, 0, hash("x")), "BadInput"); // нужен приемщик
    await reverts(escrow.createDeal(Mode.Own, ivan.address, anna.address, expert.address, [], DAY, 0, hash("x")), "BadInput");
    await reverts(escrow.createDeal(Mode.Own, ivan.address, anna.address, expert.address, [0n], DAY, 0, hash("x")), "BadInput");
    await reverts(escrow.createDeal(Mode.Own, ivan.address, anna.address, expert.address, [1n], DAY, 1001, hash("x")), "BadInput");
    await reverts(escrow.createDeal(Mode.Crowdfunding, ivan.address, anna.address, ZERO, [1n], DAY, 0, hash("x")), "BadInput");
    await reverts(escrow.createDeal(Mode.Grant, ivan.address, anna.address, expert.address, [1n], 0, 0, hash("x")), "BadInput");
    await reverts(escrow.getDeal(99), "BadInput");
  });
});

describe("StepEscrow: грант", () => {
  it("грантодатель принимает этап, а отклоненный этап возвращает остаток", async () => {
    const { token, escrow, escrowAddress, signers } = await deploy();
    const [fond, studio] = signers;
    await giveTokens(token, escrowAddress, fond, 1_000_000n * R);
    await escrow.createDeal(Mode.Grant, studio.address, fond.address, ZERO, [50_000n * R, 50_000n * R], 0, 0, hash("грант"));
    await escrow.connect(fond).fund(1, 100_000n * R);
    await escrow.connect(studio).sign(1);
    await escrow.connect(fond).sign(1);
    await escrow.connect(studio).submitStage(1, 0, hash("отчет 1"));
    await escrow.connect(fond).approveStage(1, 0);
    await escrow.connect(studio).submitStage(1, 1, hash("отчет 2"));
    await increaseTime(30 * DAY);
    await reverts(escrow.autoAccept(1, 1), "BadState"); // у гранта автоприемки нет
    await escrow.connect(fond).rejectStage(1, 1, hash("не по смете"));
    assert.equal(await token.balanceOf(studio.address), 50_000n * R);
    assert.equal(await token.balanceOf(fond.address), 950_000n * R);
    assert.equal((await escrow.getDeal(1))[1], BigInt(DealStatus.Cancelled));
    assert.equal(await token.balanceOf(escrowAddress), 0n);
  });
});

describe("StepEscrow: краудфандинг", () => {
  let token, escrow, escrowAddress, author, olga, max, pasha, stranger;
  beforeEach(async () => {
    const d = await deploy();
    ({ token, escrow, escrowAddress } = d);
    [author, olga, max, pasha, stranger] = d.signers;
    for (const s of [olga, max, pasha]) await giveTokens(token, escrowAddress, s, 1_000_000n * R);
    await escrow.createDeal(Mode.Crowdfunding, author.address, ZERO, ZERO, [100_000n * R, 200_000n * R], DAY, 0, hash("сбор"));
  });

  it("сбор собирается взносами, работа начинается после подписи автора", async () => {
    await reverts(escrow.connect(author).fund(1, 1n), "Unauthorized"); // автор не спонсирует себя
    await escrow.connect(olga).fund(1, 150_000n * R);
    await reverts(escrow.connect(max).fund(1, 200_000n * R), "BadInput"); // больше недостающего
    await escrow.connect(max).fund(1, 150_000n * R);
    assert.equal((await escrow.getDeal(1))[1], BigInt(DealStatus.Funding)); // сбор собран, автор еще не подписал
    await reverts(escrow.connect(olga).sign(1), "Unauthorized"); // спонсоры соглашаются взносом
    await escrow.connect(author).sign(1);
    assert.equal((await escrow.getDeal(1))[1], BigInt(DealStatus.Active));
    await reverts(escrow.connect(pasha).fund(1, 1n), "BadState"); // сделка уже началась
  });

  async function started() {
    await escrow.connect(olga).fund(1, 150_000n * R);
    await escrow.connect(max).fund(1, 150_000n * R);
    await escrow.connect(author).sign(1);
  }

  it("этап принимает перевес голосов, автор получает деньги", async () => {
    await started();
    await escrow.connect(author).submitStage(1, 0, hash("макет"));
    await reverts(escrow.connect(stranger).vote(1, 0, true), "Unauthorized");
    await escrow.connect(olga).vote(1, 0, true);
    assert.equal(await token.balanceOf(author.address), 0n); // 50 процентов еще не перевес
    await escrow.connect(max).vote(1, 0, true);
    assert.equal(await token.balanceOf(author.address), 100_000n * R);
    // деньги за этап списаны с резервов поровну, остаток 200 000 в резерве
    assert.equal(await escrow.reserves(1, olga.address), 100_000n * R);
    assert.equal(await escrow.reserves(1, max.address), 100_000n * R);
  });

  it("голос можно изменить; половина голосов против проваливает этап и возвращает остаток", async () => {
    await started();
    await escrow.connect(author).submitStage(1, 0, hash("макет"));
    await escrow.connect(olga).vote(1, 0, true);
    await escrow.connect(olga).vote(1, 0, false); // передумала: голос «против» весит половину
    assert.equal((await escrow.getDeal(1))[1], BigInt(DealStatus.Cancelled));
    assert.equal(await token.balanceOf(olga.address), 1_000_000n * R);
    assert.equal(await token.balanceOf(max.address), 1_000_000n * R - 150_000n * R + 150_000n * R);
    assert.equal(await token.balanceOf(author.address), 0n);
    assert.equal(await token.balanceOf(escrowAddress), 0n);
  });

  it("повторный голос не удваивает вес", async () => {
    await started();
    await escrow.connect(author).submitStage(1, 0, hash("макет"));
    await escrow.connect(olga).vote(1, 0, true);
    await escrow.connect(olga).vote(1, 0, true);
    assert.equal((await escrow.getStage(1, 0))[1], BigInt(StageStatus.Submitted));
  });

  it("автоприемка через сутки без голосов", async () => {
    await started();
    await escrow.connect(author).submitStage(1, 0, hash("макет"));
    await reverts(escrow.autoAccept(1, 0), "BadState");
    await increaseTime(DAY + 1);
    await escrow.connect(stranger).autoAccept(1, 0);
    assert.equal(await token.balanceOf(author.address), 100_000n * R);
  });

  it("взносы неравные: выплата и возврат делятся пропорционально, копейки не теряются", async () => {
    // три спонсора вносят 100 001, 100 002 и 99 997 копеек: деление с остатками
    await escrow.createDeal(Mode.Crowdfunding, author.address, ZERO, ZERO, [100_000n, 100_000n, 100_000n], DAY, 0, hash("неровно"));
    const deposits = [[olga, 100_001n], [max, 100_002n], [pasha, 99_997n]];
    for (const [s, v] of deposits) await escrow.connect(s).fund(2, v);
    await escrow.connect(author).sign(2);
    const weights = deposits.map(([, v]) => v);
    const before = await Promise.all(deposits.map(([s]) => token.balanceOf(s.address)));
    await escrow.connect(author).submitStage(2, 0, hash("этап 1"));
    await escrow.connect(olga).vote(2, 0, true);
    await escrow.connect(max).vote(2, 0, true);
    // списано с резервов ровно по методу наибольших остатков
    const expected = splitProRata(100_000n, weights);
    for (let i = 0; i < 3; i++) assert.equal(await escrow.reserves(2, deposits[i][0].address), weights[i] - expected[i]);
    assert.equal(await escrow.reservedSum(2), 200_000n);
    // провал второго этапа: остаток возвращается пропорционально
    await escrow.connect(author).submitStage(2, 1, hash("этап 2"));
    await escrow.connect(olga).vote(2, 1, false);
    await escrow.connect(max).vote(2, 1, false);
    for (let i = 0; i < 3; i++) {
      const left = weights[i] - expected[i];
      assert.ok(left > 0n);
      assert.equal((await token.balanceOf(deposits[i][0].address)) - before[i], left); // вернулся весь остаток
    }
    assert.equal(await token.balanceOf(author.address), 100_000n); // автор получил только за принятый этап
    assert.equal(await escrow.totalLocked(), 0n);
    assert.equal(await token.balanceOf(escrowAddress), 0n);
  });
});

describe("StepEscrow: сроки и аварийный выход", () => {
  async function setup(deadlines) {
    const { token, escrow, signers, escrowAddress } = await deploy();
    const [, executor, owner, arbiter, stranger] = signers;
    await giveTokens(token, escrowAddress, owner, 1_000n * R);
    await escrow.createDealEx(Mode.Own, executor.address, owner.address, arbiter.address, [500n * R, 500n * R], 3 * DAY, 0, hash("t"), deadlines);
    await escrow.connect(owner).sign(1);
    await escrow.connect(executor).sign(1);
    return { token, escrow, executor, owner, arbiter, stranger };
  }

  it("срок этапа: возврат остатка после срока, любой может вызвать", async () => {
    const { token, escrow, executor, owner, stranger } = await setup([0, 10 * DAY, 0]);
    await escrow.connect(owner).fund(1, 1_000n * R);
    await reverts(escrow.connect(stranger).expireStage(1, 0), "BadState");
    await increaseTime(10 * DAY);
    await escrow.connect(stranger).expireStage(1, 0);
    assert.equal(await token.balanceOf(owner.address), 1_000n * R);
    assert.equal((await escrow.getDeal(1)).status, BigInt(DealStatus.Cancelled));
    await reverts(escrow.connect(executor).submitStage(1, 0, hash("e")), "BadState");
  });

  it("без сроков выход невозможен, как бы долго ни ждали", async () => {
    const { escrow, owner, stranger } = await setup([0, 0, 0]);
    await escrow.connect(owner).fund(1, 1_000n * R);
    await increaseTime(400 * DAY);
    await reverts(escrow.connect(stranger).expireStage(1, 0), "BadState");
    await reverts(escrow.connect(stranger).expireFunding(1), "BadState");
  });

  it("срок сбора и срок спора считаются от своих моментов", async () => {
    const { token, escrow, executor, owner, arbiter, stranger } = await setup([5 * DAY, 0, 14 * DAY]);
    await increaseTime(4 * DAY);
    await escrow.connect(owner).fund(1, 1_000n * R);
    await increaseTime(2 * DAY); // сбор завершен, выйти по сроку сбора нельзя
    await reverts(escrow.connect(stranger).expireFunding(1), "BadState");
    await escrow.connect(executor).submitStage(1, 0, hash("e"));
    await escrow.connect(executor).openDispute(1, 0, hash("r"));
    await increaseTime(13 * DAY);
    await reverts(escrow.connect(stranger).expireDispute(1, 0), "BadState");
    await increaseTime(2 * DAY);
    await escrow.connect(stranger).expireDispute(1, 0);
    assert.equal(await token.balanceOf(owner.address), 1_000n * R);
    await reverts(escrow.connect(arbiter).resolveDispute(1, 0, true), "BadState");
  });

  it("срок спора задается только в своей сделке", async () => {
    const { escrow, signers } = await deploy();
    const [, executor, owner] = signers;
    await reverts(escrow.createDealEx(Mode.Grant, executor.address, owner.address, ZERO, [100n * R], 0, 0, hash("t"), [0, 0, DAY]), "BadInput");
  });
});
