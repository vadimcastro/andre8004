import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DB_FILE = process.env.DATABASE_FILE || join(import.meta.dir, "andre8004_cache.db");
const LOG_PATH = join(import.meta.dir, "deployment_log.json");
const ARTIFACT_PATH = join(import.meta.dir, "out", "andre8004.sol", "andre8004.json");

const arcTestnet = {
  id: 5042002,
  name: "Circle Arc Testnet",
  network: "arc-testnet",
  nativeCurrency: { name: "Arc Token", symbol: "ARC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    public: { http: ["https://rpc.testnet.arc.network"] }
  }
};

async function main() {
  console.log("=== Starting On-Chain Merkle Root Committer ===");

  // 1. Check if contract deployment log exists
  if (!existsSync(LOG_PATH)) {
    console.error(`Error: Deployment log not found at ${LOG_PATH}. Run 'bun deploy.ts' first.`);
    process.exit(1);
  }

  const logData = JSON.parse(readFileSync(LOG_PATH, "utf-8"));
  const contractAddress = logData.deployed_address as `0x${string}`;
  console.log(`Deployed Contract Target: ${contractAddress}`);

  // 2. Query active Merkle Root and Epoch from local SQLite
  const db = new Database(DB_FILE);
  const rootRow = db.query("SELECT value FROM sync_state WHERE key = 'current_merkle_root';").get() as { value: string } | null;
  const epochRow = db.query("SELECT value FROM sync_state WHERE key = 'current_epoch_id';").get() as { value: string } | null;
  db.close();

  if (!rootRow || !epochRow) {
    console.error("Error: Local database is missing current root. Run 'bun merkle.ts' first.");
    process.exit(1);
  }

  const currentRoot = rootRow.value as `0x${string}`;
  const currentEpoch = BigInt(epochRow.value);

  console.log(`Active Merkle Root:     ${currentRoot}`);
  console.log(`Active Epoch ID:       ${currentEpoch.toString()}`);

  // 3. Connect to network
  const rpcUrl = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
  const rawKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!rawKey || !rawKey.startsWith("0x")) {
    console.error("Error: DEPLOYER_PRIVATE_KEY is missing or invalid in .env.");
    process.exit(1);
  }

  const account = privateKeyToAccount(rawKey as `0x${string}`);
  console.log(`Signer address:         ${account.address}`);

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl)
  });

  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(rpcUrl)
  });

  // 4. Load ABI from artifact
  let abi: any;
  try {
    const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf-8"));
    abi = artifact.abi;
  } catch (e) {
    console.error(`Error: Could not read contract ABI at ${ARTIFACT_PATH}`);
    process.exit(1);
  }

  // 5. Submit update transaction
  console.log("\nSubmitting manualUpdateRoot transaction on-chain...");
  try {
    const hash = await walletClient.writeContract({
      address: contractAddress,
      abi,
      functionName: "manualUpdateRoot",
      args: [currentEpoch, currentRoot]
    });

    console.log(`Transaction submitted. Hash: ${hash}`);
    console.log("Waiting for confirmation...");

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("\n✅ On-Chain State Root Updated Successfully!");
    console.log(`  - Block Number: ${receipt.blockNumber.toString()}`);
    console.log(`  - Gas Used:     ${receipt.gasUsed.toString()}`);
  } catch (error) {
    console.error("❌ On-chain root commit transaction failed:", error);
  }
}

main().catch(console.error);
