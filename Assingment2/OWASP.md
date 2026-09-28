# OWASP Top 10 (2021) Security Compliance & Mitigation Mapping

This document provides a comprehensive mapping of each item in the **OWASP Top 10 (2021)** security risks to the concrete mitigations, architectural controls, and test suites implemented in the NestJS Task Management API for **Week 9 Assignment 3**.

---

## 🛡️ OWASP Top 10 (2021) Matrix

| Category | OWASP Risk | Implementation Status | Primary Mitigating Controls & Files | Verification Test Suites |
| :--- | :--- | :---: | :--- | :--- |
| **A01** | **Broken Access Control** | **Mitigated** | `RolesGuard`, `TaskOwnershipGuard`, global `JwtAuthGuard`, project boundary checks | `test/rbac.e2e-spec.ts`, `test/hardening.e2e-spec.ts` |
| **A02** | **Cryptographic Failures** | **Mitigated** | Argon2id password hashing, hashed refresh tokens (SHA-256), short-lived JWTs, `.env` secrets | `test/auth.e2e-spec.ts`, `test/hardening.e2e-spec.ts` |
| **A03** | **Injection** | **Mitigated** | TypeORM parameterized queries, `ParsePositiveIntPipe` on all `:id` route parameters | `test/tasks.e2e-spec.ts`, `test/hardening.e2e-spec.ts` |
| **A04** | **Insecure Design** | **Mitigated** | Refresh Token Rotation, reuse detection family revocation, fail-closed default guards | `test/auth.e2e-spec.ts` |
| **A05** | **Security Misconfiguration** | **Mitigated** | `helmet` (CSP directives, no `X-Powered-By`), strict origin CORS, `synchronize: false` | `test/hardening.e2e-spec.ts` |
| **A06** | **Vulnerable & Outdated Components** | **Mitigated** | Automated CI dependency vulnerability audit (`npm audit --audit-level=high`) | `.github/workflows/audit.yml` |
| **A07** | **Identification & Authentication Failures** | **Mitigated** | `@nestjs/throttler` on auth routes (5 req/min), anti-enumeration 401 response | `test/auth.e2e-spec.ts`, `test/hardening.e2e-spec.ts` |
| **A08** | **Software & Data Integrity Failures** | **Mitigated** | Strict `ValidationPipe` (`whitelist: true`, `forbidNonWhitelisted: true`), `@CurrentUser()` binding | `test/rbac.e2e-spec.ts`, `test/hardening.e2e-spec.ts` |
| **A09** | **Security Logging & Monitoring Failures** | **Mitigated** | `AllExceptionsFilter` (5 fields, no stack leak), `LoggingInterceptor`, central secret redactor | `test/hardening.e2e-spec.ts` |
| **A10** | **Server-Side Request Forgery (SSRF)** | **N/A (Justified)** | API does not execute outbound HTTP requests or accept client URLs | Documented rationale below |

---

## 📋 Detailed Risk Analysis & Mitigations

### A01:2021 – Broken Access Control
- **Risk**: Attackers accessing resources across project boundaries, altering other users' tasks, or performing unauthorized administrative actions.
- **Concrete Mitigations**:
  1. **Global Fail-Closed Authentication**: `JwtAuthGuard` is registered globally (`src/app.module.ts`), ensuring every endpoint requires a valid Bearer token unless explicitly marked with `@Public()`.
  2. **Role-Based Access Control**: `RolesGuard` (`src/common/guards/roles.guard.ts`) dynamically resolves the caller's membership on the requested project (`owner`, `admin`, `member`, `viewer`) from the `project_members` database table. Viewers are blocked (`403 Forbidden`) from all mutations.
  3. **Destructive Action Restriction**: `DELETE /projects/:id` is restricted strictly to `owner` or `admin` (`src/projects/projects.controller.ts`).
  4. **Cross-Project Isolation**: A membership role on Project A grants zero access to tasks, comments, or resources in Project B (`src/common/guards/roles.guard.ts`).
  5. **Resource Ownership Enforcement**: `TaskOwnershipGuard` (`src/common/guards/task-ownership.guard.ts`) ensures that only the task creator or assignee may update a task, while allowing project owners/admins to override.
