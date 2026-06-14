// Chainlink Functions JavaScript Execution Script
// This script runs on the decentralized oracle network (DON) nodes.
// It queries the Bun API server, extracts the active Merkle state root,
// and returns it as a 32-byte Uint8Array matching Solidity's bytes32.

const url = args[0] || "http://localhost:3000/epoch-root";

// Make the HTTP request using Chainlink Functions sandbox global API
const response = await Functions.makeHttpRequest({
  url: url,
  method: "GET",
  timeout: 5000
});

if (response.error) {
  throw new Error(`HttpRequest failed: ${response.error}`);
}

const data = response.data;
if (!data.success || !data.root) {
  throw new Error("Invalid response schema from epoch root API");
}

const rootHex = data.root.startsWith("0x") ? data.root.slice(2) : data.root;
if (rootHex.length !== 64) {
  throw new Error("Invalid Merkle root format (must be 32 bytes hex)");
}

// Convert the hex string into a Uint8Array (32 bytes)
const rootBytes = new Uint8Array(32);
for (let i = 0; i < 32; i++) {
  rootBytes[i] = parseInt(rootHex.substring(i * 2, i * 2 + 2), 16);
}

// Return the raw 32-byte array to the DON coordinator to submit on-chain
return rootBytes;
