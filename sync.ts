import { Database } from "bun:sqlite";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

const DB_FILE = process.env.DATABASE_FILE || join(import.meta.dir, "andre8004_cache.db");
const AGENTS_JSON_FILE = "/Users/vadim/.gemini/antigravity-ide/scratch/all_402_agents.json";

interface RawFeedback {
  agent_guid: string;
  chain_id: number;
  registry_address: string;
  token_id: string;
  normalized_score: number;
  client_address: string;
  transaction_hash: string;
  block_number: number;
  ingested_at: string;
}

interface APIAgent {
  id: string;
  agent_id: string;
  token_id: string;
  chain_id: number;
  contract_address: string;
  owner_address: string;
  x402_supported: boolean;
  total_score?: number;
  average_score?: number;
  total_feedbacks?: number;
  name?: string;
}

function main() {
  console.log("Starting SQLite cache synchronizer with production-grade direct scoring...");

  // Open SQLite database
  const db = new Database(DB_FILE);
  db.run("PRAGMA journal_mode = WAL;");

  // Recreate the cached_agents table to apply new columns
  console.log("Recreating cached_agents table to apply schema updates...");
  db.run("DROP TABLE IF EXISTS cached_agents;");
  db.run(`
    CREATE TABLE cached_agents (
      agent_guid TEXT PRIMARY KEY,
      chain_id INTEGER NOT NULL,
      registry_address TEXT NOT NULL,
      token_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      reputation_score REAL NOT NULL,
      average_score REAL NOT NULL,
      total_score REAL NOT NULL,
      x402_capable INTEGER NOT NULL DEFAULT 0,
      last_updated TEXT NOT NULL
    );
  `);

  console.log("Fetching raw feedback events from database...");
  const rawFeedbacks = db.query("SELECT * FROM raw_feedbacks;").all() as RawFeedback[];
  console.log(`Loaded ${rawFeedbacks.length} feedback events.`);

  // Calculate reviewer statistics (Total reviews per client address)
  const clientTotals: Record<string, number> = {};
  for (const f of rawFeedbacks) {
    clientTotals[f.client_address] = (clientTotals[f.client_address] || 0) + 1;
  }

  // Calculate client-agent pairings (Reviews per client for each specific agent)
  const clientAgentTotals: Record<string, Record<string, number>> = {};
  const feedbackCounts: Record<string, number> = {};
  for (const f of rawFeedbacks) {
    feedbackCounts[f.agent_guid] = (feedbackCounts[f.agent_guid] || 0) + 1;
    if (!clientAgentTotals[f.client_address]) {
      clientAgentTotals[f.client_address] = {};
    }
    clientAgentTotals[f.client_address][f.agent_guid] = 
      (clientAgentTotals[f.client_address][f.agent_guid] || 0) + 1;
  }

  // Group feedbacks by agent to compute TWMA and Sybil-slashing concentration (CCI)
  interface AgentScore {
    reputationScore: number;
    x402Capable: number;
  }
  const feedbackBasedScores: Record<string, AgentScore> = {};
  const now = Date.now();

  interface AgentAccumulator {
    weightedScoreSum: number;
    weightedCCISum: number;
    weightSum: number;
  }
  const agentGroups: Record<string, AgentAccumulator> = {};

  for (const f of rawFeedbacks) {
    const guid = f.agent_guid;
    if (!agentGroups[guid]) {
      agentGroups[guid] = {
        weightedScoreSum: 0,
        weightedCCISum: 0,
        weightSum: 0
      };
    }

    const accum = agentGroups[guid];
    const ageMs = now - new Date(f.ingested_at).getTime();
    const ageHours = Math.max(0, ageMs / (1000 * 60 * 60));
    const weight = Math.exp(-0.03353 * ageHours);

    const clientReviewsForAgent = clientAgentTotals[f.client_address][guid] || 1;
    const clientTotalReviews = clientTotals[f.client_address] || 1;
    const concentration = clientReviewsForAgent / clientTotalReviews;

    accum.weightedScoreSum += weight * f.normalized_score;
    accum.weightedCCISum += weight * concentration;
    accum.weightSum += weight;
  }

  for (const guid of Object.keys(agentGroups)) {
    const accum = agentGroups[guid];
    if (accum.weightSum > 0) {
      const rawReputation = accum.weightedScoreSum / accum.weightSum;
      const cci = accum.weightedCCISum / accum.weightSum;
      const finalScore = rawReputation * (1.0 - cci);
      feedbackBasedScores[guid] = {
        reputationScore: finalScore,
        x402Capable: 1
      };
    }
  }

  // Load all 5,757 target x402 agents
  let apiAgents: APIAgent[] = [];
  if (existsSync(AGENTS_JSON_FILE)) {
    console.log(`Loading target agents from ${AGENTS_JSON_FILE}...`);
    try {
      const dataStr = readFileSync(AGENTS_JSON_FILE, "utf-8");
      apiAgents = JSON.parse(dataStr) as APIAgent[];
      console.log(`Loaded ${apiAgents.length} target agents from JSON.`);
    } catch (e) {
      console.error("Failed to parse agents JSON:", e);
    }
  } else {
    console.warn(`Warning: Agents JSON file not found at ${AGENTS_JSON_FILE}.`);
  }

  const nowStr = new Date().toISOString();
  const insertStatement = db.prepare(`
    INSERT INTO cached_agents (
      agent_guid, chain_id, registry_address, token_id, wallet_address, reputation_score, average_score, total_score, x402_capable, last_updated
    ) VALUES (
      $agent_guid, $chain_id, $registry_address, $token_id, $wallet_address, $reputation_score, $average_score, $total_score, $x402_capable, $last_updated
    )
  `);

  console.log("Writing ingested agents into SQLite cached_agents...");
  let insertedCount = 0;
  const seenGuids = new Set<string>();

  db.transaction(() => {
    // A. Insert target agents from JSON first
    for (const agent of apiAgents) {
      const chainId = agent.chain_id;
      const registry = agent.contract_address;
      const tokenId = agent.token_id;
      const guid = `eip155:${chainId}:${registry}:${tokenId}`;
      if (seenGuids.has(guid)) continue;
      seenGuids.add(guid);

      // Raw scores: Use average_score as primary reputation score.
      // Set to 0.00 if unrated on the indexer (no mock trust generation).
      let averageScore = agent.average_score || 0.0;
      let totalScore = agent.total_feedbacks || 0.0;

      // Overwrite with locally-computed TWMA/CCI if active feedbacks are found
      let primaryRep = averageScore;
      if (feedbackBasedScores[guid]) {
        primaryRep = feedbackBasedScores[guid].reputationScore;
        averageScore = primaryRep;
        totalScore = feedbackCounts[guid] || totalScore;
      }

      // Strict Data Integrity Guard: Ignore inactive/unrated agents entirely
      if (averageScore === 0 && totalScore === 0) {
        continue;
      }

      insertStatement.run({
        $agent_guid: guid,
        $chain_id: chainId,
        $registry_address: registry,
        $token_id: tokenId,
        $wallet_address: agent.owner_address || "0x0000000000000000000000000000000000000000",
        $reputation_score: primaryRep,
        $average_score: averageScore,
        $total_score: totalScore,
        $x402_capable: agent.x402_supported ? 1 : 0,
        $last_updated: nowStr
      });
      insertedCount++;
    }

    // B. Insert any leftover agents that only exist in feedbacks (non-402, etc.)
    for (const [guid, info] of Object.entries(feedbackBasedScores)) {
      if (seenGuids.has(guid)) continue;

      const parts = guid.split(":");
      if (parts.length < 4) continue;
      const chainId = parseInt(parts[1]);
      const registry = parts[2];
      const tokenId = parts[3];

      const mockOwner = "0xb8b3d4e3a91e5629d304253d494d0d4a2b41bc50";
      const feedbacksCount = feedbackCounts[guid] || 0;

      if (info.reputationScore === 0 && feedbacksCount === 0) {
        continue;
      }

      insertStatement.run({
        $agent_guid: guid,
        $chain_id: chainId,
        $registry_address: registry,
        $token_id: tokenId,
        $wallet_address: mockOwner,
        $reputation_score: info.reputationScore,
        $average_score: info.reputationScore,
        $total_score: feedbacksCount,
        $x402_capable: info.x402Capable,
        $last_updated: nowStr
      });
      insertedCount++;
    }
  })();

  console.log(`Synchronization complete. Ingested ${insertedCount} agents into cached_agents cache.`);
  db.close();
}

main();
