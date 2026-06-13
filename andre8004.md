# andre8004: Master Implementation Plan

**Team Philosophy:** *First Principles. Iterative & Auditable. Efficient.* We build from the ground up, ensuring every component is mathematically sound and verifiable. We will iterate quickly through local caching before trusting on-chain state, keeping the codebase lean, serverless where possible, and hyper-optimized for the hackathon window.

---

## **Architecture Flow**

```text
[Phase 0: 8004scan One-Time Seed] ──► [Google BigQuery] (Eth/Sepolia) ──┐
                                                                        ├──► [Unified Cross-Chain SQL] ──► [Bun SQLite Local Cache]
                          [Circle Arc Node RPC] ──► [Bun ETL Worker] ───┘                                        │
                                                                                                                 ├─► [Local Mempool Filter]
          [ENS Subnames / Text Records] ─────────────────────────────────────────────────────────────────────────► [andre8004 Core Engine]
                                                                                                                 │ (Generates Epoch Merkle Proof)
                                                                                                                 ▼
[Privy Autonomous Wallet] ◄──(Consults Oracle)──► [AndreOracle Contract] ◄───────────────────────────────────────┘
            │
            └──(Direct HTTP 402 Payment via ERC-3009)──► [Target AI Agent]

```

## **Phase 0: Live Mainnet Ingestion (Priority: High)**

**Goal:** Populate BigQuery with real ERC-8004 reputation data using the 8004scan indexer to simulate an active agentic economy.

* **Task 0.1 (8004scan Subgraph ETL):** Write an `8004scan-etl.ts` script in Bun. Query the public 8004scan Subgraph (via `graphql-request`) or their native REST API to extract a one-time seed of real agent identity cards and `NewFeedback` events, focusing on the `agentId` and `score` parameters. Format the extracted stream into newline-delimited JSON (`.jsonl`).
* **Task 0.2 (BigQuery Pipeline Integration):** Upload the generated `.jsonl` files to a Google Cloud Storage bucket and configure a BigQuery Data Transfer Service job to pull this into our native public tables. Vadim, your experience analyzing massive student transportation reliability datasets and mapping out vendor performance logs will make structuring these agent feedback tables second nature.

## **Phase 1: The Multi-Chain Data & Ingestion Engine (Priority: High)**

**Goal:** Build the data tier that merges native Google BigQuery datasets with live custom L1 logs.

* **Task 1.1 (Arc L1 ETL Stream):** Write `arc-streamer.ts` in Bun. Poll the Circle Arc L1 RPC endpoint, extract raw transaction logs, format them into `.jsonl`, and batch upload them into GCS.
* **Task 1.2 (Unified BigQuery Pipeline):** Write a consolidated SQL script in BigQuery that executes a `UNION ALL` across Google's native Ethereum/Sepolia public tables and our custom Arc L1 log tables.
* **Task 1.3 (Algorithmic Ranking & TWMA):** Implement a Time-Weighted Moving Average (TWMA) calculation where transactions from the last 48 hours dictate 80% of the agent's score. Program a Sybil-slashing modifier that penalizes wallets interacting primarily with a closed, insular group of addresses.
* **Task 1.4 (Optimized Local Cache Worker):** Create `sync.ts` using `bun:sqlite` to run this BigQuery pipeline hourly, downloading the calculated records into a fast-read local database (`andre8004_cache.db`). Implement a local mempool that monitors for real-time slashing events and optimistically drops bad actors from the local routing queue between hourly batch updates.

## **Phase 2: Naming Resolution & Merkle Proof Factory (Priority: High)**

**Goal:** Cross-verify metadata declarations and compile trustless, off-chain state roots.

* **Task 2.1 (Batched ENS Cross-Verification):** Build a processing pass that queries the ENS registry for each cached agent address. Utilize `Promise.allSettled` to batch requests and prevent RPC rate-limiting. Extract and verify that their listed text records explicitly declare `x402=true`, point to valid API endpoints, and resolve to the correct CAIP-10 address format.
* **Task 2.2 (Temporal Cryptographic Engine):** Write `merkle.ts` using `merkletreejs`. Hash each database row using deterministic, epoch-aware Solidity-tight packaging to prevent replay attacks: $keccak256(abi.encodePacked(epoch\_id, agent\_address, reputation\_score, x402\_capable))$.
* **Task 2.3 (Root Exposer):** Compile the Merkle Tree, export individual transaction verification paths into a local JSON folder, and isolate the single 32-byte Merkle Root string.

## **Phase 3: The Verification Oracle Contract (Priority: High)**

**Goal:** Deploy the core on-chain validation primitive using Foundry.

* **Task 3.1 (Solidity Architecture):** Initialize a Foundry workspace and write `AndreOracle.sol`. Expose an owner-restricted function `updateRegistryRoot(bytes32 newRoot, uint256 epochId)` to receive the Merkle root generated by the Bun pipeline.
* **Task 3.2 (The Verification Method):** Implement `verifyAgent(uint256 epochId, address targetAgent, uint256 score, bool x402Capable, bytes32[] calldata proof)`. The contract ensures the `epochId` is current, verifies the telemetry data using `MerkleProof.verify()`, enforces reputation thresholds, and returns a boolean validation state. **It does not escrow funds.**
* **Task 3.3 (Fuzz Testing):** Author a robust suite of property-based fuzz tests in Foundry (`forge test`) to confirm that modified scores, forged proofs, or outdated epochs are blocked instantly.

## **Phase 4: Privy Integration & x402 Execution Loop (Priority: Medium)**

**Goal:** Harness automated agent wallets to run production loops leveraging the oracle and HTTP payments.

* **Task 4.1 (Privy Agent Setup):** Configure a server-managed, programmatically controlled wallet environment using `@privy-io/server-auth`.
* **Task 4.2 (Oracle Consultation):** Program the client agent to request a task. The Bun backend queries the SQLite database, isolates the highest-rated compatible peer, extracts its Merkle proof, and successfully queries `AndreOracle.verifyAgent()` to guarantee state.
* **Task 4.3 (P2P x402 Settlement):** Upon successful oracle verification, the Privy agent makes a direct HTTP request to the target agent. The target responds with an `HTTP 402 Payment Required`. The Privy agent signs the ERC-3009 payload, completes the transaction peer-to-peer via the `X-PAYMENT` header, and finalizes the job.

## **Phase 5: UI & Containerized Deployment (Priority: Low / Stretch Goal)**

**Goal:** Deliver clear system optics for the judging panel.

* **Task 5.1 (The Hybrid Dashboard View):** Spin up a simple HTTP service using Bun's native `Bun.serve()`. Deliver a single static HTML page utilizing Tailwind CSS via CDN. Display a clean leaderboard chart showing the top 5 agents sorted by `andre8004` score along with real-time status updates of active Privy routing transactions.
* **Task 5.2 (Dockerized Environment):** Wrap the UI and backend worker in a `docker-compose.yml` file to ensure the entire stack—including the SQLite cache and Bun runtime—spins up flawlessly and consistently for the live demo.
* **Task 5.3 (Walrus Backup Worker):** Write `walrus-backup.ts`. Every 24 hours, dump the SQLite data rows into a single flat `state_snapshot.json` file and publish it to the Walrus Protocol.