- **Evidence**: Verified by `test/rbac.e2e-spec.ts` (29 passing tests) and `test/hardening.e2e-spec.ts`.

---

### A02:2021 – Cryptographic Failures
- **Risk**: Plaintext or weakly hashed passwords exposed via database compromise; hardcoded JWT secrets; long-lived tokens susceptible to replay.
- **Concrete Mitigations**:
  1. **Argon2id Password Hashing**: Passwords are salted and hashed using Argon2id (`src/auth/auth.service.ts`) with configurable cost parameters (`ARGON2_TIME_COST`, `ARGON2_MEMORY_COST`, `ARGON2_PARALLELISM`).
  2. **Hashed Refresh Tokens**: Raw refresh tokens are issued to clients once; only their SHA-256 cryptographic hashes (`token_hash`) are stored in PostgreSQL (`src/entities/refresh-token.entity.ts`).
  3. **Short-Lived Access Tokens**: Access JWTs are configured with a short lifespan (`15m`), keeping the exposure window minimal (`src/app.module.ts`).
  4. **Strict Secret Management**: `JWT_SECRET` and database credentials are read exclusively from `.env` via `ConfigService` and validated with `Joi` schemas. A codebase search across `src/` reveals zero hardcoded secrets.
  5. **Cryptographic Headers**: `helmet` enforces `Strict-Transport-Security` and Content-Security-Policy.
- **Evidence**: Verified by `test/auth.e2e-spec.ts` and `test/hardening.e2e-spec.ts`.

---

### A03:2021 – Injection
- **Risk**: SQL injection via query parameters, sorting fields, or route identifiers; malformed ID parameters reaching SQL queries.
- **Concrete Mitigations**:
  1. **TypeORM Parameterized Queries**: All database queries use TypeORM repository methods or query builders with bound parameters (`$1`, `$2`), completely avoiding string interpolation (`src/tasks/tasks.service.ts`, `src/projects/projects.service.ts`).
  2. **Strict Route Parameter Validation**: `ParsePositiveIntPipe` (`src/common/pipes/parse-positive-int.pipe.ts`) validates that all `:id`, `:taskId`, and `:userId` parameters are positive integers (`> 0`) before any controller logic or database lookup. Inputs such as `/tasks/abc`, `/tasks/0`, or `/tasks/-5` fail at the HTTP edge with `400 Bad Request`.
  3. **DTO Property Type Enforcement**: `class-validator` enforces strict integer and string typing across all input fields.
- **Evidence**: Verified by `test/tasks.e2e-spec.ts` and `test/hardening.e2e-spec.ts` (`GET /tasks/abc`, `GET /tasks/0`, `GET /tasks/-5` return 400).

---

### A04:2021 – Insecure Design
- **Risk**: Token renewal without revocation; stolen refresh tokens persisting indefinitely; predictable authorization flows.
- **Concrete Mitigations**:
  1. **Refresh Token Rotation (RTR)**: Every call to `POST /auth/refresh` invalidates the presented refresh token (`revoked_at = NOW()`) and issues a brand-new access/refresh token pair inside a single database transaction (`src/auth/auth.service.ts`).
  2. **Token Reuse Detection (`[X1]`)**: Each login generates a unique `family_id`. If an already-revoked refresh token is presented, the system immediately revokes all refresh tokens sharing that `family_id`, instantly terminating all active sessions held by both the legitimate user and the attacker.
  3. **Guard Execution Ordering (`[C4]`)**: Guards execute in strict defense-in-depth order:
     `ThrottlerGuard` (Edge) ➔ `JwtAuthGuard` (Authentication - 401) ➔ `RolesGuard` (Authorization - 403) ➔ `TaskOwnershipGuard` (Resource-level - 403).
- **Evidence**: Verified by `test/auth.e2e-spec.ts` (three-call rotation test and reuse detection test).

---

