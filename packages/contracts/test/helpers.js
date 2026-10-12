const hre = require("hardhat");
const { ethers } = hre;

const Mode = { Own: 0, Crowdfunding: 1, Grant: 2 };
const DealStatus = { Funding: 0, Active: 1, Completed: 2, Cancelled: 3 };
const StageStatus = { Pending: 0, Active: 1, Submitted: 2, Accepted: 3, Disputed: 4, Failed: 5 };
const R = 100n; // рубль в копейках
const DAY = 86400;
const ZERO = ethers.ZeroAddress;
const hash = (s) => ethers.id(s);

async function deploy(feeRecipientIndex = 9) {
  const signers = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("TestRub")).deploy();
  const escrow = await (await ethers.getContractFactory("StepEscrow")).deploy(await token.getAddress(), signers[feeRecipientIndex].address);
  return { token, escrow, signers, escrowAddress: await escrow.getAddress() };
}

async function giveTokens(token, escrowAddress, who, amount) {
  await token.mint(who.address, amount);
  await token.connect(who).approve(escrowAddress, ethers.MaxUint256);
}

/** Ожидает откат с названием ошибки контракта. */
async function reverts(promise, name) {
  try {
    await promise;
  } catch (e) {
    const text = `${e.shortMessage ?? ""} ${e.message ?? ""}`;
    if (name && !text.includes(name)) throw new Error(`ожидался откат ${name}, получено: ${text.slice(0, 200)}`);
    return;
  }
  throw new Error(`ожидался откат${name ? " " + name : ""}, но вызов прошел`);
}

async function increaseTime(seconds) {
  await hre.network.provider.send("evm_increaseTime", [seconds]);
  await hre.network.provider.send("evm_mine");
}

/** Эталонное деление методом наибольших остатков, как splitProRata в ядре сделок. */
function splitProRata(amount, weights) {
  const entries = weights.map((w, i) => ({ i, w })).filter((e) => e.w > 0n);
  const total = entries.reduce((a, e) => a + e.w, 0n);
  const parts = entries.map((e) => ({ i: e.i, base: (amount * e.w) / total, rem: (amount * e.w) % total }));
  let left = amount - parts.reduce((a, p) => a + p.base, 0n);
  [...parts].sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1)).forEach((p) => {
    if (left > 0n) {
      p.base += 1n;
      left -= 1n;
    }
  });
  const out = weights.map(() => 0n);
  for (const p of parts) out[p.i] = p.base;
  return out;
}

module.exports = { hre, ethers, Mode, DealStatus, StageStatus, R, DAY, ZERO, hash, deploy, giveTokens, reverts, increaseTime, splitProRata };
