// Pre-flight check. Runs offline vs. the RPC only: resolves the deployer
// address + balance without sending any transactions, so the operator can
// confirm the key is wired correctly before touching mainnet gas.
//
// The private key itself is NEVER printed (and the zero-address sentinel
// short-circuits so an empty env doesn't masquerade as a real signer).

const hre = require("hardhat");

function fmtBnb(wei) {
  const s = wei.toString().padStart(19, "0");
  const int = s.slice(0, s.length - 18) || "0";
  const frac = s.slice(s.length - 18, s.length - 12);
  return `${int}.${frac}`;
}

async function main() {
  const net = hre.network.name;
  const provider = hre.ethers.provider;
  const chainId = Number((await provider.getNetwork()).chainId);
  const [deployer] = await hre.ethers.getSigners();

  // Empty / invalid key resolves to the 0xAA…AA sentinel used by the
  // hardhat.config normalizer. Treat that as "no key set".
  const ZERO_ADDR = "0x" + "0".repeat(40);
  const addr = deployer?.address || ZERO_ADDR;
  const hasRealKey = addr !== ZERO_ADDR && addr !== "0x" + "00".repeat(20);

  console.log("=== preflight ===");
  console.log("network :", net, `(chain id ${chainId})`);
  console.log("deployer:", hasRealKey ? addr : "(none — key missing or invalid)");

  if (!hasRealKey) {
    console.error(
      "FAIL: MEMEDNA_DEPLOYER_PRIVATE_KEY is empty or not a valid 32-byte hex string."
    );
    process.exitCode = 1;
    return;
  }

  const balance = await provider.getBalance(addr);
  const gasPrice = await provider.getFeeData();

  console.log("balance :", fmtBnb(balance), "BNB");
  console.log(
    "gasPrice:",
    (Number(gasPrice.gasPrice || 0n) / 1e9).toFixed(3),
    "gwei"
  );

  const minOk = 2_000_000_000_000_000n; // 0.002 BNB
  if (balance < minOk) {
    console.warn(
      `WARN: balance < 0.002 BNB. Mainnet deploy typically costs\n` +
        `      ~0.003 BNB. Top up before running deploy:mainnet.`
    );
  } else {
    console.log("OK: balance looks sufficient for a first deploy.");
  }
}

main().catch((err) => {
  const msg = String(err && err.message ? err.message : err).replace(
    /0x[0-9a-fA-F]{64}/g,
    "0x<redacted-32-bytes>"
  );
  console.error("preflight error:", msg);
  process.exitCode = 1;
});
