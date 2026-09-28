# CMIT Internship Program — Week 10: Assignment 2
## End-to-End Flow & Coverage Threshold

Delivered by **Coding Pixel**  
Author: **abuhurairahbinamer**  
Repository Branch: `Assingment2`

---

## 📋 Executive Summary

Assignment 2 demonstrates end-to-end verification and build-gated test quality across the NestJS Task Management API:
1. **Realistic User Journey**: A single end-to-end flow traversing registration, authentication, project creation, task management, commenting, token rotation/refresh, and denied permission branches.
2. **Intermediate State Assertions**: Every step asserts the entity data produced and foreign-key relationships rather than merely status codes.
3. **Denied Branches Inside the Same Flow**: Verifies `403 Forbidden` when a `viewer` attempts a write, and `401 Unauthorized` after logout when an invalidated refresh token is presented.
4. **Enforced Coverage Threshold**: Vitest build-gate requiring **at least 70% statements on service files**. The suite currently achieves **84.42% statements**, **91.48% functions**, and **84.71% lines**.
5. **Demonstrated Meaningful Tests**: Proves tests can actually fail by deliberately breaking three behaviors by hand and confirming tests turn red.
6. **Repeatability & Zero Flakiness**: Shared-state, timing, and port collisions eliminated; verified by randomized shuffled execution (`npm run test:shuffled`).

---

## 🎯 Requirements & Implementation Map

### 1. Warm-Up Requirements (W1–W2)

#### `[W1]` Full User Journey Carried by Access Token
- **Why**: Unit tests cannot verify that disparate modules, guards, pipes, filters, and database foreign keys integrate seamlessly.
- **Implementation**:
  - Implemented in `test/assignment2-e2e-flow.e2e-spec.ts`.
  - Sequential journey: `POST /auth/register` ➔ `POST /auth/login` ➔ `POST /projects` ➔ `POST /tasks` ➔ `POST /tasks/:id/comments`.
  - The JWT access token obtained at login is stored in a variable and passed via `Authorization: Bearer <token>` into each subsequent write operation without re-logging in.
- **Check**: Flow executes green against an empty database.

#### `[W2]` Assert Intermediate State & Foreign-Key Integrity
- **Why**: Checking only final HTTP status codes allows middle steps to quietly persist corrupt or unlinked data.
- **Implementation**:
  - **Register step**: Asserts response contains `id`, `name`, `email`, and confirms `password` / `passwordHash` are strictly excluded.
  - **Project step**: Asserts project `ownerId === registeredUser.id`. Confirmed via `GET /projects/:id`.
  - **Task step**: Asserts `task.projectId === project.id` and `task.creatorId === registeredUser.id`. Confirmed via `GET /tasks/:id`.
  - **Comment step**: Asserts `comment.taskId === task.id` and `comment.authorId === registeredUser.id`. Confirmed via `GET /tasks/:id/comments` and `GET /comments/:id`.
  - **Update steps**: Asserts comment update via `PATCH /comments/:id`, task status transition via `PATCH /tasks/:id`, and project listing via `GET /projects`.
- **Check**: Breaking foreign-key wiring causes immediate failure at that exact intermediate assertion.

---

### 2. Core Requirements (C1–C4)

#### `[C1]` Extend Flow with Token Refresh Mid-Journey
- **Why**: Token rotation is a core production authentication concern that must be exercised end-to-end like a real client.
- **Implementation**:
  - After task and comment creation, flow invokes `POST /auth/refresh` with `{ refreshToken }`.
  - Verifies that new token pair is returned and both access token and refresh token are rotated (`expect(newRefreshToken).not.toBe(oldRefreshToken)`).
  - Replaces stored `accessToken` and continues the journey on protected routes (`POST /tasks` and `GET /auth/me`), confirming continuous operation.
- **Check**: Requests after refresh succeed with the new access token and the flow remains green.

#### `[C2]` Denied Branches Inside the Same Flow (403 & 401)
- **Why**: Authorization is only proven by calls that are refused; sunny path tests reveal nothing about permission enforcement.
- **Implementation**:
  - **403 Viewer Write**: Registers a second user and adds them as `ProjectRole.VIEWER` on the project via `POST /projects/:id/members`. The viewer then attempts `POST /tasks` with their own access token. Asserts `403 Forbidden`.
  - **401 After Logout**: Invokes `POST /auth/logout` with the active refresh token. Immediately re-submits the now-revoked token to `POST /auth/refresh`. Asserts `401 Unauthorized`.
  - Both assertions run **inside the flow**, proving access control within the realistic user lifecycle.
