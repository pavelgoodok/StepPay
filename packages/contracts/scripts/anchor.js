// Публикация и сверка якорей истории StepPay в сети.
//   ANCHOR_API=https://api.example.com npx hardhat run scripts/anchor.js --network sepolia
// Если задан ANCHOR_CONTRACT, используется он, иначе разворачивается новый StepAnchor (адрес выводится).
// Приватный ключ только из окружения (DEPLOYER_PRIVATE_KEY), в репозитории и логах его нет.
const hre = require("hardhat");
const { publishAnchors, checkAnchors } = require("../rails/anchor-chain");

async function main() {
  const api = process.env.ANCHOR_API;
  if (!api) throw new Error("Задайте ANCHOR_API: адрес API платформы");
  const { anchors } = await (await fetch(api.replace(/\/$/, "") + "/anchors")).json();
  const [signer] = await hre.ethers.getSigners();
  const factory = await hre.ethers.getContractFactory("StepAnchor", signer);
  const contract = process.env.ANCHOR_CONTRACT
    ? factory.attach(process.env.ANCHOR_CONTRACT)
    : await (await factory.deploy(signer.address)).waitForDeployment();
  console.log("Контракт якорей:", await contract.getAddress());
  const problems = await checkAnchors(contract, anchors);
  if (problems.length) {
    console.error("РАСХОЖДЕНИЕ с сетью:\n- " + problems.join("\n- "));
    process.exitCode = 1;
    return;
  }
  const done = await publishAnchors(contract, anchors);
  console.log(done.length ? `Записано якорей: ${done.join(", ")}` : "Новых якорей нет");
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
