import { createPublicClient, createWalletClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ARTIFACT_PATH = join(import.meta.dir, "out", "andre8004.sol", "andre8004.json");
const LOG_PATH = join(import.meta.dir, "deployment_log.json");

// Define basic custom chain for Arc Testnet if needed (or default to fallback)
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
  console.log("=== Starting Smart Contract Deployment ===");

  // 1. Read environment variables
  const rpcUrl = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
  const rawKey = process.env.DEPLOYER_PRIVATE_KEY;
  
  if (!rawKey || !rawKey.startsWith("0x")) {
    console.error("Error: DEPLOYER_PRIVATE_KEY is not defined or is invalid in .env file.");
    process.exit(1);
  }

  const account = privateKeyToAccount(rawKey as `0x${string}`);
  console.log(`Deployer address: ${account.address}`);

  // Configurable Chainlink parameters (Base Sepolia defaults)
  const routerAddress = getAddress(process.env.FUNCTIONS_ROUTER || "0xCaaE779e0Ce4544ecB63ba0F1530E30489956b62");
  
  // DON ID for Base Sepolia (fun-base-sepolia-1) encoded in bytes32
  const donId = (process.env.FUNCTIONS_DON_ID || "0x66756e2d626173652d7365706f6c69612d310000000000000000000000000000") as `0x${string}`;

  console.log(`Configured Parameters:`);
  console.log(`  - RPC Endpoint:   ${rpcUrl}`);
  console.log(`  - Router Address: ${routerAddress}`);
  console.log(`  - DON ID (Hex):   ${donId}`);

  // 2. Load compiled artifacts
  let abi: any;
  let bytecode: `0x${string}`;

  try {
    const artifactStr = readFileSync(ARTIFACT_PATH, "utf-8");
    const artifact = JSON.parse(artifactStr);
    abi = artifact.abi;
    bytecode = artifact.bytecode.object;
    if (!bytecode.startsWith("0x")) {
      bytecode = `0x${bytecode}`;
    }
  } catch (e) {
    console.error(`Error: Could not read compiled contract artifact at ${ARTIFACT_PATH}. Run 'forge build' first.`);
    process.exit(1);
  }

  // 3. Initialize Viem clients
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl)
  });

  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(rpcUrl)
  });

  // 4. Deploy Contract
  console.log("\nSending deployment transaction...");
  try {
    const hash = await walletClient.deployContract({
      abi,
      bytecode,
      args: [routerAddress, donId]
    });
    
    console.log(`Deployment transaction submitted. Transaction Hash: ${hash}`);
    console.log("Waiting for block confirmation...");

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const contractAddress = receipt.contractAddress;

    console.log("\n✅ Contract Deployed Successfully!");
    console.log(`  - Contract Address: ${contractAddress}`);
    console.log(`  - Block Number:     ${receipt.blockNumber}`);
    console.log(`  - Gas Used:         ${receipt.gasUsed.toString()}`);

    // Save logs to deployment_log.json
    const deploymentLog = {
      contract_name: "andre8004",
      deployed_address: contractAddress,
      transaction_hash: hash,
      block_number: receipt.blockNumber.toString(),
      gas_used: receipt.gasUsed.toString(),
      timestamp: new Date().toISOString(),
      network_rpc: rpcUrl,
      router_address: routerAddress,
      don_id: donId
    };

    writeFileSync(LOG_PATH, JSON.stringify(deploymentLog, null, 2), "utf-8");
    console.log(`Saved deployment log to ${LOG_PATH}`);

  } catch (error) {
    console.error("❌ Deployment transaction failed:", error);
  }
}

main().catch(console.error);
