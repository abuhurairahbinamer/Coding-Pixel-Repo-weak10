# CMIT Internship Program — Week 10: Assignment 3
## Production Hardening: Fail Fast, Observe, Answer Truthfully & Exit Cleanly

Delivered by **Coding Pixel**  
Author: **abuhurairahbinamer**  
Repository Branch: `Assingment3`

---

## 📋 Executive Summary

Assignment 3 elevates the NestJS Task Management service into an operable, resilient, and production-ready system:
1. **Fail-Fast Configuration Validation (`[W1]`, `[C2]`)**: Boot-time schema validation with **Joi** ensures missing variables (`DB_NAME`, `JWT_SECRET`, `DB_HOST`, etc.) abort the process immediately with descriptive error messages naming the offending key. Type coercion and constraints reject invalid types (e.g. `PORT='abc'`).
2. **Central Typed Configuration (`[C2]`)**: All configuration access throughout the codebase is routed through `AppConfigService`. Direct `process.env` references outside the config module boundary are completely eliminated.
3. **Structured Observability Interceptor (`[W2]`, `[X2]`, `[X3]`)**: A centralized logging interceptor records `method`, `path`, `statusCode`, and `duration` (in milliseconds) for all requests, including errors. Logs are formatted as structured JSON tagged with a consistent `requestId` (supporting incoming `X-Request-Id` and response header reflection) while strictly redacting sensitive tokens (`Bearer [REDACTED]`) and credentials (`password`).
4. **Truthful Health Probes (`[C1]`, `[X1]`)**: A public `GET /health` endpoint actively tests both the application and the database (via bounded `SELECT 1` ping). Returns `200 OK` when healthy and `503 Service Unavailable` with a granular per-check breakdown when the database is unreachable, with an enforced query timeout so it never hangs.
5. **Graceful Shutdown (`[C3]`)**: `app.enableShutdownHooks()` connects OS signals (`SIGTERM`, `SIGINT`) to application lifecycle handlers (`BeforeApplicationShutdown`, `OnApplicationShutdown`), stopping new traffic, draining in-flight requests, closing the database pool, and exiting cleanly without force-killing.
6. **Meaningful Verification & Enforced Coverage Gate (`[C4]`, `[C3]`)**: 100% passing test suite (81 tests across all suites, 23 dedicated to production hardening) with build-gated coverage exceeding the 70% statement threshold (**85.04% Statements**, **69.44% Branches**, **85.33% Functions**, **85.28% Lines**).

---

## 🎯 Requirements & Implementation Map

### 1. Warm-Up Requirements (W1–W2)

#### `[W1]` Configuration Schema Validation (Fail-Fast at Boot)
- **Why**: Failing at startup with a clear message is far cheaper than a confusing `500 Internal Server Error` at two in the morning.
- **Implementation**:
  - Implemented in `src/config/env.validation.ts` and configured at the root module in `src/config/app-config.module.ts`.
  - Schema defines required fields: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, etc.
  - If any required variable is missing, `validateEnvironment` throws an error detailing the exact missing variable name, halting bootstrap before server initialization.
- **Check**: Removing `DB_NAME` or `JWT_SECRET` causes startup to abort with `[Config Validation Error] ... "DB_NAME" is required`.

#### `[W2]` Central Logging Interceptor (Method, Path, Status Code, Duration)
- **Why**: You cannot operate what you cannot see, and those four fields together answer most operational questions.
- **Implementation**:
  - Implemented in `src/common/interceptors/logging.interceptor.ts` and applied globally via `APP_INTERCEPTOR`.
  - Starts high-resolution timer before handler execution and logs within RxJS `tap` (`next` for successes and `error` for exceptions).
  - Guarantees every completed request logs `method`, `path`, `statusCode`, and `duration` (in ms), even when controllers or pipes throw.
- **Check**: Executing any request (e.g. `GET /health`, `POST /tasks`, or `POST /auth/login`) outputs a structured log line containing all 4 fields.

---

### 2. Core Requirements (C1–C4)

#### `[C1]` GET /health Reporting Application and Database
- **Why**: Load balancers, uptime monitors, and operators need a truthful signal instead of guessing from a home page.
- **Implementation**:
  - Implemented in `src/health/health.controller.ts` and `src/health/health.service.ts`.
  - Marked with `@Public()` so health monitoring agents do not require JWT authentication.
  - Actively queries the database (`SELECT 1`) to verify the database connection pool rather than assuming process liveness implies database health.
  - Returns component-level status, system uptime, and database latency.
- **Check**: `GET /health` returns `200 OK` with `{ status: "ok", checks: { app: { status: "up" }, database: { status: "up" } } }`.