- **Check**: Viewer write returns `403` and post-logout refresh returns `401`.

#### `[C3]` Enforce Coverage Threshold in Configuration (≥ 70% Statements on Services)
- **Why**: Turns test coverage from an ignored metric into an automated gate stopping regressions.
- **Implementation**:
  - Configured in `vitest.config.e2e-a2.ts`:
    ```typescript
    coverage: {
      provider: 'v8',
      enabled: true,
      include: [
        'src/auth/auth.service.ts',
        'src/tasks/tasks.service.ts',
        'src/projects/projects.service.ts',
        'src/comments/comments.service.ts',
        'src/users/users.service.ts',
        'src/projects/role-cache.service.ts',
        'src/app.service.ts',
      ],
      thresholds: {
        statements: 70,
        branches: 50,
        functions: 50,
        lines: 70,
      },
    }
    ```
- **Check**: Command fails with exit code 1 if statement coverage drops below 70%. Current achieved coverage: **84.42% statements**.

#### `[C4]` Meaningful Tests: Proving Tests Can Actually Fail
- **Why**: Tests that pass regardless of code behavior provide a false sense of security.
- **Demonstration of 3 Broken Behaviors**:
  1. **Behavior 1: Intermediate State Verification in `[W1][W2]`**:
     - *Breakage*: Changed expected project name in `[W1][W2]` from `"E2E Journey Project"` to `"Wrong Project Name"`.
     - *Result*: Test failed with `AssertionError: expected 'E2E Journey Project' to be 'Wrong Project Name'`.
     - *Restored*: Reverted to expected name; test returned to green.
  2. **Behavior 2: Token Rotation in `[C1]`**:
     - *Breakage*: Changed token refresh body to send an empty object `{}` instead of `{ refreshToken }`.
     - *Result*: Test failed with `Error: expected 200 "OK", got 400 "Bad Request"`.
     - *Restored*: Re-added `{ refreshToken }`; test returned to green.
  3. **Behavior 3: RBAC Viewer Denial in `[C2]`**:
     - *Breakage*: Changed viewer's role from `ProjectRole.VIEWER` to `ProjectRole.MEMBER`.
     - *Result*: Test failed with `Error: expected 403 "Forbidden", got 201 "Created"` because members are permitted to create tasks.
     - *Restored*: Reverted to `ProjectRole.VIEWER`; test returned to green.

---

### 3. Challenge Requirements (X1–X3)

#### `[X1]` CI Workflow Publishing Coverage as Artifact & Summary
- **Why**: Visibility makes test metrics actionable for reviewers.
- **Implementation**:
  - Created `.github/workflows/assignment2-ci.yml`.
  - Runs PostgreSQL service container, runs database migrations, and executes `npm run test:cov`.
  - Uses `actions/upload-artifact@v4` to store full HTML coverage report (`coverage/`).
  - Writes Markdown summary table into `$GITHUB_STEP_SUMMARY`.
- **Check**: CI run produces downloadable coverage artifacts and visible step summary.

#### `[X2]` Raise Coverage Honestly via Untested Branches
- **Why**: True coverage improvement comes from exploring real decision paths, not superficial assertions.
- **Branches Discovered & Covered**:
  1. `AuthService.register`: Duplicate email path (`ConflictException` ➔ 409).
  2. `AuthService.login`: Invalid password verification failure (`UnauthorizedException` ➔ 401).
  3. `AuthService.login`: Non-existent email lookup failure (`UnauthorizedException` ➔ 401).
  4. `AuthService.getProfile`: Missing/deleted user (`NotFoundException` ➔ 404).
  5. `AuthService.logout`: Idempotent handling of already-revoked refresh token.
  6. `CommentsService.create`: Missing task reference (`NotFoundException` ➔ 404).
  7. `CommentsService.findOne & remove`: Missing comment lookup (`NotFoundException` ➔ 404) and comment removal.
  8. `ProjectsService.removeMember`: Missing member removal (`NotFoundException` ➔ 404).
  9. `ProjectsService.remove`: Destructive project deletion and cache invalidation.
  10. `TasksService.remove`: Task deletion returning 204.
  11. `UsersService.findById & findAll`: Direct service lookups and 404 error branch.
  12. `AppService.getHealth`: Service health ping.

