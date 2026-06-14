import { Database } from "bun:sqlite";
import { join } from "path";

const DB_FILE = process.env.DATABASE_FILE || join(import.meta.dir, "andre8004_cache.db");

async function main() {
  console.log("=== Database Bootstrap Verification ===");
  console.log(`Checking SQLite target path: ${DB_FILE}`);

  let needsBootstrap = false;
  try {
    const db = new Database(DB_FILE);
    const result = db.query("SELECT COUNT(*) as count FROM raw_feedbacks;").get() as { count: number } | null;
    if (!result || result.count === 0) {
      needsBootstrap = true;
      console.log("Database raw_feedbacks table is empty.");
    } else {
      console.log(`Database already seeded with ${result.count} feedback records.`);
    }
    db.close();
  } catch (error) {
    console.log("Database tables do not exist yet. Needs full initialization.");
    needsBootstrap = true;
  }

  if (needsBootstrap) {
    console.log("\nInitializing database schema, seeding datasets, and calculating reputations...");
    
    // 1. Run seed.ts
    console.log("\n[Bootstrap Step 1/3] Running bun seed.ts...");
    const seedProc = Bun.spawnSync(["bun", "seed.ts"], {
      env: process.env
    });
    console.log(seedProc.stdout.toString());
    if (seedProc.exitCode !== 0) {
      console.error("❌ Seed failed:", seedProc.stderr.toString());
      process.exit(1);
    }

    // 2. Run sync.ts
    console.log("\n[Bootstrap Step 2/3] Running bun sync.ts...");
    const syncProc = Bun.spawnSync(["bun", "sync.ts"], {
      env: process.env
    });
    console.log(syncProc.stdout.toString());
    if (syncProc.exitCode !== 0) {
      console.error("❌ Sync failed:", syncProc.stderr.toString());
      process.exit(1);
    }

    // 3. Run merkle.ts
    console.log("\n[Bootstrap Step 3/3] Running bun merkle.ts...");
    const merkleProc = Bun.spawnSync(["bun", "merkle.ts"], {
      env: process.env
    });
    console.log(merkleProc.stdout.toString());
    if (merkleProc.exitCode !== 0) {
      console.error("❌ Merkle generation failed:", merkleProc.stderr.toString());
      process.exit(1);
    }

    console.log("\n✅ Database bootstrap completed successfully!");
  } else {
    console.log("✅ Database state validated. No bootstrap required.");
  }
}

main().catch(console.error);
