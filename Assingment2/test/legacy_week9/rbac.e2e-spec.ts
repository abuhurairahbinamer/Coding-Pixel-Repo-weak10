// ============================================================================
// WEEK 9 ASSIGNMENT 2: RBAC AND GUARDS E2E TEST SUITE
// Covers:
// - [W1] Write routes protected by JwtAuthGuard (401 without valid Bearer token)
// - [W2] @CurrentUser() binds authenticated caller to created resource (ignores body claim)
// - [C1] RolesGuard reads role from project_members; viewer gets 403, owner/admin/member succeed
// - [C2] Destructive rule: only owner or admin can delete a project (member gets 403, owner gets 204)
// - [C3] Cross-project isolation: role on project A grants nothing on project B (gets 403)
// - [C4] Guard ordering: unauthenticated request to role route returns 401, not 403
// - [C5] E2E proving both paths on the same route (403 for role violation, 200/201 for allowed role)
// - [X1] Resource-ownership guard: member editing another member's task gets 403; assignee & owner succeed
// - [X2] Invert default: global JwtAuthGuard requires token by default; @Public() routes bypass
// - [X3] RoleCacheService: cache hits on repeated requests and immediate invalidation on membership change
// ============================================================================
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { User } from "../src/entities/user.entity.js";
import { Project } from "../src/entities/project.entity.js";
import { ProjectMember } from "../src/entities/project-member.entity.js";
import { Task } from "../src/entities/task.entity.js";
import { ProjectRole } from "../src/common/enums/project-role.enum.js";
import { RoleCacheService } from "../src/projects/role-cache.service.js";
import { AppThrottlerStorage } from "../src/common/throttler/app-throttler-storage.js";

