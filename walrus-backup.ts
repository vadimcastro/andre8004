import { Database } from "bun:sqlite";
import { join } from "path";

const DB_FILE = process.env.DATABASE_FILE || join(import.meta.dir, "andre8004_cache.db");
const WALRUS_PUBLISHER_URL = "https://publisher.walrus-testnet.walrus.space/store";

interface CachedAgent {
  agent_guid: string;
  chain_id: number;
  registry_address: string;
  token_id: string;
  wallet_address: string;
  reputation_score: number;
  average_score: number;
  total_score: number;
  x402_capable: number;
  last_updated: string;
}

async function runBackup() {
  console.log("=== Starting Walrus Protocol Backup Worker ===");

  // 1. Establish Database Connection
  const db = new Database(DB_FILE);
  console.log(`Connecting to local analytical SQLite cache...`);

  // 2. Fetch Cached Agents & Sync State Metadata
  let agents: CachedAgent[] = [];
  let currentRoot = "0x0";
  let currentEpochId = "1";

  try {
    agents = db.query("SELECT * FROM cached_agents;").all() as CachedAgent[];
    console.log(`Fetched ${agents.length} active agent records from cache.`);

    const rootRow = db.query("SELECT value FROM sync_state WHERE key = 'current_merkle_root';").get() as { value: string } | null;
    const epochRow = db.query("SELECT value FROM sync_state WHERE key = 'current_epoch_id';").get() as { value: string } | null;

    if (rootRow) currentRoot = rootRow.value;
    if (epochRow) currentEpochId = epochRow.value;
  } catch (error) {
    console.error("Database query failed. Ensure sync.ts has been executed.", error);
    db.close();
    return;
  }

  // 3. Compile snapshot object
  const snapshot = {
    metadata: {
      backup_timestamp: new Date().toISOString(),
      merkle_root: currentRoot,
      epoch_id: currentEpochId,
      record_count: agents.length
    },
    agents: agents
  };

  const payload = JSON.stringify(snapshot, null, 2);
  const payloadBytes = Buffer.byteLength(payload, "utf-8");
  console.log(`Compiled DB backup snapshot: ${payloadBytes} bytes`);

  // 4. PUT Request to Walrus Publisher API
  // Specify epochs=1 for standard storage duration on testnet
  const targetUrl = `${WALRUS_PUBLISHER_URL}?epochs=1`;
  console.log(`\nUploading snapshot to Walrus Testnet Publisher: ${targetUrl}...`);

  try {
    const response = await fetch(targetUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: payload
    });

    if (!response.ok) {
      throw new Error(`Walrus API request failed: ${response.statusText} (Status: ${response.status})`);
    }

    const result = await response.json();
    console.log("\n✅ Web3 Storage Upload Completed!");

    // Parse Walrus API response schema (newlyCreated or alreadyCertified)
    if (result.newlyCreated) {
      const blobObject = result.newlyCreated.blobObject;
      console.log(`  - Blob ID:        ${blobObject.blobId}`);
      console.log(`  - Sui Object ID:  ${blobObject.id}`);
      console.log(`  - Stored Epoch:   ${blobObject.storedEpoch}`);
      console.log(`  - Storage Cost:   ${result.newlyCreated.cost} Mist`);
    } else if (result.alreadyCertified) {
      const blobObject = result.alreadyCertified.blobObject;
      console.log(`  - Blob ID (Duplicate): ${blobObject.blobId}`);
      console.log(`  - Sui Object ID:       ${blobObject.id}`);
    } else {
      console.log("Response:", result);
    }
    
    // Save backup tracking information inside SQLite
    db.run(`
      CREATE TABLE IF NOT EXISTS backup_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        blob_id TEXT NOT NULL,
        merkle_root TEXT NOT NULL,
        epoch_id TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);

    const blobId = result.newlyCreated?.blobObject?.blobId || result.alreadyCertified?.blobObject?.blobId || "unknown";
    db.run(
      "INSERT INTO backup_history (blob_id, merkle_root, epoch_id, timestamp) VALUES (?, ?, ?, ?);",
      [blobId, currentRoot, currentEpochId, new Date().toISOString()]
    );
    console.log(`\nLogged backup details to local backup_history table.`);

  } catch (error) {
    console.error("❌ Failed to complete Walrus Protocol backup:", error);
  } finally {
    db.close();
  }
}

runBackup().catch(console.error);
