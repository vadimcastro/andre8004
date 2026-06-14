# andre8004: Master Implementation Plan

**Team Philosophy:** *First Principles. Iterative & Auditable. Efficient.* We build from the ground up, ensuring every component is mathematically sound and verifiable. We will iterate quickly through local caching before trusting on-chain state, keeping the codebase lean, serverless where possible, and hyper-optimized for the hackathon window.

---

## **Architecture Flow**

```text
[Phase 0: 8004scan Ingestion (Normalized Score)] ──► [Google BigQuery] (Eth/Sepolia) ──┐
                                                                                       ├──► [Unified CAIP-10 SQL Layer] ──► [Bun SQLite Local Cache]
                             [Circle Arc RPC] ──► [Bun ETL Block-Pointer Streamer] ────┘                                        │
                                                                                                                                ├─► [WS Slashing Mempool Listener]
             [ENS Reverse -> Primary Name -> Text Records] ─────────────────────────────────────────────────────────────────────► [andre8004 Core Engine]
                                                                                                                                │ (Generates Epoch Merkle Proof)
                                                                                                                                ▼
[Privy Autonomous Wallet] ◄──(Consults Oracle)──► [AndreOracle Contract (Multi-Epoch)] ◄───────────────────────────────────────┘
            │
            └──(Direct HTTP 402 Payment: ERC-3009 Signed Tx)──► [Target AI Agent (Executes & Pays Gas)]
```

## **Phase 0: Live Mainnet Ingestion (Priority: High)**

**Goal:** Populate BigQuery with real ERC-8004 reputation data using the 8004scan indexer to simulate an active agentic economy.

* **Task 0.1 (8004scan Subgraph ETL):** Write an `8004scan-etl.ts` script in Bun. Query the public 8004scan Subgraph (via `graphql-request`) or their native REST API to extract a one-time seed of real agent identity cards and `NewFeedback` events. Extract `agentId`, `value` (`int128`), and `valueDecimals` (`uint8`) fields. Compute the normalized reputation score ($value \times 10^{-valueDecimals}$) and format the extracted stream into newline-delimited JSON (`.jsonl`).
* **Task 0.2 (BigQuery Pipeline Integration):** Upload the generated `.jsonl` files to a Google Cloud Storage bucket. Use the `@google-cloud/bigquery` library or `bq load` command-line tool to load this data directly into our native public tables, bypassing the unnecessary setup overhead of BigQuery Data Transfer Service.

## **Phase 1: The Multi-Chain Data & Ingestion Engine (Priority: High)**

**Goal:** Build the data tier that merges native Google BigQuery datasets with live custom L1 logs.

* **Task 1.1 (Arc L1 ETL Stream):** Write `arc-streamer.ts` in Bun. Poll the Circle Arc L1 RPC endpoint, extract raw transaction logs, format them into `.jsonl`, and batch upload them into GCS. Track progress using a local database/file block-pointer (`sync_state`) to prevent duplicate indexing or data gaps upon service restarts.
* **Task 1.2 (Unified BigQuery Pipeline):** Write a consolidated SQL script in BigQuery that executes a `UNION ALL` across Google's native Ethereum/Sepolia public tables and our custom Arc L1 log tables. To prevent cross-chain ID collisions, map all agents to a Globally Unique Identifier (GUID) following the CAIP-10 standard (`eip155:<chain_id>:<contract_address>:<agent_id>`).
* **Task 1.3 (Algorithmic Ranking & TWMA):** Implement a Time-Weighted Moving Average (TWMA) calculation. The weight decay is formulated exponentially as $w(t) = e^{-\lambda \cdot t}$, where the decay constant $\lambda$ is set such that interactions from the last 48 hours dictate 80% of the agent's total score. Program a Sybil-slashing modifier using a Concentrated Co-interaction Index (CCI) that penalizes agents receiving feedback primarily from an insular, closed clique of clients.
* **Task 1.4 (Optimized Local Cache Worker):** Create `sync.ts` using `bun:sqlite` to run this BigQuery pipeline hourly, downloading the calculated records into a fast-read local database (`andre8004_cache.db`). Connect to a persistent WebSocket provider to listen for real-time slashing events, allowing the local mempool to optimistically drop bad actors between hourly batch updates.