describe("Week 9 Assignment 2: RBAC and Guards (e2e)", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let roleCacheService: RoleCacheService;

  // Test users
  let ownerUser: { id: number; token: string; email: string };
  let adminUser: { id: number; token: string; email: string };
  let memberUser1: { id: number; token: string; email: string };
  let memberUser2: { id: number; token: string; email: string };
  let viewerUser: { id: number; token: string; email: string };
  let outsiderUser: { id: number; token: string; email: string };

  // Test projects & resources
  let projectA: Project;
  let projectB: Project;
  let taskA: Task;

  const timestamp = Date.now();

  // Helper to register and login a test user
  async function createAndLoginUser(prefix: string): Promise<{ id: number; token: string; email: string }> {
    AppThrottlerStorage.reset();
    const email = `${prefix}_${timestamp}_${Math.random().toString(36).substring(7)}@example.com`;
    const password = "Password123!";

    const regRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ name: prefix, email, password })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password })
      .expect(200);

    return {
      id: regRes.body.id,
      token: loginRes.body.accessToken,
      email,
    };
  }

  beforeEach(() => {
    // [C5] Isolate throttler state between tests
    AppThrottlerStorage.reset();
  });

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.ARGON2_TIME_COST = "1";
    process.env.ARGON2_MEMORY_COST = "1024";
    process.env.ARGON2_PARALLELISM = "1";

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    dataSource = app.get(DataSource);
    roleCacheService = app.get(RoleCacheService);

    // Create test accounts
    ownerUser = await createAndLoginUser("owner");
    adminUser = await createAndLoginUser("admin");
    memberUser1 = await createAndLoginUser("member1");
    memberUser2 = await createAndLoginUser("member2");
    viewerUser = await createAndLoginUser("viewer");
    outsiderUser = await createAndLoginUser("outsider");

    // Seed Project A created by ownerUser
    const projRes = await request(app.getHttpServer())
      .post("/projects")
      .set("Authorization", `Bearer ${ownerUser.token}`)
      .send({ name: `Project A ${timestamp}`, ownerId: 9999 }) // [W2] ownerId should be ignored
      .expect(201);

    projectA = projRes.body;

    // Seed Project B created by outsiderUser
    const projBRes = await request(app.getHttpServer())
      .post("/projects")
      .set("Authorization", `Bearer ${outsiderUser.token}`)
      .send({ name: `Project B ${timestamp}` })
      .expect(201);

    projectB = projBRes.body;

    // Add members to Project A
    const memberRepo = dataSource.getRepository(ProjectMember);
    await memberRepo.save([
      { userId: adminUser.id, projectId: projectA.id, role: ProjectRole.ADMIN },
      { userId: memberUser1.id, projectId: projectA.id, role: ProjectRole.MEMBER },
      { userId: memberUser2.id, projectId: projectA.id, role: ProjectRole.MEMBER },
      { userId: viewerUser.id, projectId: projectA.id, role: ProjectRole.VIEWER },
    ]);

    // Clear role cache to start fresh
    roleCacheService.clear();
  });

  afterAll(async () => {
    if (dataSource && dataSource.isInitialized) {
      // Clean up test data
      const projectRepo = dataSource.getRepository(Project);
      if (projectA?.id) await projectRepo.delete(projectA.id);
      if (projectB?.id) await projectRepo.delete(projectB.id);

      const userRepo = dataSource.getRepository(User);
      const userIds = [
        ownerUser?.id,
        adminUser?.id,
        memberUser1?.id,
        memberUser2?.id,
        viewerUser?.id,
        outsiderUser?.id,
      ].filter(Boolean);

      for (const uid of userIds) {
        await userRepo.delete(uid);
      }
    }
    await app.close();
  });

  // ==========================================================================
  // [W1] WARM-UP: Gating all write routes with JwtAuthGuard (401 without token)
  // ==========================================================================
  describe("[W1] Warm-Up: Write Route Authentication", () => {
    it("returns 401 for POST /tasks without Bearer token", async () => {
      await request(app.getHttpServer())
        .post("/tasks")
        .send({ title: "Unauthorized Task", projectId: projectA.id })
        .expect(401);
    });

    it("returns 401 for PATCH /tasks/:id without Bearer token", async () => {
      await request(app.getHttpServer())
        .patch(`/tasks/1`)
        .send({ title: "Updated Title" })
        .expect(401);
    });

    it("returns 401 for DELETE /tasks/:id without Bearer token", async () => {
      await request(app.getHttpServer())
        .delete(`/tasks/1`)
        .expect(401);
    });

    it("returns 401 for POST /projects without Bearer token", async () => {
      await request(app.getHttpServer())
        .post("/projects")
        .send({ name: "Unauthorized Project" })
        .expect(401);
    });

    it("returns 401 for DELETE /projects/:id without Bearer token", async () => {
      await request(app.getHttpServer())
        .delete(`/projects/${projectA.id}`)
        .expect(401);
    });

    it("returns 401 for POST /tasks/:taskId/comments without Bearer token", async () => {
      await request(app.getHttpServer())
        .post(`/tasks/1/comments`)
        .send({ body: "Unauthorized comment" })
        .expect(401);
    });

    it("returns 401 for PATCH /comments/:id without Bearer token", async () => {
      await request(app.getHttpServer())
        .patch(`/comments/1`)
        .send({ body: "Updated comment" })
        .expect(401);
    });

    it("returns 401 for DELETE /comments/:id without Bearer token", async () => {
      await request(app.getHttpServer())
        .delete(`/comments/1`)
        .expect(401);
    });
  });

  // ==========================================================================
  // [C4] CORE: Guard ordering: JwtAuthGuard executes before RolesGuard
  // ==========================================================================
  describe("[C4] Core: Guard Ordering (401 before 403)", () => {
    it("returns 401 (not 403) when an unauthenticated request calls a role-restricted route", async () => {
      // DELETE /projects/:id requires owner/admin role. Without token, it MUST return 401, NOT 403.
      const res = await request(app.getHttpServer())
        .delete(`/projects/${projectA.id}`)
        .expect(401);

      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // [W2] WARM-UP: @CurrentUser() identity binding
  // ==========================================================================
  describe("[W2] Warm-Up: @CurrentUser() Identity Binding", () => {
    it("binds created project ownerId to authenticated caller and ignores client body claim", async () => {
      expect(projectA.ownerId).toBe(ownerUser.id);
      expect(projectA.ownerId).not.toBe(9999);
    });

    it("binds created task creatorId to authenticated caller and ignores client body claim", async () => {
      const res = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${memberUser1.token}`)
        .send({
          title: "Task by Member 1",
          projectId: projectA.id,
          userId: 9999,
          creatorId: 9999,
        })
        .expect(201);

      taskA = res.body;
      expect(taskA.creatorId).toBe(memberUser1.id);
      expect(taskA.creatorId).not.toBe(9999);
    });

    it("binds created comment authorId to authenticated caller", async () => {
      const res = await request(app.getHttpServer())
        .post(`/tasks/${taskA.id}/comments`)
        .set("Authorization", `Bearer ${memberUser2.token}`)
        .send({
          body: "Comment from Member 2",
          authorId: 9999,
        })
        .expect(201);

      expect(res.body.authorId).toBe(memberUser2.id);
      expect(res.body.authorId).not.toBe(9999);
    });
  });

  // ==========================================================================
  // [C1] & [C5] CORE: Project role enforcement (Viewer 403 vs Allowed Role)
  // ==========================================================================
  describe("[C1] & [C5] Core: Project Role Authorization & Denied Path Verification", () => {
    it("viewer creating a task receives 403 Forbidden [C1, C5]", async () => {
      const res = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${viewerUser.token}`)
        .send({
          title: "Viewer Task Attempt",
          projectId: projectA.id,
        })
        .expect(403);

      expect(res.body.message).toContain("Role 'viewer' is not authorized");
    });

    it("owner creating a task succeeds with 201 Created [C1, C5]", async () => {
      const res = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .send({
          title: "Owner Task Creation",
          projectId: projectA.id,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe("Owner Task Creation");
    });

    it("updating user's row in project_members changes access dynamically without restart [C1]", async () => {
      // 1. Initially viewer is 403
      await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${viewerUser.token}`)
        .send({ title: "Viewer Try 1", projectId: projectA.id })
        .expect(403);

      // 2. Elevate viewer to member via project membership API
      await request(app.getHttpServer())
        .post(`/projects/${projectA.id}/members`)
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .send({ userId: viewerUser.id, role: ProjectRole.MEMBER })
        .expect(201);

      // 3. Same user with same token can now create task successfully
      const res = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${viewerUser.token}`)
        .send({ title: "Elevated Member Task", projectId: projectA.id })
        .expect(201);

      expect(res.body.id).toBeDefined();

      // Reset back to viewer
      await request(app.getHttpServer())
        .post(`/projects/${projectA.id}/members`)
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .send({ userId: viewerUser.id, role: ProjectRole.VIEWER })
        .expect(201);
    });
  });

  // ==========================================================================
  // [C2] CORE: Destructive rule: only owner or admin may delete a project
  // ==========================================================================
  describe("[C2] Core: Destructive Rule (Project Deletion)", () => {
    it("member attempting to delete a project receives 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .delete(`/projects/${projectA.id}`)
        .set("Authorization", `Bearer ${memberUser1.token}`)
        .expect(403);
    });

    it("viewer attempting to delete a project receives 403 Forbidden", async () => {
      await request(app.getHttpServer())
        .delete(`/projects/${projectA.id}`)
        .set("Authorization", `Bearer ${viewerUser.token}`)
        .expect(403);
    });

    it("admin deleting a separate project succeeds with 204 No Content", async () => {
      // Create temporary project and add adminUser as admin
      const tempRes = await request(app.getHttpServer())
        .post("/projects")
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .send({ name: `Admin Delete Test ${timestamp}` })
        .expect(201);

      const tempProjId = tempRes.body.id;

      await request(app.getHttpServer())
        .post(`/projects/${tempProjId}/members`)
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .send({ userId: adminUser.id, role: ProjectRole.ADMIN })
        .expect(201);

      // Admin deletes project -> 204 No Content
      await request(app.getHttpServer())
        .delete(`/projects/${tempProjId}`)
        .set("Authorization", `Bearer ${adminUser.token}`)
        .expect(204);
    });
  });

  // ==========================================================================
  // [C3] CORE: Cross-project isolation: role on project A grants nothing on project B
  // ==========================================================================
  describe("[C3] Core: Cross-Project Isolation (Anti-Confused Deputy)", () => {
    let taskB: Task;

    beforeAll(async () => {
      // outsiderUser creates task in Project B
      const res = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${outsiderUser.token}`)
        .send({ title: "Task in Project B", projectId: projectB.id })
        .expect(201);
      taskB = res.body;
    });

    it("user who owns project A cannot update a task belonging to project B", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/tasks/${taskB.id}`)
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .send({ title: "Malicious Cross-Project Edit" })
        .expect(403);

      expect(res.body.message).toContain("You are not a member of this project");
    });

    it("user who owns project A cannot delete a task belonging to project B", async () => {
      await request(app.getHttpServer())
        .delete(`/tasks/${taskB.id}`)
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .expect(403);
    });

    it("user who owns project A cannot comment on a task belonging to project B", async () => {
      await request(app.getHttpServer())
        .post(`/tasks/${taskB.id}/comments`)
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .send({ body: "Malicious Comment on Project B" })
        .expect(403);
    });
  });

  // ==========================================================================
  // [X1] CHALLENGE: Resource-ownership guard (Task creator / assignee / owner override)
  // ==========================================================================
  describe("[X1] Challenge: Resource Ownership Guard (TaskOwnershipGuard)", () => {
    let ownedTask: Task;

    beforeAll(async () => {
      // memberUser1 creates a task assigned to memberUser2
      const res = await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${memberUser1.token}`)
        .send({
          title: "Owned Task",
          projectId: projectA.id,
          assigneeId: memberUser2.id,
        })
        .expect(201);

      ownedTask = res.body;
    });

    it("member who is neither creator nor assignee receives 403 Forbidden when editing task", async () => {
      // Register a 3rd member on project A
      const thirdMember = await createAndLoginUser("member3");
      await request(app.getHttpServer())
        .post(`/projects/${projectA.id}/members`)
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .send({ userId: thirdMember.id, role: ProjectRole.MEMBER })
        .expect(201);

      // Third member tries to edit memberUser1's task -> 403 Forbidden
      const res = await request(app.getHttpServer())
        .patch(`/tasks/${ownedTask.id}`)
        .set("Authorization", `Bearer ${thirdMember.token}`)
        .send({ title: "Unauthorized Member Edit" })
        .expect(403);

      expect(res.body.message).toContain("Only the task creator, assignee, or a project owner/admin may edit this task");
    });

    it("task creator can successfully edit the task (200 OK)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/tasks/${ownedTask.id}`)
        .set("Authorization", `Bearer ${memberUser1.token}`)
        .send({ title: "Creator Updated Title" })
        .expect(200);

      expect(res.body.title).toBe("Creator Updated Title");
    });

    it("task assignee can successfully edit the task (200 OK)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/tasks/${ownedTask.id}`)
        .set("Authorization", `Bearer ${memberUser2.token}`)
        .send({ title: "Assignee Updated Title" })
        .expect(200);

      expect(res.body.title).toBe("Assignee Updated Title");
    });

    it("project owner can override ownership restriction and edit the task (200 OK)", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/tasks/${ownedTask.id}`)
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .send({ title: "Owner Override Title" })
        .expect(200);

      expect(res.body.title).toBe("Owner Override Title");
    });
  });

  // ==========================================================================
  // [X2] CHALLENGE: Global JwtAuthGuard with @Public() decorator bypass
  // ==========================================================================
  describe("[X2] Challenge: Global Guard Inverted Default", () => {
    it("public GET /projects is accessible without authentication", async () => {
      const res = await request(app.getHttpServer())
        .get("/projects")
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it("public GET /tasks is accessible without authentication", async () => {
      const res = await request(app.getHttpServer())
        .get("/tasks")
        .expect(200);

      expect(res.body.items).toBeDefined();
    });

    it("unmarked routes strictly fail closed and return 401 without token", async () => {
      await request(app.getHttpServer())
        .get("/auth/me")
        .expect(401);
    });
  });

  // ==========================================================================
  // [X3] CHALLENGE: Role caching & invalidation
  // ==========================================================================
  describe("[X3] Challenge: Role Lookup Caching & Immediate Invalidation", () => {
    it("caches role on lookup and invalidates immediately when membership row is removed", async () => {
      const tempUser = await createAndLoginUser("cachetest");

      // 1. Add tempUser as member to Project A
      await request(app.getHttpServer())
        .post(`/projects/${projectA.id}/members`)
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .send({ userId: tempUser.id, role: ProjectRole.MEMBER })
        .expect(201);

      // 2. Request task creation -> hits DB, caches role
      await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${tempUser.token}`)
        .send({ title: "Cache Test Task 1", projectId: projectA.id })
        .expect(201);

      // Verify role is cached
      expect(roleCacheService.get(tempUser.id, projectA.id)).toBe(ProjectRole.MEMBER);

      // 3. Remove user from project via API (triggers invalidation)
      await request(app.getHttpServer())
        .delete(`/projects/${projectA.id}/members/${tempUser.id}`)
        .set("Authorization", `Bearer ${ownerUser.token}`)
        .expect(204);

      // Verify cache was invalidated immediately (0s staleness for API actions)
      expect(roleCacheService.get(tempUser.id, projectA.id)).toBeNull();

      // 4. Subsequent request immediately returns 403 Forbidden
      await request(app.getHttpServer())
        .post("/tasks")
        .set("Authorization", `Bearer ${tempUser.token}`)
        .send({ title: "Cache Test Task 2", projectId: projectA.id })
        .expect(403);
    });
  });
});
