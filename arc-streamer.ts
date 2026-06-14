import { createPublicClient, http, parseEventLogs } from "viem";
import { Database } from "bun:sqlite";
import { join } from "path";

// Circle Arc L1 RPC and config details
const ARC_RPC_URL = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002;
// Default registry address for agent reputation on Arc
const REGISTRY_ADDRESS = (process.env.ARC_REPUTATION_REGISTRY || "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432") as `0x${string}`;

const DB_FILE = process.env.DATABASE_FILE || join(import.meta.dir, "andre8004_cache.db");

const abi = [
  {
    type: "event",
    name: "NewFeedback",
    inputs: [
      { type: "uint256", name: "agentId", indexed: true },
      { type: "address", name: "clientAddress", indexed: true },
      { type: "uint64", name: "feedbackIndex", indexed: false },
      { type: "int128", name: "value", indexed: false },
      { type: "uint8", name: "valueDecimals", indexed: false },
      { type: "string", name: "indexedTag1", indexed: true },
      { type: "string", name: "tag1", indexed: false },
      { type: "string", name: "tag2", indexed: false },
      { type: "string", name: "endpoint", indexed: false },
      { type: "string", name: "feedbackURI", indexed: false },
      { type: "bytes32", name: "feedbackHash", indexed: false }
    ]
  }
] as const;

async function main() {
  console.log("Starting Arc L1 ETL Streamer...");
  console.log(`Connecting to Circle Arc RPC: ${ARC_RPC_URL}`);
  console.log(`Registry address: ${REGISTRY_ADDRESS}`);

  // Open Database
  const db = new Database(DB_FILE);
  db.run("PRAGMA journal_mode = WAL;");

  // Create sync_state table to track index progress
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Ensure raw_feedbacks table exists (in case seed wasn't run)
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

  // Initialize Viem Client
  const client = createPublicClient({
    transport: http(ARC_RPC_URL)
  });

  // Get current block
  let currentBlock = 0n;
  try {
    currentBlock = await client.getBlockNumber();
    console.log(`Current Arc L1 block height: ${currentBlock}`);
  } catch (error) {
    console.error("Failed to fetch initial block height:", error);
    process.exit(1);
  }

  // Load last processed block
  const syncStateQuery = db.query("SELECT value FROM sync_state WHERE key = 'last_processed_block';");
  const row = syncStateQuery.get() as { value: string } | null;
  let startBlock = 0n;

  if (row) {
    startBlock = BigInt(row.value) + 1n;
    console.log(`Resuming sync from block ${startBlock} (saved state)`);
  } else {
    // Start 100 blocks back to avoid missing immediate setup transactions
    startBlock = currentBlock - 100n;
    if (startBlock < 0n) startBlock = 0n;
    console.log(`No saved state. Starting search from block ${startBlock} (current - 100)`);
  }

  // Prepare SQLite insert statement
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

  // Stream polling loop
  const blockRangeLimit = 500n; // Chunk size to query logs

  while (true) {
    try {
      const latestBlock = await client.getBlockNumber();
      if (startBlock > latestBlock) {
        // We are caught up. Sleep 10s before checking again.
        await new Promise((resolve) => setTimeout(resolve, 10000));
        continue;
      }

      let toBlock = startBlock + blockRangeLimit;
      if (toBlock > latestBlock) {
        toBlock = latestBlock;
      }

      console.log(`Polling events from block ${startBlock} to ${toBlock}...`);

      // Fetch logs
      const logs = await client.getLogs({
        address: REGISTRY_ADDRESS,
        event: abi[0],
        fromBlock: startBlock,
        toBlock: toBlock
      });

      if (logs.length > 0) {
        console.log(`Found ${logs.length} feedback events.`);
        
        db.transaction(() => {
          for (const log of logs) {
            // Safe decoding using viem
            const decoded = parseEventLogs({
              abi,
              logs: [log]
            })[0];

            if (!decoded || decoded.eventName !== "NewFeedback") continue;

            const { args } = decoded;
            const agentId = args.agentId.toString();
            const clientAddress = args.clientAddress;
            const val = args.value.toString();
            const valueDecimals = args.valueDecimals;
            const tag1 = args.tag1;
            const tag2 = args.tag2;
            const endpoint = args.endpoint;
            const feedbackUri = args.feedbackURI;
            const txHash = log.transactionHash;
            const blockNum = Number(log.blockNumber);

            // Compute CAIP-10 GUID
            const agentGUID = `eip155:${ARC_CHAIN_ID}:${REGISTRY_ADDRESS}:${agentId}`;
            const rawValue = parseFloat(val);
            const normalizedScore = rawValue * Math.pow(10, -valueDecimals);

            insertStatement.run({
              $agent_guid: agentGUID,
              $chain_id: ARC_CHAIN_ID,
              $registry_address: REGISTRY_ADDRESS,
              $token_id: agentId,
              $value: val,
              $value_decimals: valueDecimals,
              $normalized_score: normalizedScore,
              $client_address: clientAddress,
              $transaction_hash: txHash,
              $block_number: blockNum,
              $endpoint: endpoint,
              $tag1: tag1,
              $tag2: tag2,
              $feedback_uri: feedbackUri,
              $ingested_at: new Date().toISOString()
            });
          }
        })();
        
        console.log(`Successfully indexed and saved events to SQLite.`);
      }

      // Update sync state
      db.run(
        "INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_processed_block', ?1);",
        [toBlock.toString()]
      );

      startBlock = toBlock + 1n;

    } catch (error) {
      console.error("Error encountered in streamer loop:", error);
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

main().catch(console.error);