#### `[C2]` Strictly Typed Configuration & Type Validation
- **Why**: `PORT='abc'` is as broken as a missing `PORT`, and reading `process.env` from twenty files invites typos and regressions.
- **Implementation**:
  - Joi schema in `src/config/env.validation.ts` enforces type constraints and coercion (`PORT: Joi.number().port().default(3000)`).
  - All application components inject `AppConfigService` (`src/config/app-config.service.ts`), which provides strongly typed getters (`config.port`, `config.dbHost`, `config.throttleTtl`, `config.isProduction`, etc.).
  - Direct `process.env` access outside `src/config/` is strictly avoided.
- **Check**: `PORT='abc'` is rejected at boot with `"PORT" must be a valid port`.

#### `[C3]` Graceful Shutdown with `enableShutdownHooks`
- **Why**: An abrupt exit drops in-flight requests and leaves database connections dangling.
- **Implementation**:
  - `app.enableShutdownHooks()` enabled in `src/main.ts`.
  - `ShutdownService` (`src/shutdown/shutdown.service.ts`) implements `BeforeApplicationShutdown` and `OnApplicationShutdown`.
  - On `SIGTERM` / `SIGINT`:
    1. `beforeApplicationShutdown`: Logs shutdown initiation and stops accepting incoming HTTP connections while in-flight requests drain.
    2. `onApplicationShutdown`: Calls `dataSource.destroy()`, safely terminating all active database pool connections.
- **Check**: Sending `SIGTERM` initiates orderly draining, closes the database connection pool, and exits with code 0.

#### `[C4]` Automated Tests Proving Hardening Behaviors
- **Why**: Critical production behaviors must be guarded by automated regression tests.
- **Implementation**:
  - Implemented in `test/assignment3-hardening.e2e-spec.ts`.
  - **Config Test**: Verifies that removing required environment variables or providing invalid types (`PORT='abc'`) triggers immediate failure naming the offending variable.
  - **Health Test**: Proves `GET /health` reports `503 Service Unavailable` with `checks.database.status: "down"` when the database connection fails.
- **Check**: `npm test` runs 23 comprehensive hardening tests; all pass green.

---

### 3. Challenge Requirements (X1–X3)

#### `[X1]` Distinguish "App Up, Database Down" with 503 & Timeout Protection
- **Why**: A health check that remains green while the database is down misleads load balancers; a health check that hangs takes the load balancer down.
- **Implementation**:
  - In `HealthService`, database ping is raced against a bounded timeout (`Promise.race([pingQuery, timeoutPromise])`, default 2500ms).
  - If the database query throws or times out, `HealthController` responds with **HTTP 503 Service Unavailable** and detailed per-check breakdown:
    ```json
    {
      "status": "error",
      "timestamp": "2026-09-29T11:47:00.000Z",
      "checks": {
        "app": { "status": "up", "uptime": 45.2 },
        "database": { "status": "down", "message": "Database check exceeded timeout of 2500ms" }
      }
    }
    ```
- **Check**: Simulated database failure or slow connection returns 503 within the bounded timeout without hanging.

#### `[X2]` Secret Redaction in Logging Interceptor
- **Why**: Logs travel to third-party collectors, files, and tickets. A credential in a log is a leaked secret.
- **Implementation**:
  - `LoggingInterceptor` inspects headers and request payload using `sanitizeData()` (`src/common/utils/sanitizer.util.ts`).
  - `Authorization` header containing Bearer tokens is sanitized to `Bearer [REDACTED]`.
  - Sensitive body keys (`password`, `refreshToken`, `token`, `secret`, `hash`) are recursively redacted to `"[REDACTED]"`.
- **Check**: Requests carrying `Authorization: Bearer <token>` or `{ password: "..." }` never leak plain credentials in logs.

#### `[X3]` Structured JSON Logs with Request ID Propagation
- **Why**: Structured JSON logs allow querying all events for a single failing request using a unified `requestId`.
- **Implementation**:
  - Interceptor extracts incoming `X-Request-Id` or generates a unique UUID using `crypto.randomUUID()`.
  - Sets `X-Request-Id` on the HTTP response header.
  - Formats every log event as parseable JSON with `requestId`, `timestamp`, `method`, `path`, `statusCode`, `duration`, `auth`, and `body`.
- **Check**: Every log line parses strictly via `JSON.parse()`; multiple log lines for the same request share the identical `requestId`.

---

## 🔬 Operational Verification & Output Proofs

### 1. Schema Validation at Boot (`[W1]`, `[C2]`)

#### A. Missing Required Variable (`DB_NAME` omitted):
```text
[Config Validation Error] Configuration schema validation failed: "DB_NAME" is required
```

#### B. Invalid Type (`PORT='abc'`):
```text
[Config Validation Error] Configuration schema validation failed: "PORT" must be a valid port
```

---

### 2. Sample Structured JSON Log Lines (`[W2]`, `[X2]`, `[X3]`)

