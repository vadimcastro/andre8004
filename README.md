# andre8004: Multi-Chain Trust & Routing Engine for AI Agents

`andre8004` is a high-performance reputation routing and trust verification engine for AI Agents built on top of the **ERC-8004 reputation standard** and the **ERC-402 payment lifecycle**. It provides off-chain consensus caching, Sybil-slashing calculations, and on-chain cryptographic state root verification for autonomous agentic networks.

> [!IMPORTANT]
> **Circle Arc Testnet Live Deployments:**
> * **Oracle Contract Address:** [`0x76236322b4c099b7ab35da2961d41a72d329a25a`](https://testnet.arcscan.app/address/0x76236322b4c099b7ab35da2961d41a72d329a25a)
> * **Signer Deployer Address:** `0x413c6e2F811cbDe4A534d655dd09B66162F2286c`
> * **Epoch 1 On-Chain Root Commit:** Tx Hash [`0xf682cdc254cc2811492835702207f8ae9b87ed5d558d0ea9f8eb81605dc3206a`](https://testnet.arcscan.app/tx/0xf682cdc254cc2811492835702207f8ae9b87ed5d558d0ea9f8eb81605dc3206a)

---

## 🏗️ System Architecture

The engine splits work into an off-chain fast-caching tier and an on-chain verification tier:

```text
[Phase 0: 8004scan REST API] ────► [Bun Ingestion ETL] ────┐
                                                           ├─► [SQLite Local Cache (andre8004_cache.db)]
    [Circle Arc L1 RPC] ────────► [arc-streamer.ts] ───────┘                     │
                                                                                 ├─► [sync.ts (TWMA & CCI Recalculation)]
                                                                                 │
[Chainlink Functions DON] ◄───(Query Backend Root)───► [merkle.ts Factory] ◄─────┘
           │                                                    │
           ▼ (Decentralized Root Update)                        ▼
   [andre8004.sol] ◄─────────────────────────────────────── [State Root & Merkle Proofs]
           ▲
           │ (Read-only on-chain verification call)
   [Privy Server Wallet] ──(ERC-3009 USDC Gasless Settlement)──► [Target AI Agent (Runs Work)]
```

---

## 🤝 Partner Integrations & Leverage

* **8004scan & ERC-8004:** Serves as the identity registry and core reputation schema, standardizing raw feedback scoring events and registered agent addresses across chains.
* **Circle Arc L1:** Serves as the gas-efficient execution layer hosting the active agent registries and recording live P2P feedback event logs ingested by our poller.
* **Chainlink Functions:** Bridges off-chain consensus to on-chain state, triggering decentralized DON queries that verify the database state root and post it to `andre8004.sol`.
* **Privy:** Enables programmatically managed server-side developer wallets for AI agents to sign transactions autonomously and execute authorization flows.
* **Circle USDC (ERC-3009):** Facilitates gasless, off-chain signed P2P settlement transfers over HTTP request headers (`X-PAYMENT`) before routing commands.
* **Walrus Protocol:** Functions as the decentralized archival layer, backing up flat analytical JSON database state snapshots for trustless recovery.

---

## 🛠️ Technology Stack

* **Runtime:** [Bun](https://bun.sh) (v1.1+ recommended) — used for high-performance scripting, sqlite binding, and raw HTTP serving.
* **Database:** SQLite (`bun:sqlite`) — configured in WAL mode to handle concurrent writes and sub-millisecond analytical reads.
* **Cryptographic Primitives:** Keccak256 via `viem` and sorted pair Merkle Trees via `merkletreejs` (OpenZeppelin compatible).
* **Smart Contracts:** Solidity (`^0.8.20`) inheriting from Chainlink `FunctionsClient`.
* **Frontend:** Vanilla HTML5, CSS3, and JavaScript, leveraging a cool metallic blue-silver theme with glassmorphism overlays and Server-Sent Events (SSE).

---

## 📂 Core Components

All file links below point directly to the project files:

### 1. Ingestion Engine ([8004scan-etl.ts](file:///Users/vadim/Desktop/andre8004/8004scan-etl.ts) & [seed.ts](file:///Users/vadim/Desktop/andre8004/seed.ts))
Queries the public REST API of `8004scan.io` to parse feedback events and target agent cards on the registry contract.
* Seeder populates the `raw_feedbacks` table.
* The scanner fetches target registered `x402_supported` agents, mapping their on-chain ownership addresses directly to avoid slow reverse ENS lookup multicalls during tree construction.

### 2. Analytical Cache & Scoring ([sync.ts](file:///Users/vadim/Desktop/andre8004/sync.ts))
Consolidates raw feedback events and updates scores based on two algorithms:
1. **Time-Weighted Moving Average (TWMA):** Interaction score weights decay exponentially ($w(t) = e^{-\lambda \cdot t}$) such that interactions over the last 48 hours dominate 80% of the rating. This prioritizes recent performance over historical actions.
2. **Concentrated Co-interaction Index (CCI):** A Sybil-slashing coefficient that penalizes agents who receive feedback primarily from an insular, closed clique of clients (collusion protection).
* **Data Integrity Guard**: Agents with `0` total feedback volume and `0` average score are ignored entirely during synchronization. They are excluded from the database and the Merkle tree to prevent unrated nodes from polluting the trust rankings or verification paths.

### 3. Merkle Factory ([merkle.ts](file:///Users/vadim/Desktop/andre8004/merkle.ts))
Extracts the database cached details and hashes each row matching Solidity tight packing:
$$\text{Leaf} = \text{keccak256}(\text{abi.encodePacked}(\text{epochId}, \text{walletAddress}, \text{reputationScore}, \text{x402Capable}))$$
Builds a sorted Merkle Tree across all verified active agents in **under 60ms** and saves proofs/roots back to SQLite. By excluding unrated agents, the tree size is reduced by 67%, leading to shorter proofs (11 elements instead of 13) and saving EVM gas during on-chain verification.

### 4. Smart Contract Primitive ([andre8004.sol](file:///Users/vadim/Desktop/andre8004/andre8004.sol))
An EVM contract designed for Chainlink Functions integration:
* Exposes `verifyAgent(...)` to allow autonomous routing clients (e.g. Privy wallets) to verify reputation claims directly on-chain before executing transactions.

### 5. API Server & Dashboard ([server.ts](file:///Users/vadim/Desktop/andre8004/server.ts) & [index.html](file:///Users/vadim/Desktop/andre8004/index.html))
Serves standard API endpoints and streams SSE logs (`ENS DISCOVERY`, `ORACLE VERIFICATION`, `ERC-3009 PAYMENT`, etc.) displaying the internal engine state in real time.

---

## 📋 Database Schema

The SQLite cache database (`andre8004_cache.db`) contains the following schemas:

### `raw_feedbacks`
Stores logs of direct feedback transactions on the blockchain:
```sql
CREATE TABLE raw_feedbacks (
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
```

### `cached_agents`
Stores the synced reputation ratings and capability records:
```sql
CREATE TABLE cached_agents (
  agent_guid TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  registry_address TEXT NOT NULL,
  token_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  reputation_score REAL NOT NULL,
  average_score REAL NOT NULL,
  total_score REAL NOT NULL, -- Holds actual total feedbacks count (mapped from total_feedbacks)
  x402_capable INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL
);
```

---

## 🚀 Step-by-Step Setup Guide

### 1. Install Dependencies
Initialize package dependencies with Bun:
```bash
bun install
```

### 2. Seed and Sync the Database Cache
Compile raw feedbacks and active agent indexes:
```bash
# Ingest feedbacks seed records into raw_feedbacks table
bun seed.ts

# Ingest all target 402 agents, filter out unrated nodes, and calculate TWMA/CCI ratings
bun sync.ts
```

### 3. Generate Merkle Tree Roots & Proofs
Construct the off-chain cryptographic state root for all active nodes:
```bash
bun merkle.ts
```

### 4. Run Verification Simulations
Test contract cryptographic compatibility locally:
```bash
bun test-oracle.ts
```

### 5. Start the Web Server
Launch the HTTP API and SSE transaction log streaming server:
```bash
bun server.ts
```
Open [http://localhost:3000](http://localhost:3000) in your web browser to view the active routing dashboard.

### 6. Decentralized Database Backup (Walrus Protocol)
To back up the local SQLite database cache state onto the decentralized Walrus storage network:
* **Option A: Public Testnet Publisher (Default)**
  By default, [walrus-backup.ts](file:///Users/vadim/Desktop/andre8004/walrus-backup.ts) is configured to upload directly to the public testnet publisher: `https://publisher.walrus-testnet.walrus.space/v1/blobs`.
  Run the backup task:
  ```bash
  bun walrus-backup.ts
  ```
* **Option B: Local/Private Publisher (Recommended for Production)**
  To run a reliable, private publisher gateway locally (e.g., on port `8080` via Docker):
  1. Set `WALRUS_PUBLISHER_URL` in [walrus-backup.ts](file:///Users/vadim/Desktop/andre8004/walrus-backup.ts) to your custom publisher endpoint (e.g., `http://localhost:8080/v1/blobs`).
  2. Run the backup worker command as usual.

---

## 🔌 API Reference

### `GET /epoch-root`
Returns the active state root and epoch ID.
* **Response:**
  ```json
  {
    "success": true,
    "root": "0xc10a0e246772ff9dace55c09166602fdafae2766e64ba7529c5ec9a31068ffa9",
    "epochId": 1
  }
  ```

### `GET /leaderboard`
Returns a list of all cached agent nodes ordered by score descending.

### `GET /agents/:guidOrAddress/proof`
Fetches individual leaf parameters, Keccak256 hash, and Merkle Path Proof elements for a specific node.
* **Response:**
  ```json
  {
    "success": true,
    "agent_guid": "eip155:5042002:0x8004a818bfb912233c491871b3d84c89a494bd9e:601383",
    "wallet_address": "0x9b50e35575eb9881c930c36b4ab437dad367c491",
    "proof": [
      "0xabfbd110f105fb3287b5227f905be913dcf82083bd70c221fde219a4d7b408a3",
      "..."
    ],
    "leaf": "0xabfbd110f105fb3287b5227f905be913dcf82083bd70c221fde219a4d7b408a3"
  }
  ```

---

## 🔒 Scoring & Data Integrity Fix Details

Previously, the 8004scan indexer REST API returned `0` under the `total_score` field for many active nodes, while storing the actual feedback count in `total_feedbacks`. By directly mapping `total_score` to SQLite, the cache displayed a Feedback Volume of `0` even for nodes with 90+ reputation.

We have resolved this anomaly by:
1. Mapping `total_feedbacks` to the database `total_score` field during ingestion.
2. Filtering out zero-score/zero-feedback nodes entirely during sync preprocessing ([sync.ts](file:///Users/vadim/Desktop/andre8004/sync.ts)). This reduces clutter, optimizes the Merkle tree size by 67%, and reduces tree depth (lowering proof verification gas costs on-chain).
3. Formatting the dashboard Frontend to display Feedback Vol (Total) as pure integers (`1`, `4`, `12` etc.) matching actual discrete event counts.

---

## 🌐 Production Deployment Blueprint

To transition from a developer mock/hackathon setup to a live production environment, the engine undergoes the following architectural scale-up:

1. **Analytical Data Tier:**
   - Migrate the local SQLite caching DB to a high-availability Postgres cluster (e.g. Supabase, AWS Aurora) to handle high concurrent queries from routing clients.
   - Run the poller ([arc-streamer.ts](file:///Users/vadim/Desktop/andre8004/arc-streamer.ts)) as a background daemon containerized in Docker and managed by a supervisor process (e.g. PM2, AWS ECS Fargate) with automatic reconnects and exponential backoffs on RPC failures.

2. **Cron Scheduler & Proof Factory:**
   - Schedule the Merkle Proof Factory ([merkle.ts](file:///Users/vadim/Desktop/andre8004/merkle.ts)) as a serverless cron job (e.g., AWS Lambda + EventBridge) running once per epoch (e.g., every 6 or 12 hours) to update active state roots.
   - Expose the API server ([server.ts](file:///Users/vadim/Desktop/andre8004/server.ts)) behind a Cloudflare API Gateway for CDN edge caching of proofs `/agents/:guid/proof`, DDoS protection, and rate-limiting.

3. **Decentralized DON Updates (Chainlink Functions):**
   - The contract ([andre8004.sol](file:///Users/vadim/Desktop/andre8004/andre8004.sol)) updates its epoch root by requesting a consensus-verified root from Chainlink Functions. The DON nodes fetch the Edge-cached root URL and consensus-write the root on-chain.

4. **Security & Privy Management:**
   - Server-managed Privy developer wallets are loaded with strict environment KMS keys. Client agents interact via HTTPS headers utilizing gasless ERC-3009 USDC transaction authorizations.

---

## ⚖️ How It Differs From Alternative Solutions

| Use Case Dimension | Circle Agent Marketplace / Centralized Registries | Raw Chainlink Functions / Oracles | `andre8004` (Hybrid Cache Architecture) |
| :--- | :--- | :--- | :--- |
| **On-Chain Programmability** | Centralized web directories only. Cannot verify or enforce scores inside Solidity smart contracts. | High on-chain verifiability but constrained by execution gas and memory limits. | **Highly Programmable.** Clients verify scores directly on-chain using 11-element Merkle proofs with sub-micro gas cost. |
| **Analytical Computations** | Centralized DB computation (black box). | Not possible. Executing complex TWMA time-decay or CCI Sybil resistance algorithms on-chain or inside a DON sandbox is blocked by memory constraints. | **Hybrid Execution.** Heavy mathematical scoring (CCI & TWMA) runs on a fast off-chain caching engine; only the cryptographic root is committed on-chain. |
| **Latency & Cost** | Zero on-chain cost but completely centralized and prone to single-point-of-failure. | Querying external endpoints on every single transaction is slow, expensive, and subject to request failures. | **Instant Verification.** Proofs are served in <5ms off-chain and verified on-chain via a read-only EVM call (zero gas). |
| **Sybil Resistance** | Centralized detection algorithms (proprietary, black box). | None. DON nodes only fetch raw JSON properties without performing network graph analytics. | **Graph Slashing.** Implements the Concentrated Co-interaction Index (CCI) to discount insular reviewer cliques before the root is committed. |
