/**
 * Выпускает тестовый токен tRUB и контракт StepEscrow в выбранной сети и печатает переменные для Railway.
 *
 *   SEPOLIA_RPC_URL=... DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy.js --network sepolia
 *
 * Адрес с ключом DEPLOYER_PRIVATE_KEY становится получателем комиссии и платит газ за всех участников. Нужен тестовый эфир:
 * на каждого участника уходит около 0.003 ETH, на 10 участников хватит 0.1 ETH.
 */
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { ethers } = hre;

const KNOWN = { 11155111: "Sepolia", 84532: "Base Sepolia", 31337: "Hardhat (локальная сеть)" };

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("Не задан DEPLOYER_PRIVATE_KEY");
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Сеть: ${KNOWN[chainId] ?? hre.network.name} (${chainId})`);
  console.log(`Счет: ${deployer.address}, баланс ${ethers.formatEther(balance)} ETH`);
  if (balance < ethers.parseEther("0.02") && hre.network.name !== "hardhat") throw new Error("На счете меньше 0.02 ETH: пополните его из крана тестовой сети");

  const token = await (await ethers.getContractFactory("TestRub")).deploy();
  await token.waitForDeployment();
  const escrow = await (await ethers.getContractFactory("StepEscrow")).deploy(await token.getAddress(), deployer.address);
  await escrow.waitForDeployment();
  const out = { network: KNOWN[chainId] ?? hre.network.name, chainId, token: await token.getAddress(), escrow: await escrow.getAddress(), deployer: deployer.address, at: new Date().toISOString() };

  fs.mkdirSync(path.join(__dirname, "../reports"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, `../reports/deployment-${chainId}.json`), JSON.stringify(out, null, 2));
  const explorer = chainId === 11155111 ? "https://sepolia.etherscan.io" : chainId === 84532 ? "https://sepolia.basescan.org" : undefined;
  console.log("\nПеременные для Railway (сервис API):");
  console.log(`CHAIN_ID=${chainId}`);
  console.log(`CHAIN_ESCROW=${out.escrow}`);
  console.log(`CHAIN_TOKEN=${out.token}`);
  console.log("CHAIN_RPC_URL=<адрес узла из Alchemy или Infura>");
  console.log("CHAIN_DEPLOYER_KEY=<тот же приватный ключ, держите в секрете>");
  if (explorer) console.log(`CHAIN_EXPLORER=${explorer}\nСмотреть: ${explorer}/address/${out.escrow}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
