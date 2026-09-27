# Week 10 Assignment 1: Integration Tests with Supertest

CMIT Internship Program · Delivered by Coding Pixel  
**Week 10: Testing and Hardening — Assignment 1 Deliverable**

---

## 📋 Table of Contents

- [Overview](#overview)
- [Requirements & Problem Breakdown](#requirements--problem-breakdown)
  - [Warm-up Requirements (W1–W2)](#warm-up-requirements-w1w2)
  - [Core Requirements (C1–C4)](#core-requirements-c1c4)
  - [Challenge Requirements (X1–X3)](#challenge-requirements-x1x3)
- [Architecture & Design Decisions](#architecture--design-decisions)
  - [Separate Test Database & Migration Automation](#separate-test-database--migration-automation)
  - [Deterministic Data Reset Between Tests](#deterministic-data-reset-between-tests)
  - [True HTTP Surface Testing vs. Service Class Testing](#true-http-surface-testing-vs-service-class-testing)
  - [Test Independence & Shared Test Factories](#test-independence--shared-test-factories)
  - [Security Guard Against Non-Test Database Destruction](#security-guard-against-non-test-database-destruction)
- [Test Suite Summary & Execution](#test-suite-summary--execution)
- [Verification Checks & Evidence](#verification-checks--evidence)

---

## 🌟 Overview

The goal of Week 10 Assignment 1 is to prove the Task Management API at its **true HTTP surface** using **Supertest**, backed by a dedicated, isolated test database (`assignment1_test`), with complete test independence and zero reliance on residual database state.

### Key Deliverables:
1. **Isolated Test Database Configuration (`.env.test`)**: Configured with a dedicated test database (`assignment1_test`).
2. **Automated Migration Runner (`test/setup/global-setup.ts`)**: Runs all TypeORM migrations before the suite starts so the test schema is built identically to production.
3. **Deterministic State Reset (`test/setup/test-database.ts`)**: Truncates all domain tables with `RESTART IDENTITY CASCADE` in an `afterEach` hook to guarantee a clean slate for every test.
4. **Shared Test Factories (`test/helpers/test-factories.ts`)**: Modular helper functions creating isolated users, logging in to obtain tokens, and provisioning projects, tasks, and comments without shared state.
5. **Supertest Integration Test Suite (`test/assignment1-integration.e2e-spec.ts`)**:
   - `[W1]` Verifies connection to the test database and migrated tables.
   - `[W2]` Proves that data is cleared between tests and repeated runs yield identical results.
   - `[C1]` Creates a resource via `POST` and reads it back via `GET`, asserting status codes and body fields.
   - `[C2]` Tests `401 Unauthorized` (write without token) and `400 Bad Request` (invalid body rejected by DTO).
   - `[C3]` Tests `404 Not Found` for non-existent IDs across `GET`, `PATCH`, and `DELETE`.
   - `[C4]` Demonstrates complete test independence and passes under shuffled execution (`npm run test:shuffled`).
   - `[X1]` Tests combinable filters (`?status=todo&projectId=1`) excluding deliberately seeded near-miss rows.
   - `[X2]` Proves that undeclared fields are rejected over HTTP (`forbidNonWhitelisted: true`) with `400 Bad Request`.
   - `[X3]` Database safety guard prevents tests from running against non-test databases (`assignment1`, `development`, `production`).

---

## 🔍 Requirements & Problem Breakdown

### Warm-up Requirements (W1–W2)

#### `[W1]` Configure a Separate Test Database & Run Migrations Before the Suite Starts
- **Why**: Writing into the development database destroys data you wanted. A separate test database allows the test suite to reset itself freely.
- **Implementation**:
  - Created `.env.test` pointing to `DB_NAME=assignment1_test`.
  - Configured `test/setup/global-setup.ts` to run TypeORM migrations via `AppDataSource.runMigrations()` before tests commence.
- **Check**: Development database `assignment1` remains untouched; test database `assignment1_test` contains all migrated tables (`migrations`, `users`, `projects`, `project_members`, `tasks`, `tags`, `task_tags`, `comments`, `refresh_tokens`).

#### `[W2]` Reset Data Between Tests for a Known Starting State
- **Why**: When rows survive across tests, test order causes flaky failures.
- **Implementation**:
  - Implemented `resetDatabase(dataSource)` in `test/setup/test-database.ts` executing `TRUNCATE TABLE ... RESTART IDENTITY CASCADE`.
  - Wired into `afterEach` in `test/assignment1-integration.e2e-spec.ts`.
- **Check**: A test creating rows does not alter row counts seen by subsequent tests. Running the whole suite twice in a row gives identical results.

---

### Core Requirements (C1–C4)

#### `[C1]` Write First Integration Test Through HTTP: Create Resource and Read It Back
- **Why**: Real clients talk to the HTTP surface, traversing pipes, guards, serialization, and status codes.
- **Implementation**:
  - Booted real application using `Test.createTestingModule({ imports: [AppModule] })`.
  - Applied the exact `ValidationPipe` and `AllExceptionsFilter` used in `main.ts`.
  - Tested `POST /projects` (asserts `201 Created` and returned fields), followed by `GET /projects/:id` (asserts `200 OK` and identical fields).
  - Tested `POST /tasks` (asserts `201 Created` and task fields), followed by `GET /tasks/:id` (asserts `200 OK`).

#### `[C2]` Cover 400 and 401 Paths: Invalid Body and Write Without Token
- **Why**: Regressions frequently hide in error paths.
- **Implementation**:
  - **401 Path**: `POST /projects` without an `Authorization` header returns `401 Unauthorized` with the standard 5-field error shape (`statusCode`, `message`, `error`, `timestamp`, `path`).
  - **400 Path**: `POST /tasks` with invalid payload (missing required title and `priority: 99` violating `@Min(1) @Max(5)`) returns `400 Bad Request` with the standard error shape.

#### `[C3]` Cover 404 for Non-Existent Resources on Read, Update, Delete
- **Why**: Missing entities must return `404 Not Found`, not `500 Internal Server Error` or a silent `200` with an empty body.
- **Implementation**:
  - Formatted valid ID `99999` absent from the database.
  - `GET /tasks/99999` returns `404 Not Found` with `{ statusCode: 404, message, error: "Not Found", timestamp, path }`.
  - `PATCH /tasks/99999` with valid token returns `404 Not Found` with the same error shape.
  - `DELETE /tasks/99999` with valid token returns `404 Not Found` with the same error shape.

#### `[C4]` Make Every Test Independent via Shared Factories
- **Why**: Test independence allows running any single test in isolation and trusting what it tells you.
- **Implementation**:
  - Created shared factories in `test/helpers/test-factories.ts`:
    - `createAndLoginUser(app, overrides)`
    - `createTestProject(app, token, overrides)`
    - `createTestTask(app, token, projectId, overrides)`
    - `createTestComment(app, token, taskId, overrides)`
  - No rows are created at the module level.
- **Check**: Running any single test on its own passes (`vitest run -t "[C1]"`), and running the suite in shuffled order passes (`npm run test:shuffled`).

---

### Challenge Requirements (X1–X3)

#### `[X1]` Test Combinable Filters Through Real Requests with Near-Miss Exclusion
- **Why**: Filter combination logic (`qb.andWhere`) is prone to subtle regressions (e.g. broken `AND` or accidental `OR`).
- **Implementation**:
  - Seeded two projects and four distinct tasks:
    1. **Target Task**: Project 1, status = `todo` (Matches BOTH).
    2. **Near-Miss 1**: Project 1, status = `in_progress` (Matches project, NOT status).
    3. **Near-Miss 2**: Project 2, status = `todo` (Matches status, NOT project).
    4. **Near-Miss 3**: Project 2, status = `done` (Matches neither).
  - Queried `GET /tasks?status=todo&projectId=:project1Id`.
- **Check**: Exactly 1 task returned (the target task). All three near-miss tasks are excluded.

#### `[X2]` Prove Over HTTP That Unknown Fields Are Rejected (`forbidNonWhitelisted`)
- **Why**: `forbidNonWhitelisted` is a critical defense against mass assignment and parameter injection.
- **Implementation**:
  - Sent `POST /tasks` with valid required fields plus unauthorized properties: `{ role: 'admin', isAdmin: true, hackPayload: 'malicious' }`.
- **Check**: Returned `400 Bad Request` with validation error stating that extra properties should not exist. Database query confirms no task was created.

#### `[X3]` Make It Impossible for the Suite to Run Against a Non-Test Database
- **Why**: Prevents catastrophic loss of development or production data.
- **Implementation**:
  - Implemented `assertTestDatabase(dbName)` in `test/setup/database-guard.ts`.
  - Aborts execution immediately with a clear error if `DB_NAME` is missing, equals `assignment1`, `development`, `postgres`, or does not end with `_test`.
- **Check**: Tested via `test/setup/database-guard.spec.ts` verifying that pointing to `assignment1` or `development` throws a fatal guard error.

---

## 🛠 Available Test Scripts

```bash
# Run the complete integration test suite with Supertest
npm test

# Run tests in randomized/shuffled order (proving test independence - C4)
npm run test:shuffled

# Run a single test in isolation (C4 check)
npx vitest run test/assignment1-integration.e2e-spec.ts --config ./vitest.config.e2e.ts -t "\[C1\]"

# Run the database safety guard test suite (X3)
npm run test:guard

# Run all specs (unit + e2e)
npm run test:all
```

---

## 📊 Verification Evidence

### 1. Full Suite Run (`npm test`)
```
 RUN  v4.1.11 D:/CMIT_Internships/week10/Assingment1

======================================================
[W1] Initializing Test Suite with Database: assignment1_test
======================================================

[W1] Running migrations on test database 'assignment1_test'...
[W1] Migrations completed. Total executed: 0
 ✓ test/setup/database-guard.spec.ts (4 tests) 9ms
 ✓ test/assignment1-integration.e2e-spec.ts (13 tests) 9191ms

 Test Files  2 passed (2)
      Tests  17 passed (17)
[W1] Test Suite finished. Development database remains completely untouched.
```

### 2. Shuffled Run Output (`npm run test:shuffled`)
```
 RUN  v4.1.11 D:/CMIT_Internships/week10/Assingment1
      Running tests with seed "1790522567245"

 ✓ test/setup/database-guard.spec.ts (4 tests) 8ms
 ✓ test/assignment1-integration.e2e-spec.ts (13 tests) 9199ms
 Test Files  2 passed (2)
      Tests  17 passed (17)
```

### 3. Isolated Single-Test Run (`-t "[C1]"`)
```
 ✓ test/assignment1-integration.e2e-spec.ts (13 tests | 12 skipped) 1829ms
       ✓ [C1] should create a resource via POST and read it back via GET asserting status and body  1009ms
 Test Files  1 passed (1)
      Tests  1 passed | 12 skipped (13)
```

### 4. Database Safety Guard Demonstration (`[X3]`)
```
 ✓ test/setup/database-guard.spec.ts (4 tests) 18ms
   ✓ should permit execution when pointed at a valid test database ending with _test
   ✓ should abort with a clear error message when pointed at the development database 'assignment1'
   ✓ should abort when DB_NAME is undefined or empty
   ✓ should abort when pointed at standard production or system databases
```

---

## 🏁 Acceptance Criteria Met

- [x] **Separate Test Database (`W1`)**: Runs against `assignment1_test`; migrations run before tests; development DB `assignment1` is untouched.
- [x] **Deterministic Data Reset (`W2`)**: All domain tables truncated between tests; consecutive suite runs give identical results.
- [x] **HTTP Surface Coverage (`C1`, C2, C3`)**: Tests happy path (`POST` 201 -> `GET` 200), `400 Bad Request`, `401 Unauthorized`, and `404 Not Found` for `GET`, `PATCH`, and `DELETE`.
- [x] **Test Independence (`C4`)**: Tests use shared factories without leftover rows; single test and shuffled runs pass.
- [x] **Combinable Filters (`X1`)**: `?status=todo&projectId=1` returns only matching rows, excluding near-misses.
- [x] **Unknown Field Rejection (`X2`)**: Proves over HTTP that undeclared properties are rejected with `400` (`forbidNonWhitelisted`).
- [x] **Database Guard (`X3`)**: Refuses to start if pointed at non-test databases.
- [x] **Comments throughout**: All code files, configs, and test suites are annotated with explicit requirement comments (`[W1]`, `[W2]`, `[C1]`, `[C2]`, `[C3]`, `[C4]`, `[X1]`, `[X2]`, `[X3]`).
