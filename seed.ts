import { Database } from "bun:sqlite";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const SEED_FILE = join(import.meta.dir, "feedbacks_seed.jsonl");
const DB_FILE = process.env.DATABASE_FILE || join(import.meta.dir, "andre8004_cache.db");

function main() {
  console.log(`Starting SQLite seeder...`);

  if (!existsSync(SEED_FILE)) {
    console.error(`Error: Seed file ${SEED_FILE} not found. Please run the ETL first.`);
    process.exit(1);
  }

  // Initialize SQLite Database
  console.log(`Opening database at ${DB_FILE}...`);
  const db = new Database(DB_FILE);

  // Enable WAL mode for concurrency performance
  db.run("PRAGMA journal_mode = WAL;");

  // Create raw_feedbacks schema
  console.log("Creating raw_feedbacks table if not exists...");
  db.run(`
    CREATE TABLE IF NOT EXISTS raw_feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_guid TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      registry_address TEXT NOT NULL,
      token_id TEXT NOT NULL,
      value TEXT NOT NULL,
      value_decimals INTEGER NOT NULL,
      normalized_score REAL NOT NULL,
      client_address TEXT NOT NULL,
      transaction_hash TEXT NOT NULL UNIQUE,
      block_number INTEGER NOT NULL,
      endpoint TEXT,
      tag1 TEXT,
      tag2 TEXT,
      feedback_uri TEXT,
      ingested_at TEXT NOT NULL
    );
  `);

  // Create indexes for efficient analytical queries
  db.run("CREATE INDEX IF NOT EXISTS idx_feedbacks_agent ON raw_feedbacks(agent_guid);");
  db.run("CREATE INDEX IF NOT EXISTS idx_feedbacks_block ON raw_feedbacks(block_number);");

  // Read JSONL file lines
  console.log("Reading feedbacks_seed.jsonl...");
  const content = readFileSync(SEED_FILE, "utf-8");
  const lines = content.split("\n").filter(line => line.trim() !== "");

  console.log(`Parsed ${lines.length} lines. Initiating batch insertion...`);

  // Prepare insert statement
  const insertStatement = db.prepare(`
    INSERT OR IGNORE INTO raw_feedbacks (
      agent_guid, chain_id, registry_address, token_id, value, value_decimals,
      normalized_score, client_address, transaction_hash, block_number,
      endpoint, tag1, tag2, feedback_uri, ingested_at
    ) VALUES (
      $agent_guid, $chain_id, $registry_address, $token_id, $value, $value_decimals,
      $normalized_score, $client_address, $transaction_hash, $block_number,
      $endpoint, $tag1, $tag2, $feedback_uri, $ingested_at
    )
  `);

  let loadedCount = 0;
  let skippedCount = 0;

  // Insert in a single transaction for transaction speed (millisecond execution)
  const transaction = db.transaction((records: any[]) => {
    for (const record of records) {
      const result = insertStatement.run({
        $agent_guid: record.agent_guid,
        $chain_id: record.chain_id,
        $registry_address: record.registry_address,
        $token_id: record.token_id,
        $value: record.value,
        $value_decimals: record.value_decimals,
        $normalized_score: record.normalized_score,
        $client_address: record.client_address,
        $transaction_hash: record.transaction_hash,
        $block_number: record.block_number,
        $endpoint: record.endpoint,
        $tag1: record.tag1,
        $tag2: record.tag2,
        $feedback_uri: record.feedback_uri,
        $ingested_at: record.ingested_at
      });

      // If the row was inserted, changes is 1. If it was skipped due to UNIQUE constraint, changes is 0.
      if (result.changes > 0) {
        loadedCount++;
      } else {
        skippedCount++;
      }
    }
  });

  const parsedRecords = lines.map(line => JSON.parse(line));
  transaction(parsedRecords);

  console.log(`SQLite database successfully seeded.`);
  console.log(`Inserted: ${loadedCount} records`);
  console.log(`Skipped (duplicates): ${skippedCount} records`);
  console.log(`Total database size: ${db.query("SELECT COUNT(*) as count FROM raw_feedbacks;").get().count} records`);

  db.close();
}

main();
