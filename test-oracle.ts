import { Database } from "bun:sqlite";
import { keccak256, encodePacked } from "viem";
import { join } from "path";

const DB_FILE = process.env.DATABASE_FILE || join(import.meta.dir, "andre8004_cache.db");

// Reconstruct verification matching andre8004.sol logic
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

function runTest() {
  console.log("Starting Oracle Cryptographic Verification Simulation...");

  const db = new Database(DB_FILE);
  
  // 1. Fetch root and epoch
  const rootRow = db.query("SELECT value FROM sync_state WHERE key = 'current_merkle_root';").get() as { value: string } | null;
  const epochRow = db.query("SELECT value FROM sync_state WHERE key = 'current_epoch_id';").get() as { value: string } | null;

  if (!rootRow || !epochRow) {
    console.error("Error: Merkle root not generated yet. Please wait for merkle.ts to complete.");
    db.close();
    return;
  }

  const root = rootRow.value;
  const epochId = BigInt(epochRow.value);

  console.log(`Using active root: ${root}`);
  console.log(`Using active epoch: ${epochId}`);

  // 2. Fetch an agent and its proof
  // Query wallet_address as resolved by merkle.ts
  const agent = db.query(`
    SELECT ca.*, mp.wallet_address, mp.proof, mp.leaf 
    FROM cached_agents ca
    JOIN merkle_proofs mp ON ca.agent_guid = mp.agent_guid
    LIMIT 1;
  `).get() as {
    agent_guid: string;
    reputation_score: number;
    x402_capable: number;
    wallet_address: string;
    proof: string;
    leaf: string;
  } | null;

  if (!agent) {
    console.error("Error: No agents or proofs found in database.");
    db.close();
    return;
  }

  const proof = JSON.parse(agent.proof) as string[];
  const leaf = agent.leaf;

  console.log(`\nTesting Node: ${agent.agent_guid}`);
  console.log(`Wallet Address: ${agent.wallet_address}`);
  console.log(`Reputation Score: ${agent.reputation_score}`);
  console.log(`x402 Capable: ${agent.x402_capable === 1}`);
  console.log(`Leaf Hash: ${leaf}`);
  console.log(`Proof length: ${proof.length} elements`);

  // Test Case 1: Valid proof
  console.log("\n[Test Case 1] Verifying with valid credentials and proof...");
  const isValid = verifyProof(proof, root, leaf);
  console.log(`Verification Result: ${isValid ? "SUCCESS (Valid Claim Verified)" : "FAILED"}`);

  // Test Case 2: Tampered Score
  console.log("\n[Test Case 2] Verifying with tampered score (increasing rating by 10%)...");
  const tamperedScore = agent.reputation_score + 1.0;
  const tamperedScoreBigInt = BigInt(Math.round(tamperedScore * 10000));
  const isCapable = agent.x402_capable === 1;

  const tamperedLeaf = keccak256(
    encodePacked(
      ["uint256", "address", "int256", "bool"],
      [epochId, agent.wallet_address as `0x${string}`, tamperedScoreBigInt, isCapable]
    )
  );

  const isTamperedValid = verifyProof(proof, root, tamperedLeaf);
  console.log(`Verification Result: ${isTamperedValid ? "VALID (FAIL)" : "BLOCKED (SUCCESS: Tampered score rejected)"}`);

  // Test Case 3: Tampered Proof Path
  console.log("\n[Test Case 3] Verifying with tampered proof path (modifying first element)...");
  const tamperedProof = [...proof];
  if (tamperedProof.length > 0) {
    tamperedProof[0] = "0x0000000000000000000000000000000000000000000000000000000000000000";
  }
  const isTamperedProofValid = verifyProof(tamperedProof, root, leaf);
  console.log(`Verification Result: ${isTamperedProofValid ? "VALID (FAIL)" : "BLOCKED (SUCCESS: Tampered proof rejected)"}`);

  db.close();
}

runTest();