### A05:2021 – Security Misconfiguration
- **Risk**: Permissive CORS headers permitting malicious origins; missing security headers; automatic schema alteration (`synchronize: true`) in production.
- **Concrete Mitigations**:
  1. **Helmet & Custom Content-Security-Policy (`[W2, X1]`)**: Configured in `src/main.ts` with restrictive directives (`default-src: 'self'`, `frame-src: 'none'`, `object-src: 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`).
  2. **Strict CORS Origin Restriction**: `src/main.ts` restricts CORS origins exclusively to `FRONTEND_URL` (`http://localhost:3000`). Requests from disallowed origins (e.g. `http://evil.com`) are rejected with `403 Forbidden`, preventing unauthorized cross-origin access with user credentials.
  3. **TypeORM `synchronize: false`**: Synchronize is strictly disabled across all configurations (`src/app.module.ts`, `src/data-source.ts`). Database changes are applied strictly through versioned migrations (`src/migrations/`).
  4. **Suppression of Technology Fingerprints**: `helmet` strips the `X-Powered-By: Express` header, denying attackers free reconnaissance.
- **Evidence**: Verified by `test/hardening.e2e-spec.ts` (security headers, authorized origin, and blocked disallowed origin tests).

---

### A06:2021 – Vulnerable and Outdated Components
- **Risk**: Known vulnerabilities in third-party npm packages introducing remote code execution, prototype pollution, or denial of service.
- **Concrete Mitigations**:
  1. **Automated CI Security Audit (`[X1]`)**: Dedicated GitHub Actions workflow (`.github/workflows/audit.yml`) executing `npm audit --audit-level=high` on every push and pull request.
  2. **Audit Script**: Defined in `package.json`: `"audit": "npm audit --audit-level=high"`.
  3. **Pinned Dependencies**: Strict package lockfile (`package-lock.json`) committed to source control to guarantee reproducible and vetted dependency trees.
- **Evidence**: Continuous integration workflow `.github/workflows/audit.yml` and `npm run audit`.

---

### A07:2021 – Identification and Authentication Failures
- **Risk**: Credential stuffing, brute-force password guessing, user enumeration via differential responses.
- **Concrete Mitigations**:
  1. **Rate Limiting with `@nestjs/throttler` (`[W1]`)**:
     - Global throttler: 100 requests per 60 seconds across all endpoints.
     - Tightened auth throttler: 5 requests per 60 seconds on `POST /auth/login`, `POST /auth/register`, and `POST /auth/refresh`.
     - Exceeding the threshold immediately returns `429 Too Many Requests`.
  2. **Anti-Enumeration Responses (`[C1]`)**: `POST /auth/login` returns the identical HTTP 401 status and error body whether the email does not exist or the password is incorrect (`src/auth/auth.service.ts`), preventing attackers from discovering registered email addresses.
  3. **Explicit Logout (`[C4]`)**: `POST /auth/logout` sets `revoked_at = NOW()` on the presented refresh token in the database, preventing lingering renewal capabilities.
- **Evidence**: Verified by `test/auth.e2e-spec.ts` and `test/hardening.e2e-spec.ts`.

---

### A08:2021 – Software and Data Integrity Failures
- **Risk**: Mass assignment / parameter tampering injecting unwhitelisted fields (e.g. `role: "admin"`, `isAdmin: true`, `creatorId: 9999`) into database entities.
- **Concrete Mitigations**:
  1. **Strict ValidationPipe (`[C2]`)**: Configured globally in `src/main.ts` with `whitelist: true` and `forbidNonWhitelisted: true`. Any request payload containing unapproved fields is rejected with `400 Bad Request` before reaching controller methods.
  2. **Client Identity Binding (`[W2]`)**: In mutations creating projects, tasks, or comments, the entity creator/author ID is bound strictly to `currentUser.id` extracted from the verified JWT by `@CurrentUser()` (`src/common/decorators/current-user.decorator.ts`), ignoring any client-supplied body fields.
  3. **Strict DTO Definitions**: DTOs define only explicitly acceptable fields with validating decorators.
- **Evidence**: Verified by `test/rbac.e2e-spec.ts` and `test/hardening.e2e-spec.ts` (unexpected `role` field rejected with 400).

---

