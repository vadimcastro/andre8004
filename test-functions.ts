import { readFileSync } from "fs";
import { join } from "path";

const SOURCE_PATH = join(import.meta.dir, "functions-source.js");

async function runDONSimulation() {
  console.log("=== Starting Chainlink Functions DON Simulation ===");

  // 1. Mock the injected Functions sandbox object
  const mockFunctions = {
    makeHttpRequest: async (config: { url: string; method: string; timeout?: number }) => {
      console.log(`[DON Sandbox] Querying API endpoint: ${config.url}`);
      try {
        const res = await fetch(config.url);
        if (!res.ok) {
          return { error: `HTTP status error: ${res.status}`, message: res.statusText };
        }
        const data = await res.json();
        return { error: null, data };
      } catch (err: any) {
        return { error: `Connection failed: ${err.message}` };
      }
    }
  };

  const args = ["http://localhost:3000/epoch-root"];
  console.log(`Injected args: ${JSON.stringify(args)}`);

  // 2. Read source code
  let sourceCode = "";
  try {
    sourceCode = readFileSync(SOURCE_PATH, "utf-8");
  } catch (e) {
    console.error(`Error: Could not read Functions source code at ${SOURCE_PATH}`);
    process.exit(1);
  }

  // 3. Compile and execute inside sandbox
  console.log("\nExecuting JS script block inside mock sandbox environment...");
  
  // Wrap the script in an async function context with injected parameters
  const sandboxRunner = new Function("Functions", "args", `
    return (async () => {
      ${sourceCode}
    })();
  `);

  try {
    const result = await sandboxRunner(mockFunctions, args);
    
    if (!(result instanceof Uint8Array) || result.length !== 32) {
      throw new Error(`Expected script to return a 32-byte Uint8Array, but got: ${result}`);
    }

    const hexRoot = "0x" + Array.from(result)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");

    console.log("\n✅ DON Consensus Update Simulation: SUCCESS");
    console.log(`  - Decoded bytes32 response: ${hexRoot}`);
  } catch (error: any) {
    console.error("\n❌ DON Sandbox Execution: FAILED");
    console.error(`  - Error: ${error.message}`);
    console.log("\n💡 Note: Make sure your Bun server is running in the background (`bun server.ts`) so the endpoint can be queried!");
  }
}

runDONSimulation().catch(console.error);
