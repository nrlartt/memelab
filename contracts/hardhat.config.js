require("@nomicfoundation/hardhat-toolbox");
// Read the project-root .env first (shared with the Python backend), then
// fall back to a contracts-local .env. Never log secret values.
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
require("dotenv").config({ path: require("path").resolve(__dirname, "./.env") });

function normalizePk(raw) {
  if (!raw) return "0x" + "0".repeat(64);
  let k = raw.trim();
  if (k.startsWith("0x") || k.startsWith("0X")) k = k.slice(2);
  // Hardhat rejects keys that aren't exactly 32 bytes of hex.
  if (!/^[0-9a-fA-F]{64}$/.test(k)) return "0x" + "0".repeat(64);
  return "0x" + k;
}

const PRIVATE_KEY = normalizePk(process.env.MEMEDNA_DEPLOYER_PRIVATE_KEY);

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./src",
    artifacts: "./artifacts",
    cache: "./cache",
  },
  networks: {
    bsc: {
      url: process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org",
      chainId: 56,
      accounts: [PRIVATE_KEY],
    },
    bsctestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    apiKey: process.env.BSCSCAN_API_KEY || "",
  },
  sourcify: {
    enabled: false,
  },
};
