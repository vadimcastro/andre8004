# andre8004: Master Implementation Plan

**Team Philosophy:** *First Principles. Iterative & Auditable. Efficient.* We build from the ground up, ensuring every component is mathematically sound and verifiable. We will iterate quickly through local caching before trusting on-chain state, keeping the codebase lean, serverless where possible, and hyper-optimized for the hackathon window.

---

## **Architecture Flow**

```text
[Phase 0: 8004scan Seed JSONL] ──► [Bun seed.ts Loader] ──┐
                                                          ├──► [SQLite raw_feedbacks Table] ──► [SQLite TWMA/CCI SQL Query] ──► [SQLite cached_agents Table]
    [Circle Arc RPC] ──► [Bun arc-streamer.ts Poller] ────┘                                                                           │
                                                                                                                                      ├─► [WS Slashing Mempool Listener]
    [ENS Reverse -> Primary Name -> Text Records] ──────────────────────────────────────────────────────────────────────────────────────► [andre8004 Core Engine]
                                                                                                                                      │ (Generates Epoch Merkle Proof)
                                                                                                                                      ▼
[Privy Server Wallet] ◄──────────────(Consults Oracle)──────────────► [andre8004 (Chainlink Functions Root Update)] ◄────────────────┘
  │
  └──(Direct HTTP 402 Payment: ERC-3009 Signed Tx)──► [Target AI Agent (Executes & Pays Gas)]
```

## **Phase 0: Live Mainnet Ingestion & Local Database Setup (Priority: High) — [COMPLETE]**

**Goal:** Populate a local database with real ERC-8004 reputation data using the 8004scan indexer to simulate an active agentic economy.

* **[COMPLETE] Task 0.1 (8004scan Subgraph ETL):** Write an `8004scan-etl.ts` script in Bun. Query the public 8004scan REST API to extract a seed of real agent identity cards and `NewFeedback` events. Extract `agentId`, `value` (`int128`), and `valueDecimals` (`uint8`) fields. Compute the normalized reputation score ($value \times 10^{-valueDecimals}$) and format the extracted stream into newline-delimited JSON (`.jsonl`).
* **[COMPLETE] Task 0.2 (Local SQLite Seed Loader):** Write `seed.ts` using `bun:sqlite` to read `feedbacks_seed.jsonl` and batch insert the records into a local SQLite table named `raw_feedbacks` inside `andre8004_cache.db`.

## **Phase 1: The Multi-Chain Data & Ingestion Engine (Priority: High) — [COMPLETE]**

**Goal:** Build the data tier that merges native seeded feedback datasets with live custom L1 logs.

* **[COMPLETE] Task 1.1 (Arc L1 ETL Stream):** Write `arc-streamer.ts` in Bun. Poll the Circle Arc L1 RPC endpoint, extract raw transaction logs, and insert them directly into the local SQLite `raw_feedbacks` table. Track progress using `sync_state`.
* **[COMPLETE] Task 1.2 (Unified Ingestion Pipeline):** Ingest all 5,757 target x402 agents resolved from 8004scan APIs directly into the database. Map all agents to a Globally Unique Identifier (GUID) following the CAIP-10 standard (`eip155:<chain_id>:<contract_address>:<agent_id>`).
* **[COMPLETE] Task 1.3 (Algorithmic Ranking & TWMA):** Implement a Time-Weighted Moving Average (TWMA) calculation decay ($w(t) = e^{-\lambda \cdot t}$) and a Sybil-slashing modifier using a Concentrated Co-interaction Index (CCI) that penalizes agents receiving feedback primarily from an insular, closed clique of clients.
* **[COMPLETE] Task 1.4 (Optimized Local Cache Worker):** Re-engineer `sync.ts` using `bun:sqlite` to run this local pipeline, recalculating scores for active nodes and storing the raw `average_score` (Reputation) and `total_score` (Volume) directly to the local cache worker. Filters out zero-score and zero-feedback agents entirely to enforce strict data integrity.

## **Phase 2: Naming Resolution & Merkle Proof Factory (Priority: High) — [COMPLETE]**

**Goal:** Cross-verify metadata declarations and compile trustless, off-chain state roots.

* **[COMPLETE] Task 2.1 (Metadata Resolution):** Load actual owner addresses and capability declarations directly from the `8004scan` indexer dataset, bypassing slow reverse-lookup multicalls during tree generation.
* **[COMPLETE] Task 2.2 (Temporal Cryptographic Engine):** Write `merkle.ts` using OpenZeppelin-compatible sorting. Hash each database row deterministically matching Solidity: `keccak256(abi.encodePacked(epochId, walletAddress, reputationScore, x402Capable))`. Construct the Merkle tree across the 1,915 active cached agents in under 60ms.
* **[COMPLETE] Task 2.3 (Root Exposer):** Export the Merkle Root, and serve individual proofs via a lightweight backend HTTP endpoint (`/agents/:address/proof`) in Bun for client consumption.

