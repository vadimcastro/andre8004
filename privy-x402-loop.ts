import { Database } from "bun:sqlite";
import { keccak256, encodePacked, verifyTypedData } from "viem";
import { join } from "path";
import { PrivyClient } from "./privy-mock";

const DB_FILE = process.env.DATABASE_FILE || join(import.meta.dir, "andre8004_cache.db");

// Reconstruct verification matching test-oracle.ts / andre8004.sol logic
function verifyProof(proof: string[], root: string, leaf: string): boolean {
  let computedHash = leaf;

  for (const element of proof) {
    const computedBuf = Buffer.from(computedHash.slice(2), "hex");
    const elementBuf = Buffer.from(element.slice(2), "hex");

    if (computedBuf.compare(elementBuf) <= 0) {
      computedHash = keccak256(
        encodePacked(["bytes32", "bytes32"], [computedHash as `0x${string}`, element as `0x${string}`])
      );
    } else {
      computedHash = keccak256(
        encodePacked(["bytes32", "bytes32"], [element as `0x${string}`, computedHash as `0x${string}`])
      );
    }
  }

  return computedHash === root;
}

async function runExecutionLoop() {
  console.log("=== Starting Privy & ERC-3009 x402 Execution Loop ===");

  const appId = process.env.PRIVY_APP_ID || "mock-app-id";
  const appSecret = process.env.PRIVY_APP_SECRET || "mock-app-secret";

  console.log(`Initializing Privy client (App ID: ${appId})...`);
  const privy = new PrivyClient(appId, appSecret);

  // 1. Provision / Retrieve Agent's Privy Server Wallet
  const clientWallet = await privy.walletApi.ethereum.create();
  console.log(`\n[Step 1] Server-controlled embedded wallet active:`);
  console.log(`  - Privy Wallet ID: ${clientWallet.id}`);
  console.log(`  - Wallet Address:  ${clientWallet.address}`);

  // 2. Load target agent from database cache (ensure it has a valid proof)
  const db = new Database(DB_FILE);
  const targetAgent = db.query(`
    SELECT ca.*, mp.wallet_address as mp_wallet, mp.proof, mp.leaf 
    FROM cached_agents ca
    JOIN merkle_proofs mp ON ca.agent_guid = mp.agent_guid
    WHERE ca.x402_capable = 1 AND ca.reputation_score > 80.0
    LIMIT 1;
  `).get() as {
    agent_guid: string;
    chain_id: number;
    registry_address: string;
    token_id: string;
    wallet_address: string;
    reputation_score: number;
    proof: string;
    leaf: string;
  } | null;

  if (!targetAgent) {
    console.error("Error: Could not find any active, highly-rated x402 capable agents in database.");
    db.close();
    return;
  }

  const rootRow = db.query("SELECT value FROM sync_state WHERE key = 'current_merkle_root';").get() as { value: string } | null;
  const epochRow = db.query("SELECT value FROM sync_state WHERE key = 'current_epoch_id';").get() as { value: string } | null;

  if (!rootRow || !epochRow) {
    console.error("Error: Merkle root not initialized in database.");
    db.close();
    return;
  }

  const root = rootRow.value;
  const epochId = BigInt(epochRow.value);
  const proof = JSON.parse(targetAgent.proof) as string[];
  const leaf = targetAgent.leaf;

  console.log(`\n[Step 2] Found Target AI Agent in local routing directory:`);
  console.log(`  - GUID:             ${targetAgent.agent_guid}`);
  console.log(`  - Wallet Address:   ${targetAgent.wallet_address}`);
  console.log(`  - Reputation Score: ${targetAgent.reputation_score.toFixed(2)}`);

  // 3. Oracle Verification Check
  console.log(`\n[Step 3] Querying on-chain oracle verification (verifyAgent simulation)...`);
  const isVerified = verifyProof(proof, root, leaf);
  
  if (!isVerified) {
    console.error("❌ Oracle verification FAILED. Target agent's credentials do not match active Merkle root. Aborting routing!");
    db.close();
    return;
  }
  console.log("  - Status: ✅ SUCCESS (Reputation state matches epoch root. Proceeding with routing.)");

  // 4. Construct EIP-712 ERC-3009 ReceiveWithAuthorization message payload
  const usdcDecimals = 6;
  const paymentAmount = 1.50; // USDC
  const rawValue = BigInt(paymentAmount * Math.pow(10, usdcDecimals));
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour validity window
  
  // Unique transaction nonce
  const nonce = keccak256(encodePacked(["string", "uint256"], ["x402-nonce-", BigInt(Math.floor(Math.random() * 10000000))]));

  // Mock USDC contract address on Arc Testnet
  const usdcTokenAddress = "0x07865c6e87b9f70255377e024ace6630c1eaa37f";

  const domain = {
    name: "USD Coin",
    version: "2",
    chainId: targetAgent.chain_id,
    verifyingContract: usdcTokenAddress as `0x${string}`
  };

  const types = {
    ReceiveWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" }
    ]
  };

  const message = {
    from: clientWallet.address as `0x${string}`,
    to: targetAgent.wallet_address as `0x${string}`,
    value: rawValue,
    validAfter,
    validBefore,
    nonce
  };

  console.log(`\n[Step 4] Compiling ERC-3009 Gasless Transfer Authorization payload:`);
  console.log(`  - Token:        ${domain.name} (v${domain.version}) at contract ${domain.verifyingContract}`);
  console.log(`  - Chain ID:     ${domain.chainId}`);
  console.log(`  - Amount:       ${paymentAmount} USDC (${message.value.toString()} base units)`);
  console.log(`  - Validity:     After block timestamp ${message.validAfter} to ${message.validBefore}`);
  console.log(`  - Nonce:        ${message.nonce}`);

  // 5. Sign EIP-712 message using Privy Server-Controlled Wallet
  console.log(`\n[Step 5] Signing typed authorization payload via Privy walletApi...`);
  const signature = await privy.walletApi.ethereum.signTypedData({
    address: clientWallet.address,
    typedData: {
      domain,
      types,
      primaryType: "ReceiveWithAuthorization",
      message
    }
  });
  console.log(`  - Signature:    ${signature}`);

  // 6. Simulate target agent processing settlement gaslessly over HTTP headers
  console.log(`\n[Step 6] Transmitting command payload and signature to target Agent API...`);
  const replacer = (key: string, value: any) => typeof value === "bigint" ? value.toString() : value;
  console.log("  - Sent HTTP Header: X-PAYMENT: " + Buffer.from(JSON.stringify({ message, signature }, replacer)).toString("base64").substring(0, 80) + "...");
  
  // Verify typed signature locally to mimic ERC-3009 contract verification
  const isSignatureValid = await verifyTypedData({
    address: clientWallet.address as `0x${string}`,
    domain,
    types,
    primaryType: "ReceiveWithAuthorization",
    message,
    signature
  });

  if (!isSignatureValid) {
    console.error("❌ Target Agent Settlement: Payment signature validation FAILED. Rejecting request!");
    db.close();
    return;
  }

  console.log("  - Target Agent Status: ✅ PAYMENT SIGNATURE VERIFIED");
  console.log("  - Target Agent Action: Submitting gasless transaction to USDC contract. Gas settled by target. Task completed!");
  console.log("\nExecution flow finished successfully.");

  db.close();
}

runExecutionLoop().catch(console.error);
