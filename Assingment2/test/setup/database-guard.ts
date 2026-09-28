// ============================================================================
// [X3] CHALLENGE REQUIREMENT: Test Database Safety Guard
// WHY: The guard costs ten lines and prevents the one mistake that cannot be undone:
// running tests against a production or development database and wiping real data.
// ============================================================================

/**
 * Validates that the targeted database is strictly an isolated test database.
 * If the database name matches development ('assignment1', 'development') or does not end with '_test',
 * it throws a fatal Error to abort the test suite immediately.
 * 
 * @param databaseName - Name of the database to check
 */
export function assertTestDatabase(databaseName: string | undefined): void {
  if (!databaseName) {
    throw new Error(
      "[FATAL DATABASE SAFETY GUARD] DB_NAME is undefined! " +
      "The test suite refuses to start without an explicitly configured test database."
    );
  }

  const normalized = databaseName.trim().toLowerCase();

  // Forbidden databases: production, development, default postgres, etc.
  const forbiddenNames = ["assignment1", "assignment2", "assignment3", "development", "postgres", "production"];

  if (forbiddenNames.includes(normalized) || !normalized.endsWith("_test")) {
    throw new Error(
      `[FATAL DATABASE SAFETY GUARD] Refusing to run tests against database '${databaseName}'! ` +
      `Integration tests can only run against a dedicated test database whose name ends with '_test' ` +
      `(e.g., 'assignment1_test'). Development database '${databaseName}' is protected and will not be touched.`
    );
  }
}
