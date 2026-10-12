// Компилятор берется из npm-пакета solc (solcjs): так сборка работает без скачивания бинарников с binaries.soliditylang.org.
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
require("@nomicfoundation/hardhat-ethers");

const SOLC = "0.8.28";

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion !== SOLC) return runSuper();
  const compilerPath = require.resolve("solc/soljson.js");
  const { version } = require("solc/package.json");
  return { compilerPath, isSolcJs: true, version: SOLC, longVersion: `${version}+commit.7893614a` };
});

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: { version: SOLC, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" } },
  paths: { sources: "contracts", tests: "test", cache: "cache", artifacts: "artifacts" },
  networks: { hardhat: { allowUnlimitedContractSize: false } },
  mocha: { timeout: 120000 },
};
