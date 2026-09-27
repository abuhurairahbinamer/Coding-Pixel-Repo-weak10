// ============================================================================
// Week 10 Assignment 1: Integration Tests with Supertest
// ----------------------------------------------------------------------------
// [W1] WARM-UP REQUIREMENT: Separate test database configured via environment
// [W2] WARM-UP REQUIREMENT: Reset table data between tests for known state
// [C1] CORE REQUIREMENT: First integration test: create resource and read it back
// [C2] CORE REQUIREMENT: 400 invalid body and 401 unauthenticated write paths
// [C3] CORE REQUIREMENT: 404 on missing resource for GET, PATCH, and DELETE
// [C4] CORE REQUIREMENT: Independent tests using shared factories / helpers
// [X1] CHALLENGE REQUIREMENT: Test combinable filters with deliberate near-misses
// [X2] CHALLENGE REQUIREMENT: Reject unknown fields over HTTP (forbidNonWhitelisted)
// [X3] CHALLENGE REQUIREMENT: Abort when pointed at non-test database
// ============================================================================
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module.js";
import { AllExceptionsFilter } from "../src/common/filters/http-exception.filter.js";
import { TaskStatus } from "../src/common/enums/task-status.enum.js";
import { assertTestDatabase } from "./setup/database-guard.js";
import { resetDatabase, getTotalRowCount } from "./setup/test-database.js";
import {
  createAndLoginUser,
  createTestProject,
  createTestTask,
  createTestComment,
} from "./helpers/test-factories.js";