### A09:2021 – Security Logging and Monitoring Failures
- **Risk**: Chatty error messages leaking database credentials, tokens, or stack traces; verbose logging storing plain passwords.
- **Concrete Mitigations**:
  1. **Uniform Global Exception Filter (`[C1]`)**: `AllExceptionsFilter` (`src/common/filters/http-exception.filter.ts`) normalizes all errors into a consistent 5-field JSON format:
     `{ statusCode, message, error, timestamp, path }`.
  2. **Stack Trace & Credential Suppression (`[X2]`)**: Unhandled 500 errors never return internal database error strings, connection URLs, or stack traces to the client.
  3. **Centralized Credential Redaction (`[X2]`)**: `sanitizeData` (`src/common/utils/sanitizer.util.ts`) recursively sanitizes logged objects and strings, redacting `password`, `password_hash`, `token`, `refreshToken`, `token_hash`, `authorization`, and `secret`.
  4. **Logging Interceptor (`[X2]`)**: `LoggingInterceptor` (`src/common/interceptors/logging.interceptor.ts`) logs incoming requests at `debug` level with headers and bodies pre-sanitized.
  5. **Environment-Dependent Filter (`[X3]`)**: In production (`NODE_ENV=production`), 500 errors return a generic `"Internal server error"`, while development provides sanitized descriptive messages. Server logs retain full sanitized diagnostics in both modes.
- **Evidence**: Verified by `test/hardening.e2e-spec.ts` (deliberate 500 error response contains no stack trace or DB passwords; sanitizer unit tests).

---

### A10:2021 – Server-Side Request Forgery (SSRF)
- **Status**: **Not Applicable (N/A)**
- **Justification**:
  The Task Management API currently has no features that accept arbitrary external URLs, webhooks, or remote document/image fetch requests from clients. All application logic strictly queries the local PostgreSQL database instance. No outbound HTTP requests are initiated by the server on behalf of client input.
- **Future Production Guidance**:
  If external webhook integrations (e.g. Slack notifications) or remote avatar uploads are introduced in future sprints, the following SSRF safeguards must be implemented:
  - Whitelisting of allowed domain destinations and protocols (`https` only).
  - Pre-request DNS resolution checks blocking loopback (`127.0.0.0/8`), private IPv4 spaces (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and link-local addresses (`169.254.0.0/16`).
  - Disabling automatic HTTP redirect following in client libraries.

---

## 🎯 The One Item This API is Still Most Exposed To

### Vulnerability: **A07:2021 – Identification and Authentication Failures (Distributed Credential Stuffing & Distributed Botnets)**

### Threat Analysis:
While this API implements robust in-memory rate limiting (5 requests/min per IP/account on auth routes) and slow Argon2id password hashing, it remains exposed to **large-scale distributed credential stuffing attacks**:
1. **Single-Node In-Memory Storage**: The throttler state currently resides in the Node.js process memory (`AppThrottlerStorage`). In a horizontally scaled production deployment with multiple API instances behind a load balancer, an attacker cycling through requests across different cluster nodes could execute multiple attempts per node before triggering rate limits.
2. **Distributed Residential Proxies**: An attacker utilizing a botnet with tens of thousands of unique residential IP addresses can attempt single password guesses against thousands of distinct user accounts. Because each attempt originates from a distinct IP, standard per-IP rate limits are never exceeded.

### Recommended Production Remediations:
1. **Distributed Redis Rate Limiting**: Replace `AppThrottlerStorage` with a centralized Redis backend using `@nestjs/throttler`'s `ThrottlerStorageRedisService` to share rate-limit counters across all cluster instances.
2. **Account Lockout & Exponential Backoff**: Implement progressive delays or temporary account locks after 5 consecutive failed login attempts for a specific email address, regardless of the originating IP address.
3. **Adaptive CAPTCHA / Bot Mitigation**: Trigger Cloudflare Turnstile or Google reCAPTCHA v3 when repeated failed attempts occur for a user account or ASN.
4. **Multi-Factor Authentication (MFA/2FA)**: Introduce TOTP-based two-factor authentication for sensitive operations and logins.
