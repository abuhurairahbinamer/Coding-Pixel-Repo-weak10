// ============================================================================
// [W2] WARM-UP REQUIREMENT: Reset table data between tests
// WHY: When one test's rows survive into the next, the suite passes in one order
// and fails in another. That is the definition of a flaky suite.
// HINT: Truncate the tables in an afterEach, and seed inside the test that needs rows.
// CHECK: A test that creates rows does not change the counts another test sees,
// and running the whole suite twice in a row gives the same result.
// ============================================================================
import { DataSource } from "typeorm";
import { assertTestDatabase } from "./database-guard.js";

/**
 * Truncates all domain tables and resets identity counters in the test database.
 * Preserves the migrations table so the schema remains intact.
 * 
 * @param dataSource - TypeORM DataSource instance
 */
export async function resetDatabase(dataSource: DataSource): Promise<void> {
  if (!dataSource.isInitialized) {
    return;
  }

  // Double check that we are operating only on the test database
  const currentDb = (dataSource.options as any).database;
  assertTestDatabase(currentDb);

  // Truncate tables with CASCADE and RESTART IDENTITY to wipe data and reset autoincrement IDs
  await dataSource.query(`
    TRUNCATE TABLE 
      "refresh_tokens",
      "comments",
      "task_tags",
      "tasks",
      "project_members",
      "projects",
      "tags",
      "users"
    RESTART IDENTITY CASCADE;
  `);
}

/**
 * Counts total rows across all domain tables.
 * Used to verify complete isolation and zero leftover rows.
 */
export async function getTotalRowCount(dataSource: DataSource): Promise<number> {
  const result = await dataSource.query(`
    SELECT (
      (SELECT COUNT(*) FROM "users") +
      (SELECT COUNT(*) FROM "projects") +
      (SELECT COUNT(*) FROM "project_members") +
      (SELECT COUNT(*) FROM "tasks") +
      (SELECT COUNT(*) FROM "comments") +
      (SELECT COUNT(*) FROM "tags") +
      (SELECT COUNT(*) FROM "refresh_tokens")
    )::integer AS total_count;
  `);

  return Number(result[0]?.total_count ?? 0);
}