## **Phase 2: Naming Resolution & Merkle Proof Factory (Priority: High)**

**Goal:** Cross-verify metadata declarations and compile trustless, off-chain state roots.

* **Task 2.1 (Batched ENS Cross-Verification):** Build a processing pass that queries the ENS registry. First, perform reverse resolution on the agent's address to determine their primary ENS name. Then, resolve the text records for that name, verifying they declare `x402=true`, point to valid API endpoints, and resolve to the correct CAIP-10 address format. Use a batched `multicall` query (via `viem`) and cache results in SQLite with a 24-hour TTL to bypass RPC rate limits.
* **Task 2.2 (Temporal Cryptographic Engine):** Write `merkle.ts`. Hash each database row deterministically using `viem` or `ethers` to tightly pack parameters matching Solidity: `keccak256(abi.encodePacked(epochId, agentGUID, reputationScore, x402Capable))`. Construct the tree using `merkletreejs` with `sortPairs: true` to align with OpenZeppelin's on-chain verification sorting.
* **Task 2.3 (Root Exposer):** Compile the Merkle Tree, export the Merkle Root, and serve individual proofs via a lightweight backend HTTP endpoint (`/agents/:address/proof`) in Bun for client consumption.

## **Phase 3: The Verification Oracle Contract (Priority: High)**

**Goal:** Deploy the core on-chain validation primitive using Foundry.

* **Task 3.1 (Solidity Architecture):** Initialize a Foundry workspace and write `AndreOracle.sol`. Expose an owner-restricted function `updateRegistryRoot(bytes32 newRoot, uint256 epochId)` to store the Merkle root for a given epoch. Store root history in a mapping (`epochId => root`) to allow verification within a sliding window of recent epochs, avoiding transaction race conditions during updates.
* **Task 3.2 (The Verification Method):** Implement `verifyAgent(uint256 epochId, string calldata agentGUID, int256 score, bool x402Capable, bytes32[] calldata proof)`. The method validates the proof against the historical root matching `epochId`, ensures the epoch is not expired, uses signed integers (`int256`) to handle negative feedback, and returns validation status without escrowing funds.
* **Task 3.3 (Fuzz Testing):** Author a robust suite of property-based fuzz tests in Foundry (`forge test`) validating epoch limits, signature/proof tampering, signed score boundaries, and correct revert paths.

## **Phase 4: Privy Integration & x402 Execution Loop (Priority: Medium)**

**Goal:** Harness automated agent wallets to run production loops leveraging the oracle and HTTP payments.

* **Task 4.1 (Privy Agent Setup):** Configure a server-managed, programmatically controlled wallet environment using `@privy-io/server-auth`.
* **Task 4.2 (Oracle Consultation):** Program the client agent to request a task. The client fetches the target agent's data and Merkle proof from the Bun endpoint, and queries the `AndreOracle` on-chain (using a read-only view call) to guarantee reputation state.
* **Task 4.3 (P2P x402 Settlement):** Implement the ERC-3009 payment lifecycle:
  1. Privy client agent signs a `ReceiveWithAuthorization` payload off-chain.
  2. Privy agent sends the signed payload to the target agent via the `X-PAYMENT` header.
  3. The target agent submits the transaction to the USDC contract on-chain, paying the gas to finalize payment settlement.
  4. The target agent processes the task and returns the result.

## **Phase 5: UI & Containerized Deployment (Priority: Low / Stretch Goal)**

**Goal:** Deliver clear system optics for the judging panel.

* **Task 5.1 (The Hybrid Dashboard View):** Spin up an HTTP service using `Bun.serve()`. Deliver a single static HTML page utilizing Tailwind CSS via CDN. Integrate Server-Sent Events (SSE) to stream live mempool updates and Privy routing transactions to the dashboard.
* **Task 5.2 (Dockerized Environment):** Wrap the UI and backend worker in a `docker-compose.yml` file to ensure the entire stack—including the SQLite cache and Bun runtime—spins up flawlessly and consistently for the live demo.
* **Task 5.3 (Walrus Backup Worker):** Write `walrus-backup.ts`. Dump SQLite records every 24 hours to a flat `state_snapshot.json` and upload it directly to the Walrus Protocol publisher HTTP API.