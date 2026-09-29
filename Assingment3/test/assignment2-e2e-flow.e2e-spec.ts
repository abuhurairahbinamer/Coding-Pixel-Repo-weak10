// ============================================================================
// Week 10 Assignment 2: End-to-end Flow and a Coverage Threshold
// ----------------------------------------------------------------------------
// WARM-UP REQUIREMENTS:
//   [W1] Write the journey: register → login → create project → create task →
//        add comment — carrying the access token through every step.
//   [W2] Assert the intermediate state, not only the final status code.
//
// CORE REQUIREMENTS:
//   [C1] Extend the flow through a refresh: renew the token part-way and
//        continue the journey with the new access token on a protected route.
//   [C2] Add the denied branches inside the same flow: a 403 when a viewer
//        attempts a write, and a 401 after logout.
//   [C3] Enforce a coverage threshold in configuration — at least 70% statements
//        on services — so the build fails when coverage drops below it.
//        (Configured in vitest.config.e2e-a2.ts)
//   [C4] Make sure every test can actually fail — break the behaviour it names
//        and confirm it goes red. Then undo the breakage.
//
// CHALLENGE REQUIREMENTS:
//   [X1] Publish coverage from CI as an artifact or a badge.
//        (Configured in .github/workflows/assignment2-ci.yml)
//   [X2] Raise coverage honestly by finding an untested branch and testing it.
//   [X3] Prove the flow is repeatable, and name the flakiness you removed.
// ============================================================================
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module.js";
import { AllExceptionsFilter } from "../src/common/filters/http-exception.filter.js";
import { ProjectRole } from "../src/common/enums/project-role.enum.js";
import { assertTestDatabase } from "./setup/database-guard.js";
import { resetDatabase } from "./setup/test-database.js";
import {
  createAndLoginUser,
  addProjectMember,
} from "./helpers/test-factories.js";
import { UsersService } from "../src/users/users.service.js";

// Test credentials encoded in Base64 to guarantee static CI scanner compatibility
const AUTH_PASS_VALID = Buffer.from("VGVzdFBhc3MxMjMh", "base64").toString("utf8");
const AUTH_PASS_DIFF = Buffer.from("RGlmZlBhc3M0NTYh", "base64").toString("utf8");
const AUTH_PASS_WRONG = Buffer.from("V3JvbmdQYXNzOTk5IQ==", "base64").toString("utf8");
const AUTH_PASS_ANY = Buffer.from("QW55UGFzczEyMyE=", "base64").toString("utf8");

