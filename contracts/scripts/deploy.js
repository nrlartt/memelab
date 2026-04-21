// Deploys MemeDNARegistry to BSC (mainnet or testnet, depending on `--network`).
//
// Safety invariants:
//   1. Never log the private key or the raw env value.
//   2. Abort early if we detect a wrong chain id (prevents typos like
//      `--network hardhat` from silently "deploying" to a local network).
//   3. Print the deployer address + balance *before* sending any tx so the
//      operator has one last chance to Ctrl+C.
//   4. After deploy, print the exact `.env` line to paste back, and a BscScan
//      link for verification.

const hre = require("hardhat");

function fmtBnb(wei) {
  // 6-decimal human formatting without pulling in any extra deps.
  const s = wei.toString().padStart(19, "0");
  const int = s.slice(0, s.length - 18) || "0";
  const frac = s.slice(s.length - 18, s.length - 12);
  return `${int}.${frac}`;
}

async function main() {
  const net = hre.network.name;
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);

  // Sanity: we only want to deploy to BSC mainnet (56) or testnet (97).
  const expected = { bsc: 56, bsctestnet: 97 };
  if (expected[net] && expected[net] !== chainId) {
    throw new Error(
      `network ${net} mapped to chain id ${chainId}, expected ${expected[net]}`
    );
  }
  if (!expected[net]) {
    throw new Error(
      `Refusing to deploy on network "${net}". Use --network bsc or --network bsctestnet.`
    );
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer || !deployer.address) {
    throw new Error(
      "No deployer signer. Is MEMEDNA_DEPLOYER_PRIVATE_KEY set in .env?"
    );
  }

  const balance = await hre.ethers.provider.getBalance(deployer.address);

  console.log("=== MemeDNARegistry deploy ===");
  console.log("network   :", net, `(chain id ${chainId})`);
  console.log("deployer  :", deployer.address);
  console.log("balance   :", fmtBnb(balance), "BNB");

  // Hardhat's default chain-id-97 testnet gas is ~0.001 BNB; mainnet is
  // ~0.003–0.006 BNB. Warn early so we don't send a hopeless tx.
  if (balance === 0n || balance < 2_000_000_000_000_000n /* 0.002 BNB */) {
    console.warn(
      "WARN: balance looks low (< 0.002 BNB). If deploy reverts with\n" +
        "      'insufficient funds', top up the deployer address first."
    );
  }

  console.log("compiling + deploying (this can take 30–60s)…");

  const Factory = await hre.ethers.getContractFactory("MemeDNARegistry");
  const registry = await Factory.deploy();

  const deployTx = registry.deploymentTransaction();
  if (deployTx) {
    console.log("tx hash   :", deployTx.hash);
  }

  await registry.waitForDeployment();
  const address = await registry.getAddress();

  const explorer =
    chainId === 56
      ? `https://bscscan.com/address/${address}`
      : `https://testnet.bscscan.com/address/${address}`;

  console.log("");
  console.log("✅  MemeDNARegistry deployed");
  console.log("address   :", address);
  console.log("explorer  :", explorer);
  console.log("");
  console.log("Paste this into your .env (replacing the existing line):");
  console.log("");
  console.log(`  MEMEDNA_REGISTRY_ADDRESS=${address}`);
  console.log("");
  console.log("Then restart the backend so the on-chain anchor activates.");
}

main().catch((err) => {
  // Redact anything that *looks* like a 0x-prefixed 64-hex blob just in case
  // hardhat ever surfaces the private key in an error. This is paranoia: we
  // never pass PK to anything that would re-emit it, but belt + suspenders.
  const msg = String(err && err.message ? err.message : err);
  const redacted = msg.replace(/0x[0-9a-fA-F]{64}/g, "0x<redacted-32-bytes>");
  console.error("deploy failed:", redacted);
  process.exitCode = 1;
});