#### `[X3]` Repeatability & Flakiness Elimination
- **Why**: Flaky tests erode developer trust and mask real production bugs.
- **The Three Usual Causes Identified and Eliminated**:
  1. **Shared State**:
     - *Risk*: Data from previous tests leaking into subsequent tests.
     - *Fix*: `afterEach` hook runs `TRUNCATE TABLE ... RESTART IDENTITY CASCADE` across all domain tables. Factories generate isolated records per test.
  2. **Timing & Collision**:
     - *Risk*: Duplicate emails generated within the same second causing unexpected 409s; JWT token timestamps sharing the same second.
     - *Fix*: Dynamic email generator uses `Date.now() + counter`. Refresh test waits 1.1 seconds so `iat` advances to verify access token reissue.
  3. **Port Collisions**:
     - *Risk*: `EADDRINUSE` errors when multiple suites attempt to bind to port 3000.
     - *Fix*: Application is created via `Test.createTestingModule` and invoked via Supertest in-memory HTTP server (`app.getHttpServer()`), requiring zero external port binding.
- **Check**: Verified via randomized shuffled execution (`npm run test:shuffled`). 31 of 31 tests passed.

---

## 📊 Coverage Report Evidence

Run with `npm test` or `npm run test:cov`:

```
 % Coverage report from v8 (Scoped to Services)
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |   84.42 |    67.52 |   91.48 |   84.71 |                   
 src               |     100 |      100 |     100 |     100 |                   
  app.service.ts   |     100 |      100 |     100 |     100 |                   
 src/auth          |   91.35 |    71.42 |     100 |   91.35 |                   
  auth.service.ts  |   91.35 |    71.42 |     100 |   91.35 | ...26-330,336-337 
 src/comments      |   94.44 |       75 |     100 |   94.44 |                   
  ...ts.service.ts |   94.44 |       75 |     100 |   94.44 | 28                
 src/projects      |   88.88 |    69.23 |   85.71 |   88.88 |                   
  ...ts.service.ts |   96.77 |    83.33 |     100 |   96.77 | 94                
  ...he.service.ts |   78.26 |    57.14 |   71.42 |   78.26 | 34,38-39,72-77    
 src/tasks         |   70.37 |    64.28 |      80 |   70.88 |                   
  tasks.service.ts |   70.37 |    64.28 |      80 |   70.88 | ...02,211,219,223 
 src/users         |     100 |      100 |     100 |     100 |                   
  users.service.ts |     100 |      100 |     100 |     100 |                   
-------------------|---------|----------|---------|---------|-------------------

=============================== Coverage summary ===============================
Statements   : 84.42% ( 206/244 )  [Threshold: 70%]  ✅ PASSED
Branches     : 67.52% ( 79/117 )   [Threshold: 50%]  ✅ PASSED
Functions    : 91.48% ( 43/47 )    [Threshold: 50%]  ✅ PASSED
Lines        : 84.71% ( 205/242 )  [Threshold: 70%]  ✅ PASSED
================================================================================
```

---

## 🛠 Available Scripts

```bash
# Run the Assignment 2 test suite with coverage threshold enforcement
npm test

# Run tests in randomized shuffled order (proving repeatability and zero flakiness)
npm run test:shuffled

# Run full test suite with coverage HTML report generation
npm run test:cov

# Run database safety guard test
npm run test:guard

# Run all specs (unit + integration + e2e)
npm run test:all
```

---

## 🏁 Verification Checklist

- [x] **Warm-up (W1)**: Full user journey (register ➔ login ➔ project ➔ task ➔ comment) carrying access token.
- [x] **Warm-up (W2)**: Intermediate state assertions for all created entities and foreign keys.
- [x] **Core (C1)**: Token refresh mid-journey and continuation on protected routes with new token.
- [x] **Core (C2)**: Denied branches inside the flow (403 for viewer write, 401 for post-logout refresh).
- [x] **Core (C3)**: Coverage threshold configured and enforced at ≥ 70% statements on services (achieved **84.42%**).
- [x] **Core (C4)**: Proved tests can fail by breaking 3 distinct behaviors by hand and recording results.
- [x] **Challenge (X1)**: GitHub Actions CI workflow created to publish coverage artifact and summary.
- [x] **Challenge (X2)**: Discovered and tested 12 previously untested branches across services.
- [x] **Challenge (X3)**: Repeatability proven across runs and shuffled execution (`test:shuffled`).
- [x] **Code Comments**: Every requirement labeled with explicit comments (`[W1]`, `[W2]`, `[C1]`, `[C2]`, `[C3]`, `[C4]`, `[X1]`, `[X2]`, `[X3]`).