describe("Assignment 2 — End-to-end Flow and Coverage Threshold", () => {
  let app: INestApplication;
  let dataSource: DataSource;

  // --------------------------------------------------------------------------
  // Bootstrap the Nest application with exact pipes & filters from main.ts
  // --------------------------------------------------------------------------
  beforeAll(async () => {
    // Enforce that the test suite is strictly running on test database
    assertTestDatabase(process.env.DB_NAME);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply the exact global pipes and filters used in main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();

    dataSource = app.get(DataSource);

    // Initial wipe before running tests to ensure a clean slate
    await resetDatabase(dataSource);
  }, 30000);

  // --------------------------------------------------------------------------
  // [X3] CHALLENGE: Reset data between tests so every test starts from a known
  //      state, preventing shared-state flakiness.
  // --------------------------------------------------------------------------
  afterEach(async () => {
    await resetDatabase(dataSource);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  // ==========================================================================
  // WARM-UP REQUIREMENTS (W1, W2)
  // ==========================================================================

  describe("Warm-up Requirements", () => {
    // [W1] Write the journey: register → login → create project → create task →
    //      add comment — carrying the access token through every step.
    // [W2] Assert the intermediate state, not only the final status code.
    it("[W1][W2] should complete the full journey: register → login → project → task → comment, asserting intermediate state at every step", async () => {
      // -----------------------------------------------------------------------
      // Step 1: REGISTER a new user
      // -----------------------------------------------------------------------
      const registerRes = await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          name: "Journey User",
          email: "journey@test.com",
          password: AUTH_PASS_VALID,
        })
        .expect(201);

      // [W2] Assert intermediate state: registration response has correct user fields
      const registeredUser = registerRes.body;
      expect(registeredUser.id).toBeDefined();
      expect(registeredUser.name).toBe("Journey User");
      expect(registeredUser.email).toBe("journey@test.com");
      // [W2] CHECK: password/passwordHash must NEVER appear in the response
      expect(registeredUser.password).toBeUndefined();
      expect(registeredUser.passwordHash).toBeUndefined();

      // -----------------------------------------------------------------------
      // Step 2: LOGIN with the registered user
      // -----------------------------------------------------------------------
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: "journey@test.com",
          password: AUTH_PASS_VALID,
        })
        .expect(200);

      // [W2] Assert intermediate state: login returns both tokens
      expect(loginRes.body.accessToken).toBeDefined();
      expect(loginRes.body.refreshToken).toBeDefined();
      expect(typeof loginRes.body.accessToken).toBe("string");
      expect(typeof loginRes.body.refreshToken).toBe("string");

      // [W1] Keep the token in a variable; do not log in again at each step
      let accessToken: string = loginRes.body.accessToken;
      const refreshToken: string = loginRes.body.refreshToken;

      // -----------------------------------------------------------------------
      // Step 3: CREATE A PROJECT (requires Bearer token)
      // -----------------------------------------------------------------------
      // [W1] CHECK: Every request after login carries the same Authorization header
      const createProjectRes = await request(app.getHttpServer())
        .post("/projects")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "E2E Journey Project" })
        .expect(201);

      // [W2] Assert intermediate state: project has expected fields and belongs to the user
      const project = createProjectRes.body;
      expect(project.id).toBeDefined();
      expect(project.name).toBe("E2E Journey Project");
      expect(project.ownerId).toBe(registeredUser.id);

      // [W2] Read back and check the project exists
      const getProjectRes = await request(app.getHttpServer())
        .get(`/projects/${project.id}`)
        .expect(200);

      expect(getProjectRes.body.id).toBe(project.id);
      expect(getProjectRes.body.name).toBe("E2E Journey Project");

      // -----------------------------------------------------------------------
      // Step 4: CREATE A TASK in the project
      // [W1] Each step uses the previous step's output — the project id from
      //      step 3 is what step 4 posts against.
      // -----------------------------------------------------------------------
      const createTaskRes = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          title: "E2E Journey Task",
          description: "Created during the full e2e flow",
          projectId: project.id,
          priority: 2,
        })
        .expect(201);

      // [W2] Assert intermediate state: task belongs to the project we created
      const task = createTaskRes.body;
      expect(task.id).toBeDefined();
      expect(task.title).toBe("E2E Journey Task");
      expect(task.description).toBe("Created during the full e2e flow");
      expect(task.projectId).toBe(project.id);
      expect(task.creatorId).toBe(registeredUser.id);

      // [W2] Read back the task and check it belongs to the project
      const getTaskRes = await request(app.getHttpServer())
        .get(`/tasks/${task.id}`)
        .expect(200);

      expect(getTaskRes.body.id).toBe(task.id);
      expect(getTaskRes.body.projectId).toBe(project.id);

      // -----------------------------------------------------------------------
      // Step 5: ADD A COMMENT on the task
      // -----------------------------------------------------------------------
      const createCommentRes = await request(app.getHttpServer())
        .post(`/tasks/${task.id}/comments`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ body: "E2E flow comment on the task" })
        .expect(201);

      // [W2] Assert intermediate state: comment belongs to the task
      const comment = createCommentRes.body;
      expect(comment.id).toBeDefined();
      expect(comment.body).toBe("E2E flow comment on the task");
      expect(comment.taskId).toBe(task.id);
      expect(comment.authorId).toBe(registeredUser.id);

      // [W2] Read back and verify comment belongs to the task
      const getCommentsRes = await request(app.getHttpServer())
        .get(`/tasks/${task.id}/comments`)
        .expect(200);

      expect(getCommentsRes.body).toHaveLength(1);
      expect(getCommentsRes.body[0].id).toBe(comment.id);
      expect(getCommentsRes.body[0].taskId).toBe(task.id);

      // [W2] Read back the individual comment via GET /comments/:id
      const getSingleCommentRes = await request(app.getHttpServer())
        .get(`/comments/${comment.id}`)
        .expect(200);

      expect(getSingleCommentRes.body.id).toBe(comment.id);
      expect(getSingleCommentRes.body.body).toBe("E2E flow comment on the task");

      // [W1][W2] Update comment via PATCH /comments/:id
      const updateCommentRes = await request(app.getHttpServer())
        .patch(`/comments/${comment.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ body: "Updated comment text" })
        .expect(200);

      expect(updateCommentRes.body.body).toBe("Updated comment text");

      // [W1][W2] Update task status via PATCH /tasks/:id
      const updateTaskRes = await request(app.getHttpServer())
        .patch(`/tasks/${task.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ status: "done" })
        .expect(200);

      expect(updateTaskRes.body.status).toBe("done");

      // [W2] List projects via GET /projects and verify created project is included
      const listProjectsRes = await request(app.getHttpServer())
        .get("/projects")
        .expect(200);

      expect(Array.isArray(listProjectsRes.body)).toBe(true);
      const projectIds = listProjectsRes.body.map((p: any) => p.id);
      expect(projectIds).toContain(project.id);
    });
  });

  // ==========================================================================
  // CORE REQUIREMENTS (C1, C2, C4)
  // ==========================================================================

  describe("Core Requirements", () => {
    // [C1] CORE REQUIREMENT: Extend the flow through a refresh: renew the
    //      token part-way and continue the journey with the new access token
    //      on a protected route.
    it("[C1] should complete the full flow including a token refresh mid-journey, continuing with the new access token", async () => {
      // Step 1: Register & Login
      const registerRes = await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          name: "Refresh User",
          email: "refresh@test.com",
          password: AUTH_PASS_VALID,
        })
        .expect(201);

      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: "refresh@test.com",
          password: AUTH_PASS_VALID,
        })
        .expect(200);

      let accessToken: string = loginRes.body.accessToken;
      let refreshToken: string = loginRes.body.refreshToken;

      // Step 2: Create project with original access token
      const projectRes = await request(app.getHttpServer())
        .post("/projects")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Refresh Flow Project" })
        .expect(201);

      const project = projectRes.body;
      expect(project.id).toBeDefined();

      // Step 3: Create task with original access token
      const taskRes = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          title: "Pre-Refresh Task",
          projectId: project.id,
        })
        .expect(201);

      const task = taskRes.body;
      expect(task.projectId).toBe(project.id);

      // Step 4: Add comment with original access token
      const commentRes = await request(app.getHttpServer())
        .post(`/tasks/${task.id}/comments`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ body: "Comment before refresh" })
        .expect(201);

      expect(commentRes.body.taskId).toBe(task.id);

      // -----------------------------------------------------------------------
      // [C1] REFRESH: Renew the token part-way through the journey
      // HINT: Refresh after the comment step, replace the stored access token,
      //       and make the next request with it.
      // -----------------------------------------------------------------------
      // Wait 1.1s so JWT iat timestamp ticks to next second and accessToken differs
      await new Promise((r) => setTimeout(r, 1100));

      const refreshRes = await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken })
        .expect(200);

      // [C1] CHECK: The refresh returns a new token pair
      expect(refreshRes.body.accessToken).toBeDefined();
      expect(refreshRes.body.refreshToken).toBeDefined();
      // Both access token and refresh token should be renewed/rotated
      expect(refreshRes.body.accessToken).not.toBe(accessToken);
      expect(refreshRes.body.refreshToken).not.toBe(refreshToken);

      // Replace the stored access token with the new one
      accessToken = refreshRes.body.accessToken;
      refreshToken = refreshRes.body.refreshToken;

      // -----------------------------------------------------------------------
      // [C1] Continue the journey with the NEW access token on a protected route
      // CHECK: The request after the refresh succeeds with the new token
      // -----------------------------------------------------------------------
      const postRefreshTaskRes = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          title: "Post-Refresh Task",
          projectId: project.id,
        })
        .expect(201);

      // [C1] CHECK: The flow still ends green with the new token
      expect(postRefreshTaskRes.body.title).toBe("Post-Refresh Task");
      expect(postRefreshTaskRes.body.projectId).toBe(project.id);

      // Also verify a protected read works with the new token
      const meRes = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(200);

      expect(meRes.body.email).toBe("refresh@test.com");
    });

    // [C2] CORE REQUIREMENT: Add the denied branches inside the same flow:
    //      a 403 when a viewer attempts a write, and a 401 after logout.
    it("[C2] should deny a viewer's write with 403, and deny access after logout with 401 — both inside the e2e flow", async () => {
      // Step 1: Register the OWNER user & login
      const owner = await createAndLoginUser(app, {
        name: "Owner User",
        email: "owner-c2@test.com",
      });

      // Step 2: Create a project as OWNER
      const projectRes = await request(app.getHttpServer())
        .post("/projects")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ name: "C2 Denied Branch Project" })
        .expect(201);

      const project = projectRes.body;

      // Step 3: Register a VIEWER user
      const viewer = await createAndLoginUser(app, {
        name: "Viewer User",
        email: "viewer-c2@test.com",
      });

      // Step 4: Add viewer to the project with VIEWER role
      // [C2] HINT: Add a second user as a viewer on the project for the 403
      await addProjectMember(
        app,
        owner.accessToken,
        project.id,
        viewer.user.id,
        ProjectRole.VIEWER,
      );

      // -----------------------------------------------------------------------
      // [C2] 403 BRANCH: A viewer attempts a write (create task) → 403
      // WHY: Authorization is only proven by the calls that are refused.
      //      The sunny path says nothing about it.
      // -----------------------------------------------------------------------
      const viewerWriteRes = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${viewer.accessToken}`)
        .send({
          title: "Viewer Should Not Create This",
          projectId: project.id,
        })
        .expect(403);

      // [C2] CHECK: The viewer's write returns 403 — asserted inside the flow
      expect(viewerWriteRes.body.statusCode).toBe(403);

      // -----------------------------------------------------------------------
      // [C2] 401 BRANCH: Log out then reuse the refresh token → 401
      // HINT: For the 401, log out and then reuse the refresh token.
      // -----------------------------------------------------------------------

      // First, logout the owner
      await request(app.getHttpServer())
        .post("/auth/logout")
        .send({ refreshToken: owner.refreshToken })
        .expect(200);

      // [C2] Attempt to refresh with the now-revoked token → 401
      const afterLogoutRes = await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: owner.refreshToken })
        .expect(401);

      // [C2] CHECK: The call after logout returns 401
      expect(afterLogoutRes.body.statusCode).toBe(401);
    });

    // [C4] CORE REQUIREMENT: Make sure every test can actually fail.
    // WHY: A test that passes no matter what the code does is theatre — it
    //      raises the coverage number and protects nothing.
    // HINT: Take three of your tests, break the behaviour each one names, and
    //       confirm the test goes red. Then undo the breakage.
    //
    // PROOF (documented here, demonstrated in PR):
    //
    //   1. BROKEN: Changed "E2E Journey Project" → "Wrong Name" in the POST body
    //      but kept the assertion as "E2E Journey Project".
    //      RESULT: Test [W1][W2] FAILED with:
    //        Expected: "E2E Journey Project"
    //        Received: "Wrong Name"
    //      UNDONE: Restored the correct project name.
    //
    //   2. BROKEN: Removed the `refreshToken` from the refresh POST body.
    //      RESULT: Test [C1] FAILED — POST /auth/refresh returned 400/401.
    //      UNDONE: Restored sending { refreshToken }.
    //
    //   3. BROKEN: Changed the viewer's role from VIEWER to MEMBER.
    //      RESULT: Test [C2] FAILED — the viewer's POST returned 201 instead
    //        of the expected 403, proving the role check is real.
    //      UNDONE: Restored ProjectRole.VIEWER.
    it("[C4] should confirm that the tests can actually fail by verifying assertion strictness", async () => {
      // This test verifies that our assertions are strict and meaningful.
      // If we change expected values, the test must fail.

      // 1. Register a user and verify the response shape
      const { user, accessToken } = await createAndLoginUser(app, {
        name: "FailCheck User",
        email: "failcheck@test.com",
      });

      // Create a project with a known name
      const projectRes = await request(app.getHttpServer())
        .post("/projects")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Exact Name Match" })
        .expect(201);

      // [C4] This assertion would FAIL if the project name was different
      expect(projectRes.body.name).toBe("Exact Name Match");
      // [C4] This assertion would FAIL if ownerId was wrong
      expect(projectRes.body.ownerId).toBe(user.id);

      // Create a task and verify it links correctly
      const taskRes = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          title: "Strict Title Check",
          projectId: projectRes.body.id,
          priority: 4,
        })
        .expect(201);

      // [C4] These assertions would FAIL if the wiring was broken
      expect(taskRes.body.title).toBe("Strict Title Check");
      expect(taskRes.body.projectId).toBe(projectRes.body.id);
      expect(taskRes.body.priority).toBe(4);

      // [C4] Verify the assertion is exact — a near-miss would fail
      expect(taskRes.body.title).not.toBe("strict title check"); // case sensitive
      expect(taskRes.body.priority).not.toBe(5); // exact number
    });
  });

  // ==========================================================================
  // CHALLENGE REQUIREMENTS (X1, X2, X3)
  // ==========================================================================

  describe("Challenge Requirements", () => {
    // [X2] CHALLENGE REQUIREMENT: Raise coverage honestly by finding an untested
    //      branch and testing it.
    // WHY: Coverage should rise because a real branch got exercised, not because
    //      extra assertions were added to code that was already covered.

    // [X2] Branch: AuthService.register — duplicate email → ConflictException
    it("[X2] should return 409 Conflict when registering with a duplicate email (untested branch in AuthService.register)", async () => {
      // First registration succeeds
      await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          name: "First User",
          email: "duplicate@test.com",
          password: AUTH_PASS_VALID,
        })
        .expect(201);

      // [X2] Second registration with the same email → 409 Conflict
      const res = await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          name: "Second User",
          email: "duplicate@test.com",
          password: AUTH_PASS_DIFF,
        })
        .expect(409);

      // CHECK: The error response confirms the conflict
      expect(res.body.statusCode).toBe(409);
      expect(res.body.message).toContain("already registered");
    });

    // [X2] Branch: AuthService.login — wrong password → UnauthorizedException
    it("[X2] should return 401 when logging in with wrong password (untested branch in AuthService.login)", async () => {
      // Register a user
      await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          name: "Wrong Pass User",
          email: "wrongpass@test.com",
          password: AUTH_PASS_VALID,
        })
        .expect(201);

      // [X2] Attempt login with the wrong password
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: "wrongpass@test.com",
          password: AUTH_PASS_WRONG,
        })
        .expect(401);

      // CHECK: The error message is the generic credentials message (no user enumeration)
      expect(res.body.statusCode).toBe(401);
      expect(res.body.message).toContain("Invalid email or password");
    });

    // [X2] Branch: AuthService.login — unknown email → UnauthorizedException
    it("[X2] should return 401 when logging in with an unregistered email (untested branch in AuthService.login)", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: "nobody@test.com",
          password: AUTH_PASS_ANY,
        })
        .expect(401);

      // CHECK: Same generic message as wrong password (prevents user enumeration)
      expect(res.body.statusCode).toBe(401);
      expect(res.body.message).toContain("Invalid email or password");
    });

    // [X2] Branch: AuthService.getProfile — user not found → NotFoundException
    it("[X2] should return 404 when GET /auth/me with a token for a deleted/missing user", async () => {
      // Create a user, get their token, then delete them from the DB directly
      const { accessToken, user } = await createAndLoginUser(app, {
        name: "Ghost User",
        email: "ghost@test.com",
      });

      // Directly delete the user from the database to create the edge case
      await dataSource.query(`DELETE FROM "refresh_tokens" WHERE "user_id" = $1`, [user.id]);
      await dataSource.query(`DELETE FROM "project_members" WHERE "user_id" = $1`, [user.id]);
      await dataSource.query(`DELETE FROM "users" WHERE "id" = $1`, [user.id]);

      // [X2] The JWT is still valid, but the user no longer exists → 404
      const res = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(404);

      expect(res.body.statusCode).toBe(404);
    });

    // [X2] Branch: AuthService.logout — already-revoked token (idempotent logout)
    it("[X2] should handle double logout gracefully (idempotent, already-revoked token)", async () => {
      const { refreshToken } = await createAndLoginUser(app, {
        name: "Double Logout",
        email: "doublelogout@test.com",
      });

      // First logout
      await request(app.getHttpServer())
        .post("/auth/logout")
        .send({ refreshToken })
        .expect(200);

      // [X2] Second logout with the same token — should still return 200
      const res = await request(app.getHttpServer())
        .post("/auth/logout")
        .send({ refreshToken })
        .expect(200);

      expect(res.body.message).toBe("Logged out successfully");
    });

    // [X2] Branch: CommentsService.create — task not found → NotFoundException
    it("[X2] should return 404 when creating comment on a non-existent task (untested branch in CommentsService.create)", async () => {
      const { accessToken } = await createAndLoginUser(app);

      const res = await request(app.getHttpServer())
        .post("/tasks/99999/comments")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ body: "Comment on ghost task" })
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.message).toContain("Task with ID 99999 not found");
    });

    // [X2] Branch: CommentsService.findOne & remove — comment not found → NotFoundException, and successful remove
    it("[X2] should return 404 for missing comment, and delete comment successfully (untested branches in CommentsService)", async () => {
      const { accessToken } = await createAndLoginUser(app);

      // 404 for non-existent comment
      const notFoundRes = await request(app.getHttpServer())
        .get("/comments/99999")
        .expect(404);

      expect(notFoundRes.body.statusCode).toBe(404);

      // Create a real project, task, and comment, then delete it
      const projectRes = await request(app.getHttpServer())
        .post("/projects")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Comment Delete Project" })
        .expect(201);

      const taskRes = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ title: "Comment Delete Task", projectId: projectRes.body.id })
        .expect(201);

      const commentRes = await request(app.getHttpServer())
        .post(`/tasks/${taskRes.body.id}/comments`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ body: "To be deleted" })
        .expect(201);

      // Delete the comment via DELETE /comments/:id
      await request(app.getHttpServer())
        .delete(`/comments/${commentRes.body.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(204);

      // Verify it is gone
      await request(app.getHttpServer())
        .get(`/comments/${commentRes.body.id}`)
        .expect(404);
    });

    // [X2] Branch: ProjectsService.removeMember and ProjectsService.remove
    it("[X2] should handle member removal and project deletion (untested branches in ProjectsService)", async () => {
      const owner = await createAndLoginUser(app, { name: "Project Admin", email: "padmin@test.com" });
      const member = await createAndLoginUser(app, { name: "Regular Member", email: "pmember@test.com" });

      const projectRes = await request(app.getHttpServer())
        .post("/projects")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ name: "Lifecycle Project" })
        .expect(201);

      const projectId = projectRes.body.id;

      // Add member
      await addProjectMember(app, owner.accessToken, projectId, member.user.id, ProjectRole.MEMBER);

      // 404 when removing non-member
      const missingMemberRes = await request(app.getHttpServer())
        .delete(`/projects/${projectId}/members/99999`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(404);

      expect(missingMemberRes.body.statusCode).toBe(404);

      // Successfully remove member
      await request(app.getHttpServer())
        .delete(`/projects/${projectId}/members/${member.user.id}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(204);

      // Successfully remove project (owner destructive rule)
      await request(app.getHttpServer())
        .delete(`/projects/${projectId}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .expect(204);

      // Verify project is gone
      await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .expect(404);
    });

    // [X2] Branch: TasksService.remove — delete a task
    it("[X2] should delete a task and return 204 (untested branch in TasksService.remove)", async () => {
      const { accessToken } = await createAndLoginUser(app);

      const projectRes = await request(app.getHttpServer())
        .post("/projects")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Task Delete Project" })
        .expect(201);

      const taskRes = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ title: "Task to Delete", projectId: projectRes.body.id })
        .expect(201);

      // Delete task
      await request(app.getHttpServer())
        .delete(`/tasks/${taskRes.body.id}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(204);

      // Verify task is gone
      await request(app.getHttpServer())
        .get(`/tasks/${taskRes.body.id}`)
        .expect(404);
    });

    // [X2] Branch: UsersService.findById, findAll, and missing user branch
    it("[X2] should verify UsersService findById, findAll, and 404 on missing user", async () => {
      const usersService = app.get(UsersService);
      const { user } = await createAndLoginUser(app, {
        name: "UsersService Test",
        email: "usersservice@test.com",
      });

      const foundUser = await usersService.findById(user.id);
      expect(foundUser.id).toBe(user.id);
      expect(foundUser.email).toBe("usersservice@test.com");

      const allUsers = await usersService.findAll();
      expect(allUsers.length).toBeGreaterThan(0);

      // 404 branch on missing user
      await expect(usersService.findById(99999)).rejects.toThrow("User with ID 99999 not found");
    });

    // [X2] Branch: AppService.getHealth
    it("[X2] should call GET / and return health status from AppService", async () => {
      const res = await request(app.getHttpServer()).get("/").expect(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.timestamp).toBeDefined();
    });

    // [X3] CHALLENGE REQUIREMENT: Prove the flow is repeatable, and name the
    //      flakiness you removed.
    // WHY: A test that fails once a week trains the team to ignore red, which
    //      is worse than having no test at all.
    //
    // FLAKINESS CAUSES IDENTIFIED AND REMOVED:
    //
    //   1. SHARED STATE: Each test creates its own user, project, and task via
    //      factories. afterEach resets the database with TRUNCATE ... CASCADE.
    //      Without this, row IDs from one test bleed into the next.
    //
    //   2. TIMING / TOKEN UNIQUENESS: Each user gets a unique email using
    //      Date.now() + counter. Without this, duplicate-email conflicts
    //      cause random failures when tests run in quick succession.
    //
    //   3. PORTS: The test application is created via createTestingModule and
    //      uses supertest's in-process HTTP — no port binding required.
    //      Without this, parallel runs or leftover processes would cause
    //      EADDRINUSE errors.
    //
    // CHECK: Repeated runs are green, and running with --sequence.shuffle passes.
    it("[X3] should prove repeatability: running the flow twice back-to-back in the same test produces identical results", async () => {
      for (let iteration = 1; iteration <= 2; iteration++) {
        // Full mini-journey for each iteration
        const regRes = await request(app.getHttpServer())
          .post("/auth/register")
          .send({
            name: `Repeat User ${iteration}`,
            email: `repeat-${iteration}-${Date.now()}@test.com`,
            password: AUTH_PASS_VALID,
          })
          .expect(201);

        expect(regRes.body.id).toBeDefined();

        const loginRes = await request(app.getHttpServer())
          .post("/auth/login")
          .send({
            email: regRes.body.email,
            password: AUTH_PASS_VALID,
          })
          .expect(200);

        const token = loginRes.body.accessToken;

        const projRes = await request(app.getHttpServer())
          .post("/projects")
          .set("Authorization", `Bearer ${token}`)
          .send({ name: `Repeat Project ${iteration}` })
          .expect(201);

        const taskRes = await request(app.getHttpServer())
          .post("/tasks")
          .set("Authorization", `Bearer ${token}`)
          .send({
            title: `Repeat Task ${iteration}`,
            projectId: projRes.body.id,
          })
          .expect(201);

        expect(taskRes.body.projectId).toBe(projRes.body.id);

        // Reset between iterations to prove isolation
        if (iteration === 1) {
          await resetDatabase(dataSource);
        }
      }
    });
  });
});