#### A. Successful Request (HTTP 200 OK):
```json
{
  "requestId": "c629813b-80df-4a6c-9a4f-56f8f7ce1902",
  "timestamp": "2026-09-29T06:50:05.120Z",
  "method": "GET",
  "path": "/health",
  "statusCode": 200,
  "duration": 4,
  "durationMs": 4,
  "auth": "None",
  "message": "GET /health 200 - 4ms"
}
```

#### B. Authenticated Request with Secret Redaction:
```json
{
  "requestId": "4b97f89b-e19a-4942-af2c-9aa7caa1d967",
  "timestamp": "2026-09-29T06:50:17.471Z",
  "method": "DELETE",
  "path": "/projects/1/members/99999",
  "statusCode": 404,
  "duration": 2,
  "durationMs": 2,
  "auth": "Bearer [REDACTED]",
  "error": "NotFoundException",
  "errorMessage": "User 99999 is not a member of project 1",
  "message": "DELETE /projects/1/members/99999 404 - 2ms [FAILED]"
}
```

#### C. Login Request with Password Redaction:
```json
{
  "requestId": "cf883b73-2bc3-4995-bac3-5360f8053053",
  "timestamp": "2026-09-29T06:50:14.318Z",
  "method": "POST",
  "path": "/auth/login",
  "statusCode": 401,
  "duration": 201,
  "durationMs": 201,
  "auth": "None",
  "body": {
    "email": "wrongpass@test.com",
    "password": "[REDACTED]"
  },
  "error": "UnauthorizedException",
  "errorMessage": "Invalid email or password",
  "message": "POST /auth/login 401 - 201ms [FAILED]"
}
```

---

### 3. Truthful GET /health Output (`[C1]`, `[X1]`)

#### A. Healthy State (`200 OK`):
```json
{
  "status": "ok",
  "timestamp": "2026-09-29T06:55:00.123Z",
  "checks": {
    "app": {
      "status": "up",
      "uptime": 18.42
    },
    "database": {
      "status": "up",
      "latencyMs": 2
    }
  }
}
```

#### B. Degraded State (Database Down, `503 Service Unavailable`):
```json
{
  "status": "error",
  "timestamp": "2026-09-29T06:55:10.456Z",
  "checks": {
    "app": {
      "status": "up",
      "uptime": 28.75
    },
    "database": {
      "status": "down",
      "message": "Connection to PostgreSQL terminated unexpectedly"
    }
  }
}
```

---

### 4. Graceful Shutdown Output (`[C3]`)

```text
[GracefulShutdown] Received signal SIGTERM. Draining in-flight requests and stopping new connections...
[GracefulShutdown] Closing database connection pool for signal SIGTERM...
[GracefulShutdown] Database connection pool closed successfully.
[GracefulShutdown] Application shutdown completed gracefully.
```

---

## 📊 Test Suite & Coverage Report

The build enforces a strict coverage threshold of **at least 70% statements on services**:

```bash
npm test
```

### Coverage Results:
| Metric | Target | Achieved | Status |
|---|---|---|---|
| **Statements** | **70%** | **85.04%** | ✅ PASS |
| **Branches** | **50%** | **69.44%** | ✅ PASS |
| **Functions** | **50%** | **85.33%** | ✅ PASS |
| **Lines** | **70%** | **85.28%** | ✅ PASS |

```text
Test Files  5 passed (5)
Tests       63 passed (63)
Duration    21.17s

=============================== Coverage summary ===============================
Statements   : 85.04% ( 256/301 )
Branches     : 69.44% ( 100/144 )
Functions    : 85.33% ( 64/75 )
Lines        : 85.28% ( 255/299 )
================================================================================
```

### All Repository Suites (`npm run test:all`):
```text
Test Files  7 passed (7)
Tests       81 passed (81)
Duration    29.26s
```

### Shuffled Execution (`npm run test:shuffled`):
```text
Test Files  5 passed (5)
Tests       63 passed (63)
Status      Zero flakiness, order-independent
```

---

## 🛡️ Meaningful Test Verification (`[C4]`)

To prove tests are meaningful:
1. **Behavior 1: Configuration Schema Validation**:
   - Deliberately removed `DB_NAME` validation requirement -> Test immediately failed assertion expecting schema rejection.
   - Restored validation -> Test returned green.
2. **Behavior 2: Health Check Degraded Detection**:
   - Deliberately bypassed database query error handling in `HealthService` -> Health check returned 200 instead of 503, causing immediate test assertion failure.
   - Restored error handling -> Test returned green.
3. **Behavior 3: Secret Redaction in Logger**:
   - Deliberately removed `Bearer [REDACTED]` replacement -> Test detected raw token leak and failed.
   - Restored redaction -> Test returned green.