describe("Assignment 1 — Integration Tests with Supertest", () => {
  let app: INestApplication;
  let dataSource: DataSource;

  // --------------------------------------------------------------------------
  // [W1] & [C1] Bootstrap the Nest application with exact pipes & filters
  // --------------------------------------------------------------------------
  beforeAll(async () => {
    // [W1] & [X3] Enforce that the test suite is strictly running on test database
    assertTestDatabase(process.env.DB_NAME);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // [C1] Apply the exact global pipes and filters used in main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true, // [X2] Security control rejecting unknown properties
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter()); // [C1] & [C2] Consistent error shape

    await app.init();

    dataSource = app.get(DataSource);

    // Initial wipe before running tests to ensure a clean slate
    await resetDatabase(dataSource);
  }, 30000);

  // --------------------------------------------------------------------------
  // [W2] Reset the data between tests so every test starts from a known state
  // --------------------------------------------------------------------------
  afterEach(async () => {
    // [W2] Truncate tables with cascade and restart identity after every test
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
    // [W1] WARM-UP REQUIREMENT: Separate test database configured through environment
    it("[W1] should run against the dedicated test database 'assignment1_test' with migrations applied", async () => {
      // CHECK: The active database is strictly 'assignment1_test', not the development database 'assignment1'
      const activeDb = (dataSource.options as any).database;
      expect(activeDb).toBe("assignment1_test");
      expect(activeDb).not.toBe("assignment1");

      // Verify that migration tables and domain tables exist
      const tables: Array<{ table_name: string }> = await dataSource.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `);
      const tableNames = tables.map((t) => t.table_name);

      expect(tableNames).toContain("migrations");
      expect(tableNames).toContain("users");
      expect(tableNames).toContain("projects");
      expect(tableNames).toContain("tasks");
      expect(tableNames).toContain("comments");
      expect(tableNames).toContain("refresh_tokens");
    });

    // [W2] WARM-UP REQUIREMENT: Reset data between tests so each test starts fresh
    it("[W2] should start with an empty database state and leave zero leftover rows after reset", async () => {
      // Step 1: In this test, create resources
      const initialCount = await getTotalRowCount(dataSource);
      expect(initialCount).toBe(0);

      const { accessToken } = await createAndLoginUser(app);
      const project = await createTestProject(app, accessToken);
      await createTestTask(app, accessToken, project.id);

      const populatedCount = await getTotalRowCount(dataSource);
      expect(populatedCount).toBeGreaterThan(0);

      // Step 2: Call resetDatabase explicitly to verify it resets cleanly
      await resetDatabase(dataSource);
      const countAfterReset = await getTotalRowCount(dataSource);
      expect(countAfterReset).toBe(0);
    });

    // [W2] Second test proving table counts are untouched by previous test
    it("[W2] should confirm that no rows survive into subsequent tests (no flaky leftovers)", async () => {
      // CHECK: Row count at the start of this test MUST be 0
      const rowCount = await getTotalRowCount(dataSource);
      expect(rowCount).toBe(0);
    });
  });

  // ==========================================================================
  // CORE REQUIREMENTS (C1, C2, C3, C4)
  // ==========================================================================

  describe("Core Requirements", () => {
    // [C1] CORE REQUIREMENT: Create a resource through HTTP and read it back
    it("[C1] should create a resource via POST and read it back via GET asserting status and body", async () => {
      // Setup authenticated user via factory
      const { accessToken, user } = await createAndLoginUser(app);

      // 1. Create a project via POST /projects
      const createProjectRes = await request(app.getHttpServer())
        .post("/projects")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ name: "Core C1 Integration Project" })
        .expect(201); // CHECK: POST returns 201 with created resource

      const createdProject = createProjectRes.body;
      expect(createdProject).toBeDefined();
      expect(createdProject.id).toBeDefined();
      expect(createdProject.name).toBe("Core C1 Integration Project");
      expect(createdProject.ownerId).toBe(user.id);

      // 2. Read back the created project via GET /projects/:id
      const getProjectRes = await request(app.getHttpServer())
        .get(`/projects/${createdProject.id}`)
        .expect(200); // CHECK: GET returns 200 with the asserted resource

      expect(getProjectRes.body.id).toBe(createdProject.id);
      expect(getProjectRes.body.name).toBe("Core C1 Integration Project");
      expect(getProjectRes.body.ownerId).toBe(user.id);

      // 3. Create a task in that project via POST /tasks
      const createTaskRes = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          title: "Core C1 Task",
          description: "Integration test for C1",
          status: TaskStatus.IN_PROGRESS,
          priority: 3,
          projectId: createdProject.id,
        })
        .expect(201);

      const createdTask = createTaskRes.body;
      expect(createdTask.id).toBeDefined();
      expect(createdTask.title).toBe("Core C1 Task");
      expect(createdTask.description).toBe("Integration test for C1");
      expect(createdTask.status).toBe(TaskStatus.IN_PROGRESS);
      expect(createdTask.priority).toBe(3);
      expect(createdTask.projectId).toBe(createdProject.id);

      // 4. Read back the task via GET /tasks/:id
      const getTaskRes = await request(app.getHttpServer())
        .get(`/tasks/${createdTask.id}`)
        .expect(200);

      expect(getTaskRes.body.id).toBe(createdTask.id);
      expect(getTaskRes.body.title).toBe("Core C1 Task");
      expect(getTaskRes.body.status).toBe(TaskStatus.IN_PROGRESS);
      expect(getTaskRes.body.priority).toBe(3);
    });

    // [C2] CORE REQUIREMENT: Cover 400 and 401 error paths
    it("[C2] should return 401 with standard error shape when writing without a token", async () => {
      // CHECK: POST without Authorization header returns 401
      const res = await request(app.getHttpServer())
        .post("/projects")
        .send({ name: "Unauthenticated Project" })
        .expect(401);

      // CHECK: Assert standard 5-field error shape
      expect(res.body).toMatchObject({
        statusCode: 401,
        message: "Unauthorized",
        error: "Unauthorized",
      });
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.path).toBe("/projects");
    });

    it("[C2] should return 400 with standard error shape when writing with an invalid body", async () => {
      const { accessToken, user } = await createAndLoginUser(app);
      const project = await createTestProject(app, accessToken);

      // Invalid body: priority out of range (e.g. 99, valid is 1..5) and missing title
      const res = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({
          projectId: project.id,
          priority: 99, // Fails @Min(1) @Max(5)
        })
        .expect(400);

      // CHECK: Assert status 400 and error response body shape
      expect(res.body.statusCode).toBe(400);
      expect(res.body.error).toBe("Bad Request");
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.path).toBe("/tasks");
      expect(res.body.message).toBeDefined();
    });

    // [C3] CORE REQUIREMENT: Cover 404 for a non-existent resource on read, update, delete
    it("[C3] should return 404 with standard error shape on GET for a missing resource", async () => {
      const missingId = 99999; // Format valid integer, but absent from DB

      const res = await request(app.getHttpServer())
        .get(`/tasks/${missingId}`)
        .expect(404);

      // CHECK: Missing row returns 404 with error shape
      expect(res.body).toMatchObject({
        statusCode: 404,
        error: "Not Found",
      });
      expect(res.body.message).toContain(`Task with ID ${missingId} not found`);
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.path).toBe(`/tasks/${missingId}`);
    });

    it("[C3] should return 404 with standard error shape on PATCH for a missing resource", async () => {
      const { accessToken } = await createAndLoginUser(app);
      const missingId = 99999;

      const res = await request(app.getHttpServer())
        .patch(`/tasks/${missingId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ title: "Updated Title" })
        .expect(404);

      // CHECK: PATCH on missing id returns 404 with error shape
      expect(res.body).toMatchObject({
        statusCode: 404,
        error: "Not Found",
      });
      expect(res.body.message).toContain(`Task with ID ${missingId} not found`);
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.path).toBe(`/tasks/${missingId}`);
    });

    it("[C3] should return 404 with standard error shape on DELETE for a missing resource", async () => {
      const { accessToken } = await createAndLoginUser(app);
      const missingId = 99999;

      const res = await request(app.getHttpServer())
        .delete(`/tasks/${missingId}`)
        .set("Authorization", `Bearer ${accessToken}`)
        .expect(404);

      // CHECK: DELETE on missing id returns 404 with error shape
      expect(res.body).toMatchObject({
        statusCode: 404,
        error: "Not Found",
      });
      expect(res.body.message).toContain(`Task with ID ${missingId} not found`);
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.path).toBe(`/tasks/${missingId}`);
    });

    // [C4] CORE REQUIREMENT: Independent tests with shared factories and helpers
    it("[C4] should prove complete test independence: creates own user, project, and task without shared module state", async () => {
      // Independent call 1: creates User A and Project A
      const userA = await createAndLoginUser(app);
      const projectA = await createTestProject(app, userA.accessToken, { name: "Project A" });
      const taskA = await createTestTask(app, userA.accessToken, projectA.id, { title: "Task A" });

      // Independent call 2: creates User B and Project B
      const userB = await createAndLoginUser(app);
      const projectB = await createTestProject(app, userB.accessToken, { name: "Project B" });
      const taskB = await createTestTask(app, userB.accessToken, projectB.id, { title: "Task B" });

      // Assert each resource belongs exclusively to its own setup
      expect(taskA.projectId).toBe(projectA.id);
      expect(taskB.projectId).toBe(projectB.id);
      expect(taskA.creatorId).toBe(userA.user.id);
      expect(taskB.creatorId).toBe(userB.user.id);
    });
  });

  // ==========================================================================
  // CHALLENGE REQUIREMENTS (X1, X2, X3)
  // ==========================================================================

  describe("Challenge Requirements", () => {
    // [X1] CHALLENGE REQUIREMENT: Test combinable filters through real requests
    it("[X1] should filter tasks by ?status=todo&projectId=:id returning only matching rows and excluding near-misses", async () => {
      const { accessToken } = await createAndLoginUser(app);

      // Seed Project 1 and Project 2
      const project1 = await createTestProject(app, accessToken, { name: "Filter Project 1" });
      const project2 = await createTestProject(app, accessToken, { name: "Filter Project 2" });

      // 1. Target Task: Project 1 AND Status TODO (Should match both)
      const targetTask = await createTestTask(app, accessToken, project1.id, {
        title: "Target: Project1 Todo",
        status: TaskStatus.TODO,
      });

      // 2. Near-miss 1: Matches Project 1, but status is IN_PROGRESS (NOT todo)
      const nearMissStatus = await createTestTask(app, accessToken, project1.id, {
        title: "Near-Miss 1: Project1 InProgress",
        status: TaskStatus.IN_PROGRESS,
      });

      // 3. Near-miss 2: Matches status TODO, but belongs to Project 2 (NOT project1)
      const nearMissProject = await createTestTask(app, accessToken, project2.id, {
        title: "Near-Miss 2: Project2 Todo",
        status: TaskStatus.TODO,
      });

      // 4. Near-miss 3: Project 2 AND status DONE (Matches neither)
      const nearMissBoth = await createTestTask(app, accessToken, project2.id, {
        title: "Near-Miss 3: Project2 Done",
        status: TaskStatus.DONE,
      });

      // Execute combined filter request: ?status=todo&projectId=project1.id
      const res = await request(app.getHttpServer())
        .get(`/tasks?status=todo&projectId=${project1.id}`)
        .expect(200);

      const items = res.body.items;
      const returnedIds = items.map((t: any) => t.id);

      // CHECK: ?status=todo&projectId=1 returns ONLY the rows matching both
      expect(res.body.total).toBe(1);
      expect(items).toHaveLength(1);
      expect(returnedIds).toContain(targetTask.id);

      // CHECK: Deliberately near-miss rows are absent
      expect(returnedIds).not.toContain(nearMissStatus.id);
      expect(returnedIds).not.toContain(nearMissProject.id);
      expect(returnedIds).not.toContain(nearMissBoth.id);
    });

    // [X2] CHALLENGE REQUIREMENT: Prove over HTTP that an unknown field is rejected
    it("[X2] should reject unknown fields with 400 Bad Request and not store the unwhitelisted data", async () => {
      const { accessToken } = await createAndLoginUser(app);
      const project = await createTestProject(app, accessToken);

      const payloadWithUnknownField = {
        title: "Legitimate Task Title",
        projectId: project.id,
        role: "admin", // Unknown field: not in CreateTaskDto
        isAdmin: true, // Unknown field: privilege escalation attempt
        hackPayload: "malicious_data", // Unknown field
      };

      // CHECK: POST returns 400 when unknown field is supplied (forbidNonWhitelisted)
      const res = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${accessToken}`)
        .send(payloadWithUnknownField)
        .expect(400);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.error).toBe("Bad Request");

      // Verify error message names the forbidden property
      const msgStr = Array.isArray(res.body.message)
        ? res.body.message.join(" ")
        : String(res.body.message);
      expect(msgStr).toMatch(/property (role|isAdmin|hackPayload) should not exist/i);

      // CHECK: No row in the database carries the extra field's value or was created
      const dbCheck = await dataSource.query(`
        SELECT * FROM "tasks" WHERE "title" = 'Legitimate Task Title';
      `);
      expect(dbCheck).toHaveLength(0);
    });

    // [X3] CHALLENGE REQUIREMENT: Database Safety Guard prevents running against non-test DB
    it("[X3] should confirm that database guard protects development database 'assignment1'", () => {
      // CHECK: Pointing the test environment at the development database makes the suite refuse to start
      expect(() => assertTestDatabase("assignment1")).toThrowError(
        /Refusing to run tests against database 'assignment1'/
      );
      expect(() => assertTestDatabase("development")).toThrowError(
        /Refusing to run tests against database 'development'/
      );
      // Legitimate test database passes
      expect(() => assertTestDatabase("assignment1_test")).not.toThrow();
    });
  });
});
