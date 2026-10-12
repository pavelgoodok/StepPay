/**
 * Прогоняет сделку на контракте StepEscrow в выбранной сети и пишет отчет с хешами транзакций.
 *
 *   локально:        npx hardhat run scripts/testnet-deal.js
 *   публичная сеть:  SEPOLIA_RPC_URL=... DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/testnet-deal.js --network sepolia
 *
 * В публичной сети нужен кошелек с тестовым эфиром (его дает кран сети): оттуда оплачивается газ.
 * Участники сделки (заказчик, исполнитель, приемщик) создаются на лету и получают немного эфира на газ.
 * Токен tRUB тестовый, стоимости не имеет, это замена цифрового рубля.
 */
require("tsx/cjs");
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { ethers } = hre;
const { createState, createDeal, contractHash, contractTerms } = require("@steppay/engine");

const R = 100n;
const KNOWN = {
  11155111: { name: "Sepolia", explorer: "https://sepolia.etherscan.io" },
  84532: { name: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
  31337: { name: "Hardhat (локальная сеть)", explorer: undefined },
};

async function main() {
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const info = KNOWN[chainId] ?? { name: hre.network.name, explorer: undefined };
  const explorer = process.env.EXPLORER_URL ?? info.explorer;
  const local = hre.network.name === "hardhat";

  const signers = await ethers.getSigners();
  if (signers.length === 0) throw new Error("Не задан DEPLOYER_PRIVATE_KEY: нужен кошелек с тестовым эфиром для газа");
  const deployer = signers[0];
  let customer, executor, arbiter;
  if (local) {
    [, customer, executor, arbiter] = signers;
  } else {
    [customer, executor, arbiter] = [0, 1, 2].map(() => ethers.Wallet.createRandom().connect(ethers.provider));
    const gas = ethers.parseEther(process.env.FUND_ETH ?? "0.003");
    for (const w of [customer, executor, arbiter]) await (await deployer.sendTransaction({ to: w.address, value: gas })).wait();
  }

  const txs = [];
  const step = async (label, promise) => {
    const tx = await promise;
    const receipt = await tx.wait();
    txs.push({ label, hash: receipt.hash, at: Math.floor(Date.now() / 1000) });
    console.log(`  ${label}: ${receipt.hash}`);
    return receipt;
  };

  console.log(`Сеть: ${info.name} (chainId ${chainId})`);
  const token = process.env.TOKEN_ADDRESS
    ? await ethers.getContractAt("TestRub", process.env.TOKEN_ADDRESS, deployer)
    : await (await ethers.getContractFactory("TestRub", deployer)).deploy();
  await token.waitForDeployment();
  const escrow = process.env.ESCROW_ADDRESS
    ? await ethers.getContractAt("StepEscrow", process.env.ESCROW_ADDRESS, deployer)
    : await (await ethers.getContractFactory("StepEscrow", deployer)).deploy(await token.getAddress(), deployer.address);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log(`Контракт StepEscrow: ${escrowAddress}\nТокен tRUB: ${await token.getAddress()}`);

  // хеш условий считает ядро сделок (шаг 1): тот же хеш лежит в контракте
  const stages = [120_000n * R, 80_000n * R];
  const dealKey = `chain-${Date.now()}`;
  const terms = createDeal(createState(), {
    id: dealKey, mode: "own", title: "Ремонт ванной", executorId: "executor", ownerId: "customer", arbiterId: "arbiter",
    signed: true, stages: stages.map((a, i) => ({ id: `s${i + 1}`, title: `Этап ${i + 1}`, amount: Number(a) })), at: 0,
  }).deals[dealKey];
  const hash = `0x${contractHash(contractTerms(terms))}`;

  const total = stages.reduce((a, b) => a + b, 0n);
  await step("Выдача тестовых токенов заказчику", token.mint(customer.address, total));
  await step("Разрешение контракту списать токены", token.connect(customer).approve(escrowAddress, total));
  await step("Создание сделки", escrow.connect(deployer).createDeal(0, executor.address, customer.address, arbiter.address, stages, 3 * 86_400, 0, hash));
  const dealId = Number((await escrow.dealCount()));
  await step("Подпись исполнителя", escrow.connect(executor).sign(dealId));
  await step("Подпись заказчика", escrow.connect(customer).sign(dealId));
  await step("Резерв денег заказчиком", escrow.connect(customer).fund(dealId, total));
  await step("Сдача первого этапа", escrow.connect(executor).submitStage(dealId, 0, ethers.id("этап 1")));
  await step("Приемка первого этапа, выплата исполнителю", escrow.connect(customer).approveStage(dealId, 0));
  await step("Сдача второго этапа", escrow.connect(executor).submitStage(dealId, 1, ethers.id("этап 2")));
  await step("Приемка второго этапа, сделка завершена", escrow.connect(customer).approveStage(dealId, 1));

  const paid = await token.balanceOf(executor.address);
  const status = Number((await escrow.getDeal(dealId))[1]);
  const left = await token.balanceOf(escrowAddress);
  if (paid !== total || status !== 2 || left !== 0n) throw new Error(`Результат не сошелся: выплачено ${paid}, статус ${status}, в контракте ${left}`);
  console.log(`Готово: исполнитель получил ${paid / R} tRUB, контракт пуст, сделка завершена.`);

  const report = {
    network: info.name,
    chainId,
    contract: escrowAddress,
    dealId,
    ...(explorer ? { explorer } : {}),
    txs,
    // служебные поля, в сделку платформы не передаются
    token: await token.getAddress(),
    contractHash: hash,
    actors: { customer: customer.address, executor: executor.address, arbiter: arbiter.address },
  };
  const file = path.join(__dirname, "..", "reports", `${hre.network.name}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`Отчет: ${file}`);
  if (explorer) console.log(`Контракт: ${explorer}/address/${escrowAddress}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
