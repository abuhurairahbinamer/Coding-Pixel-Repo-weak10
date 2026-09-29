// ============================================================================
// [C4] CORE REQUIREMENT: Independent Test Setup via Helpers and Factories
// WHY: Independence is what lets you run one failing test on its own and trust
// what it tells you. Shared helpers keep that cheap; shared state makes it impossible.
// HINT: Write small functions that create a user, log in and return a token, or
// create a project — one call per test, no rows created at module level.
// ============================================================================
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { ProjectRole } from "../../src/common/enums/project-role.enum.js";
import { TaskStatus } from "../../src/common/enums/task-status.enum.js";

let userCounter = 0;

/**
 * Creates a unique user and authenticates them via HTTP, returning the user and JWT tokens.
 * [C4] Independent factory: caller gets a fresh user without touching shared state.
 */
export async function createAndLoginUser(
  app: INestApplication,
  overrides: { name?: string; email?: string; password?: string } = {},
): Promise<{
  user: { id: number; name: string; email: string };
  accessToken: string;
  refreshToken: string;
}> {
  userCounter++;
  const uniqueEmail = overrides.email || `user_${Date.now()}_${userCounter}@test.com`;
  const name = overrides.name || `Test User ${userCounter}`;
  const password = overrides.password || "Password123!";

  // 1. Register user through HTTP
  const regRes = await request(app.getHttpServer())
    .post("/auth/register")
    .send({ name, email: uniqueEmail, password })
    .expect(201);

  const registeredUser = regRes.body;

  // 2. Log in through HTTP to obtain tokens
  const loginRes = await request(app.getHttpServer())
    .post("/auth/login")
    .send({ email: uniqueEmail, password })
    .expect(200);

  return {
    user: registeredUser,
    accessToken: loginRes.body.accessToken,
    refreshToken: loginRes.body.refreshToken,
  };
}

/**
 * Creates a project through HTTP as the authenticated user.
 * [C4] Factory: creates an isolated project per test.
 */
export async function createTestProject(
  app: INestApplication,
  accessToken: string,
  overrides: { name?: string } = {},
): Promise<{ id: number; name: string; ownerId: number }> {
  userCounter++;
  const name = overrides.name || `Project_${Date.now()}_${userCounter}`;

  const res = await request(app.getHttpServer())
    .post("/projects")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name })
    .expect(201);

  return res.body;
}

/**
 * Adds or updates a user's role on a project through HTTP.
 */
export async function addProjectMember(
  app: INestApplication,
  accessToken: string,
  projectId: number,
  userId: number,
  role: ProjectRole,
): Promise<any> {
  const res = await request(app.getHttpServer())
    .post(`/projects/${projectId}/members`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ userId, role })
    .expect(201);

  return res.body;
}

/**
 * Creates a task through HTTP within a project.
 * [C4] Factory: creates an isolated task per test.
 */
export async function createTestTask(
  app: INestApplication,
  accessToken: string,
  projectId: number,
  overrides: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: number;
    assigneeId?: number;
  } = {},
): Promise<{
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: number;
  projectId: number;
  assigneeId: number | null;
  creatorId: number | null;
}> {
  userCounter++;
  const title = overrides.title || `Task_${Date.now()}_${userCounter}`;

  const payload: Record<string, any> = {
    title,
    projectId,
    ...(overrides.description !== undefined && { description: overrides.description }),
    ...(overrides.status !== undefined && { status: overrides.status }),
    ...(overrides.priority !== undefined && { priority: overrides.priority }),
    ...(overrides.assigneeId !== undefined && { assigneeId: overrides.assigneeId }),
  };

  const res = await request(app.getHttpServer())
    .post("/tasks")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(payload)
    .expect(201);

  return res.body;
}

/**
 * Creates a comment on a task through HTTP.
 * [C4] Factory: creates an isolated comment per test.
 */
export async function createTestComment(
  app: INestApplication,
  accessToken: string,
  taskId: number,
  overrides: { body?: string } = {},
): Promise<{
  id: number;
  taskId: number;
  authorId: number;
  body: string;
}> {
  userCounter++;
  const body = overrides.body || `Comment content ${userCounter}`;

  const res = await request(app.getHttpServer())
    .post(`/tasks/${taskId}/comments`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ body })
    .expect(201);

  return res.body;
}
