import { createPublicClient, createWalletClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const LOG_PATH = join(import.meta.dir, "deployment_log.json");
const ARTIFACT_PATH = join(import.meta.dir, "out", "andre8004.sol", "andre8004.json");
const SOURCE_PATH = join(import.meta.dir, "functions-source.js");

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
  console.log("=== Triggering Chainlink Functions Root Update ===");

  // 1. Load deployed contract address
  if (!existsSync(LOG_PATH)) {
    console.error(`Error: Deployment log not found at ${LOG_PATH}. Deploy your contract first.`);
    process.exit(1);
  }

  const logData = JSON.parse(readFileSync(LOG_PATH, "utf-8"));
  const contractAddress = getAddress(logData.deployed_address);
  console.log(`Target Contract Address: ${contractAddress}`);

  // 2. Load Chainlink source javascript block
  if (!existsSync(SOURCE_PATH)) {
    console.error(`Error: Chainlink JS source file not found at ${SOURCE_PATH}`);
    process.exit(1);
  }

  const sourceCode = readFileSync(SOURCE_PATH, "utf-8");
  console.log("Loaded Chainlink Functions source script.");

  // 3. Connect to target RPC and signer wallet
  const rpcUrl = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
  const rawKey = process.env.DEPLOYER_PRIVATE_KEY;

  if (!rawKey || !rawKey.startsWith("0x")) {
    console.error("Error: DEPLOYER_PRIVATE_KEY is missing or invalid in .env.");
    process.exit(1);
  }

  const account = privateKeyToAccount(rawKey as `0x${string}`);
  console.log(`Signer account:          ${account.address}`);

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl)
  });

  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(rpcUrl)
  });

  // 4. Load ABI
  let abi: any;
  try {
    const artifact = JSON.parse(readFileSync(ARTIFACT_PATH, "utf-8"));
    abi = artifact.abi;
  } catch (e) {
    console.error(`Error: Could not read contract ABI at ${ARTIFACT_PATH}`);
    process.exit(1);
  }

  // 5. Config API endpoint argument
  // NOTE: For live Chainlink nodes to fetch this, the URL must be a public endpoint (not localhost).
  // If you deploy your Bun API server to a public host, specify that URL here.
  const apiEndpointUrl = process.argv[2] || process.env.PUBLIC_API_URL || "http://localhost:3000/epoch-root";
  console.log(`Consensus Update API Target: ${apiEndpointUrl}`);

  if (apiEndpointUrl.includes("localhost")) {
    console.log("⚠️ WARNING: Localhost URL detected. Chainlink DON nodes cannot query local URLs.");
    console.log("For testnet updates, tunnel your server using Ngrok (e.g. 'ngrok http 3000') or deploy the server to a public host.");
  }

  // 6. Submit request transaction
  console.log("\nSubmitting requestEpochRootUpdate transaction on-chain...");
  try {
    // Constructor parameter signature:
    // requestEpochRootUpdate(string source, bytes secrets, string[] args)
    const hash = await walletClient.writeContract({
      address: contractAddress,
      abi,
      functionName: "requestEpochRootUpdate",
      args: [sourceCode, "0x", [apiEndpointUrl]]
    });

    console.log(`Transaction submitted. Hash: ${hash}`);
    console.log("Waiting for block confirmation...");

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log("\n✅ Chainlink Functions Request Triggered Successfully!");
    console.log(`  - Block Number:     ${receipt.blockNumber.toString()}`);
    console.log(`  - Gas Used:         ${receipt.gasUsed.toString()}`);
    console.log("\nNote: The Chainlink DON will now fetch the root, run consensus, and update the contract root asynchronously.");
  } catch (error) {
    console.error("❌ Chainlink Functions request transaction failed:", error);
  }
}

main().catch(console.error);
