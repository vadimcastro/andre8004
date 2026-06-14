import { Database } from "bun:sqlite";
import { join } from "path";

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DATABASE_FILE || join(import.meta.dir, "andre8004_cache.db");
const HTML_FILE = join(import.meta.dir, "index.html");

const db = new Database(DB_FILE);

// Load index.html
const indexHtml = Bun.file(HTML_FILE);

// Store SSE connections
const sseClients = new Set<ReadableStreamDefaultController>();

function broadcast(type: string, message: string, txHash?: string) {
  const payload = JSON.stringify({ type, message, txHash, timestamp: new Date().toISOString() });
  const data = `data: ${payload}\n\n`;
  for (const client of sseClients) {
    try {
      client.enqueue(new TextEncoder().encode(data));
    } catch {
      sseClients.delete(client);
    }
  }
}

// Simulated active routing loop (for high-fidelity demo feed)
setInterval(() => {
  const randomGuids = [
    "eip155:5042002:0x8004a818bfb912233c491871b3d84c89a494bd9e:495333",
    "eip155:5042002:0x8004a818bfb912233c491871b3d84c89a494bd9e:494032",
    "eip155:5042002:0x8004a818bfb912233c491871b3d84c89a494bd9e:495107"
  ];
  const guid = randomGuids[Math.floor(Math.random() * randomGuids.length)];
  const tokenId = guid.split(":")[3];
  
  const eventTypes = ["ENS DISCOVERY", "ORACLE VERIFICATION", "ERC-3009 PAYMENT", "REPUTATION SYNC", "SECURITY MONITORING"];
  const type = eventTypes[Math.floor(Math.random() * eventTypes.length)];

  let message = "";
  let tx: string | undefined = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

  if (type === "ENS DISCOVERY") {
    message = `Resolved ENS text records for agent token ${tokenId}. Verified reverse resolution, capability declarations (x402=true), and endpoint match on-chain. Routing client connection.`;
    tx = undefined;
  } else if (type === "ORACLE VERIFICATION") {
    message = `verifyAgent(epochId: 1, agentGUID: ${guid.substring(0, 25)}..., score: 92.52) executed. Cryptographic Merkle Root checked against Chainlink Functions historical record. Node state validated!`;
  } else if (type === "ERC-3009 PAYMENT") {
    message = `Circle USDC gasless settlement: Privy server wallet signed ReceiveWithAuthorization off-chain. Target agent submitted payload on-chain, settled 1.50 USDC fee, and executed request.`;
  } else if (type === "REPUTATION SYNC") {
    message = `Local SQLite analytical cache updated. Recalculated Exponential TWMA weight decay and Sybil-slashing Concentrated Co-interaction Index (CCI) for all 5,814 cached nodes.`;
    tx = undefined;
  } else if (type === "SECURITY MONITORING") {
    message = `Mempool listener caught anomalous feedback transaction. Slashing penalty triggered: Agent token ${tokenId} dropped optimistically from local routing table before next epoch sync.`;
  }

  broadcast(type, message, tx);
}, 12000);

// Start Server
console.log(`Starting andre8004 API server on port ${PORT}...`);
Bun.serve({
  port: Number(PORT),
  async fetch(req) {
    const url = new URL(req.url);

    // Root - Serve Leaderboard UI
    if (url.pathname === "/") {
      return new Response(indexHtml, {
        headers: { "Content-Type": "text/html" }
      });
    }

    // GET /epoch-root
    if (url.pathname === "/epoch-root") {
      try {
        const rootRow = db.query("SELECT value FROM sync_state WHERE key = 'current_merkle_root';").get() as { value: string } | null;
        const epochRow = db.query("SELECT value FROM sync_state WHERE key = 'current_epoch_id';").get() as { value: string } | null;
        return Response.json({
          success: true,
          root: rootRow ? rootRow.value : "0x0",
          epochId: epochRow ? parseInt(epochRow.value) : 1
        });
      } catch (e) {
        return Response.json({ success: false, error: "sync_state table empty or not initialized" }, { status: 500 });
      }
    }

    // GET /leaderboard
    if (url.pathname === "/leaderboard") {
      try {
        const board = db.query("SELECT * FROM cached_agents ORDER BY reputation_score DESC;").all();
        return Response.json(board);
      } catch (e) {
        return Response.json({ success: false, error: "Database cache not populated yet" }, { status: 500 });
      }
    }

    // GET /agents/:address/proof (matches address or GUID)
    const proofMatch = url.pathname.match(/^\/agents\/(.+)\/proof$/);
    if (proofMatch) {
      const searchParam = decodeURIComponent(proofMatch[1]);
      try {
        const proofRow = db.query(`
          SELECT * FROM merkle_proofs 
          WHERE wallet_address = ?1 OR agent_guid = ?1;
        `).get(searchParam) as { agent_guid: string, wallet_address: string, proof: string, leaf: string } | null;

        if (proofRow) {
          return Response.json({
            success: true,
            agent_guid: proofRow.agent_guid,
            wallet_address: proofRow.wallet_address,
            proof: JSON.parse(proofRow.proof),
            leaf: proofRow.leaf
          });
        } else {
          return Response.json({ success: false, error: `Proof not found for agent: ${searchParam}` }, { status: 404 });
        }
      } catch (e) {
        return Response.json({ success: false, error: "Merkle proofs table not populated yet" }, { status: 500 });
      }
    }

    // GET /stream (SSE Endpoint)
    if (url.pathname === "/stream") {
      const stream = new ReadableStream({
        start(controller) {
          sseClients.add(controller);
          // Send initial keep-alive comment
          controller.enqueue(new TextEncoder().encode(": keep-alive\n\n"));
        },
        cancel(controller) {
          sseClients.delete(controller);
        }
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive"
        }
      });
    }

    return new Response("Not Found", { status: 404 });
  }
});
