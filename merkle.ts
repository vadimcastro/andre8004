import { keccak256, encodePacked } from "viem";
import { MerkleTree } from "merkletreejs";
import { Database } from "bun:sqlite";
import { join } from "path";

const DB_FILE = join(import.meta.dir, "andre8004_cache.db");

interface CachedAgent {
  agent_guid: string;
  chain_id: number;
  registry_address: string;
  token_id: string;
  wallet_address: string;
  reputation_score: number;
  x402_capable: number;
}

async function main() {
  console.log("Starting Merkle Proof Factory (Optimized Local Generation)...");

  const db = new Database(DB_FILE);
  db.run("PRAGMA journal_mode = WAL;");

  // Ensure merkle_proofs table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS merkle_proofs (
      agent_guid TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      proof TEXT NOT NULL,
      leaf TEXT NOT NULL
    );
  `);

  console.log("Loading cached agents from local SQLite...");
  const agents = db.query("SELECT * FROM cached_agents;").all() as CachedAgent[];
  console.log(`Loaded ${agents.length} agents from local cache.`);

  if (agents.length === 0) {
    console.error("Error: No agents found in local cache. Run sync.ts first.");
    db.close();
    return;
  }

  // 1. Build Merkle Tree
  console.log("\nBuilding Merkle Tree...");
  const epochId = 1n; // Current active epoch

  const leafData = agents.map(agent => {
    // Deterministic Solidity-tight packing: epoch_id, agent_address, reputation_score, x402_capable
    const scaledScore = BigInt(Math.round(agent.reputation_score * 10000));
    const isCapable = agent.x402_capable === 1;

    const leafHash = keccak256(
      encodePacked(
        ["uint256", "address", "int256", "bool"],
        [epochId, agent.wallet_address as `0x${string}`, scaledScore, isCapable]
      )
    );

    return {
      agent_guid: agent.agent_guid,
      wallet_address: agent.wallet_address,
      scaledScore,
      isCapable,
      hash: leafHash
    };
  });

  const leaves = leafData.map(d => Buffer.from(d.hash.slice(2), "hex"));
  
  // Construct tree with OpenZeppelin-compatible sorting
  const startTime = performance.now();
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = "0x" + tree.getRoot().toString("hex");
  const endTime = performance.now();

  console.log(`Merkle Root generated: ${root} (took ${(endTime - startTime).toFixed(2)}ms)`);

  // 2. Save proofs
  console.log("Saving proofs to SQLite...");
  db.run("DELETE FROM merkle_proofs;");
  const insertProof = db.prepare(`
    INSERT INTO merkle_proofs (agent_guid, wallet_address, proof, leaf)
    VALUES ($agent_guid, $wallet_address, $proof, $leaf)
  `);

  db.transaction(() => {
    for (const data of leafData) {
      const bufferHash = Buffer.from(data.hash.slice(2), "hex");
      const proof = tree.getHexProof(bufferHash);

      insertProof.run({
        $agent_guid: data.agent_guid,
        $wallet_address: data.wallet_address,
        $proof: JSON.stringify(proof),
        $leaf: data.hash
      });
    }
  })();

  // Ensure sync_state table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Store Merkle Root in sync_state
  db.run(
    "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('current_merkle_root', ?1);",
    [root]
  );
  db.run(
    "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('current_epoch_id', ?1);",
    [epochId.toString()]
  );

  console.log(`Stored Merkle root and ${leafData.length} proofs in SQLite.`);
  db.close();
}

main().catch(console.error);