## **Phase 3: The Verification Oracle Contract (Priority: High) — [COMPLETE]**

**Goal:** Deploy the core on-chain validation primitive using Foundry.

* **[COMPLETE] Task 3.1 (Solidity Architecture):** Write `andre8004.sol`. Inherit from Chainlink's `FunctionsClient` to support decentralized Merkle root updates via Chainlink Functions. Expose a callback function that receives the consensus-verified Merkle root and stores it in a historical root mapping.
* **[COMPLETE] Task 3.2 (The Verification Method):** Implement `verifyAgent(uint256 epochId, address targetAgent, int256 score, bool x402Capable, bytes32[] calldata proof)`. The method validates the proof against the historical root matching `epochId`.
* **[COMPLETE] Task 3.3 (Contract Verification Simulation):** Author `test-oracle.ts` simulating Solidity verification logic locally. Fully verify valid proofs, tampered scores, and altered proof paths against the 1,915-element Merkle root in the database.

## **Phase 4: Privy Integration & x402 Execution Loop (Priority: Medium) — [COMPLETE]**

**Goal:** Harness automated agent wallets to run production loops leveraging the oracle and HTTP payments.

* **[COMPLETE] Task 4.1 (Privy Agent Setup):** Configure server-managed, programmatically controlled wallet environments using `@privy-io/server-auth` (mocked for development, fully modular for credentials upgrade).
* **[COMPLETE] Task 4.2 (Oracle Consultation):** Program the client agent to request a task, check the target agent's proof, and verify reputation status before initiating payment.
* **[COMPLETE] Task 4.3 (P2P x402 Settlement):** Implement the ERC-3009 payment lifecycle off-chain, signing `ReceiveWithAuthorization` payloads and sending them via `X-PAYMENT` headers to settled targets.

## **Phase 5: UI & Containerized Deployment (Priority: Low / Stretch Goal) — [COMPLETE]**

**Goal:** Deliver clear system optics for the judging panel.

* **[COMPLETE] Task 5.1 (The Silver-Blue Dashboard View):** Spin up an HTTP service using `Bun.serve()`. Deliver a single static HTML page utilizing vanilla CSS, responsive heights (perfect viewport fit), distinct columns for average score and total score, registry tooltips on hover, and an interactive developer copy proof drawer.
* **[COMPLETE] Task 5.2 (Simulated Activity Feed):** Integrate Server-Sent Events (SSE) to stream live discovery, payment routing, reputation recalculations, and slash actions to the dashboard.
* **[COMPLETE] Task 5.3 (Walrus Backup Worker):** Dump SQLite records to a flat `state_snapshot.json` and upload to the Walrus Protocol publisher API.

---

## **Phase 6: Production Deployment Roadmap (Prioritized by Impact/Value)**

**Goal:** Transition the reputation engine from a local mock setup to a highly secure, reliable, and production-ready cloud deployment.

* **[COMPLETE] Task 6.1 (High Impact - Security): KMS Key Management & Privy Credentials**
  Securely store Privy App IDs, Secrets, and the Agent's EVM private keys using AWS KMS, GCP Secret Manager, or HashiCorp Vault instead of local `.env` files (Implemented via `kms-signer.ts`).
* **[COMPLETE] Task 6.2 (High Impact - Decentralization): Chainlink Functions DON Integration**
  Deploy and configure the Chainlink Functions decentralized oracle network script. Point the contract `andre8004.sol` to fetch roots programmatically from the edge cached server URL rather than manually invoking `manualUpdateRoot` (Implemented via `request-update.ts` and `functions-source.js`).
* **[COMPLETE] Task 6.3 (Medium Impact - Reliability): Supervisor Background Event Listener**
  Wrap `arc-streamer.ts` and `server.ts` in a Docker container using Docker Compose with shared SQLite volumes and automated RPC failure reconnect retry loops.
* **[TODO] Task 6.4 (Medium Impact - Performance): High-Availability Edge Cache Proof API**
  Deploy the Bun server `server.ts` on Vercel or AWS, placing the proof routes (`/agents/:address/proof`) behind a Cloudflare CDN cache to ensure sub-10ms global proof retrieval.
* **[TODO] Task 6.5 (Low Impact - Scalability): Cache Database Migration**
  Migrate the local SQLite analytical DB to AWS RDS Postgres or a Supabase cluster. *Note: SQLite handles local reads/writes in WAL mode in sub-milliseconds and is sufficient for single-instance setups, so this is prioritized lowest.*
* **[COMPLETE] Task 6.6 (High Impact - Testing Flow): On-Chain Root Committer Script**
  Write a script `commit-root.ts` that queries the current Merkle root from the database cache and updates the deployed `andre8004.sol` contract directly on-chain using the owner's deployer wallet. This bridges the Merkle factory to the live contract for instant testing before Chainlink Functions setup is completed.