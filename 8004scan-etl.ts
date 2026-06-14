import { writeFileSync } from "fs";
import { join } from "path";

// 8004scan public feedback endpoint
const API_URL = "https://8004scan.io/api/v1/public/feedbacks";
const OUTPUT_FILE = join(import.meta.dir, "feedbacks_seed.jsonl");

interface FeedbackItem {
  id: string;
  chain_id: number;
  value: string;
  value_decimals: number;
  user_address: string;
  transaction_hash: string;
  block_number: number;
  endpoint: string;
  tag1: string;
  tag2: string;
  feedback_uri: string;
  agent?: {
    token_id: string;
    registry_address: string;
    name: string;
  };
}

async function runETL() {
  console.log("Starting 8004scan Subgraph/API ETL Process...");
  let page = 1;
  const limit = 50;
  let allRecordsCount = 0;
  const jsonlLines: string[] = [];

  while (true) {
    const url = `${API_URL}?limit=${limit}&page=${page}`;
    console.log(`Fetching page ${page}: ${url}...`);
    
    try {
      let response = await fetch(url);
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after");
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : 3000;
        console.warn(`Rate limited (429). Retrying after ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        response = await fetch(url);
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch page ${page}: ${response.statusText} (Status: ${response.status})`);
      }

      const payload = await response.json();
      if (!payload.success || !Array.isArray(payload.data) || payload.data.length === 0) {
        console.log(`No more records found on page ${page}. Ingestion complete.`);
        break;
      }

      const items: FeedbackItem[] = payload.data;
      for (const item of items) {
        const chainId = item.chain_id;
        const registryAddress = item.agent?.registry_address || "0x0000000000000000000000000000000000000000";
        const tokenId = item.agent?.token_id || "0";
        
        // CAIP-10 Globally Unique Identifier (GUID)
        const agentGUID = `eip155:${chainId}:${registryAddress}:${tokenId}`;
        
        const rawValue = parseFloat(item.value || "0");
        const decimals = item.value_decimals ?? 0;
        const normalizedScore = rawValue * Math.pow(10, -decimals);

        const record = {
          agent_guid: agentGUID,
          chain_id: chainId,
          registry_address: registryAddress,
          token_id: tokenId,
          value: item.value,
          value_decimals: decimals,
          normalized_score: normalizedScore,
          client_address: item.user_address,
          transaction_hash: item.transaction_hash,
          block_number: item.block_number,
          endpoint: item.endpoint,
          tag1: item.tag1,
          tag2: item.tag2,
          feedback_uri: item.feedback_uri,
          ingested_at: new Date().toISOString()
        };

        jsonlLines.push(JSON.stringify(record));
        allRecordsCount++;
      }

      console.log(`Ingested ${items.length} records from page ${page}. Total so far: ${allRecordsCount}`);
      page++;
      
      // Short delay to avoid aggressive rate-limiting
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.error(`Error during ingestion on page ${page}:`, error);
      break;
    }
  }

  if (jsonlLines.length > 0) {
    writeFileSync(OUTPUT_FILE, jsonlLines.join("\n") + "\n", "utf-8");
    console.log(`Successfully wrote ${allRecordsCount} records to ${OUTPUT_FILE}`);
  } else {
    console.log("No records found to write.");
  }
}

runETL().catch(console.error);
