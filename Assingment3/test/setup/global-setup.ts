// ============================================================================
// [W1] WARM-UP REQUIREMENT: Global Test Setup & Migration Execution
// WHY: A suite that writes into your development database will eventually destroy data
// you wanted. The test database is also the only way the suite can reset itself freely.
// HINT: Load a .env.test (or set variables in test script) and run migration:run in
// the global setup, so the schema is built the same way it is built in production.
//
// [X3] CHALLENGE REQUIREMENT: Refuses to start if pointed at non-test database.
// ============================================================================
import { config } from "dotenv";
import { resolve } from "path";
import { assertTestDatabase } from "./database-guard.js";
import AppDataSource from "../../src/data-source.js";

export async function setup(): Promise<void> {
  // [W1] Load dedicated .env.test for test suite configuration (fallback to .env.test.example if missing)
  config({ path: resolve(process.cwd(), ".env.test") });
  if (!process.env.DB_NAME) {
    config({ path: resolve(process.cwd(), ".env.test.example") });
  }

  const targetDbName = process.env.DB_NAME;
  console.log(`\n======================================================`);
  console.log(`[W1] Initializing Test Suite with Database: ${targetDbName}`);
  console.log(`======================================================\n`);

  // [X3] Abort if test environment is pointed at development or non-test database
  assertTestDatabase(targetDbName);

  // [W1] Run migrations before the test suite starts
  console.log(`[W1] Running migrations on test database '${targetDbName}'...`);
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }

  // Execute all pending migrations
  const migrations = await AppDataSource.runMigrations();
  console.log(`[W1] Migrations completed. Total executed: ${migrations.length}`);

  // Disconnect so each test process can manage its own connection pool
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
  }
}

export async function teardown(): Promise<void> {
  console.log(`\n[W1] Test Suite finished. Development database remains completely untouched.\n`);
}
