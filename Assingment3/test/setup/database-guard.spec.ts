// ============================================================================
// [X3] CHALLENGE REQUIREMENT: Test proving suite refuses to start against non-test DB
// WHY: Ensures the safety guard reliably detects and blocks execution against development DBs.
// CHECK: Pointing the test environment at the development database makes the suite refuse to start,
// with a message that says why.
// ============================================================================
import { describe, expect, it } from "vitest";
import { assertTestDatabase } from "./database-guard.js";

describe("[X3] Database Safety Guard", () => {
  it("should permit execution when pointed at a valid test database ending with _test", () => {
    // Should NOT throw for legitimate test databases
    expect(() => assertTestDatabase("assignment3_test")).not.toThrow();
    expect(() => assertTestDatabase("assignment1_test")).not.toThrow();
    expect(() => assertTestDatabase("myapp_test")).not.toThrow();
  });

  it("should abort with a clear error message when pointed at the development database 'assignment3'", () => {
    // CHECK: Pointing at development database throws descriptive guard error
    expect(() => assertTestDatabase("assignment3")).toThrowError(
      /Refusing to run tests against database 'assignment3'/
    );
  });

  it("should abort when DB_NAME is undefined or empty", () => {
    expect(() => assertTestDatabase(undefined)).toThrowError(
      /DB_NAME is undefined/
    );
    expect(() => assertTestDatabase("")).toThrowError(
      /DB_NAME is undefined/
    );
  });

  it("should abort when pointed at standard production or system databases", () => {
    expect(() => assertTestDatabase("production")).toThrowError(/Refusing to run tests/);
    expect(() => assertTestDatabase("postgres")).toThrowError(/Refusing to run tests/);
    expect(() => assertTestDatabase("development")).toThrowError(/Refusing to run tests/);
  });
});
