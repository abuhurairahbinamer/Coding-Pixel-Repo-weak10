import { Test, TestingModule } from "@nestjs/testing";
import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TasksController } from "../src/tasks/tasks.controller.js";
import { TasksService } from "../src/tasks/tasks.service.js";
import { AllExceptionsFilter } from "../src/common/filters/http-exception.filter.js";
import { TaskStatus } from "../src/common/enums/task-status.enum.js";
import { Task } from "../src/entities/task.entity.js";

import { Project } from "../src/entities/project.entity.js";
import { User } from "../src/entities/user.entity.js";
import { DataSource } from "typeorm";
import { JwtAuthGuard } from "../src/auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../src/common/guards/roles.guard.js";
import { TaskOwnershipGuard } from "../src/common/guards/task-ownership.guard.js";
import { RoleCacheService } from "../src/projects/role-cache.service.js";

describe("Tasks API Integration (e2e)", () => {
  let app: INestApplication;

  const inMemoryTasks: Map<number, Task> = new Map();
  let currentId = 1;

  const mockTasksService = {
    create: vi.fn(async (dto) => {
      if (dto.projectId === 9999) {
        throw new NotFoundException("Project with ID 9999 not found");
      }
      if (dto.assigneeId === 9999) {
        throw new NotFoundException("Assignee with ID 9999 not found");
      }
      const task: Task = {
        id: currentId++,
        title: dto.title,
        description: dto.description ?? null,
        status: dto.status ?? TaskStatus.TODO,
        priority: dto.priority ?? 1,
        projectId: dto.projectId,
        assigneeId: dto.assigneeId ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdAt: new Date(),
        project: {
          id: dto.projectId,
          name: "Sample Project",
        } as unknown as Project,
        assignee: dto.assigneeId
          ? ({ id: dto.assigneeId, name: "Sample User" } as unknown as User)
          : null,
        tags: [],
        comments: [],
      };
      inMemoryTasks.set(task.id, task);
      return task;
    }),

    findAll: vi.fn(async (query) => {
      let items = Array.from(inMemoryTasks.values());
      if (query.status) {
        items = items.filter((t) => t.status === query.status);
      }
      if (query.projectId) {
        items = items.filter((t) => t.projectId === Number(query.projectId));
      }
      if (query.assigneeId) {
        items = items.filter((t) => t.assigneeId === Number(query.assigneeId));
      }
      return {
        items,
        total: items.length,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 10,
      };
    }),

    findOne: vi.fn(async (id: number) => {
      const task = inMemoryTasks.get(id);
      if (!task) {
        throw new NotFoundException(`Task with ID ${id} not found`);
      }
      return task;
    }),

    update: vi.fn(async (id: number, dto) => {
      const task = inMemoryTasks.get(id);
      if (!task) {
        throw new NotFoundException(`Task with ID ${id} not found`);
      }
      if (dto.projectId === 9999) {
        throw new NotFoundException("Project with ID 9999 not found");
      }
      Object.assign(task, dto);
      inMemoryTasks.set(id, task);
      return task;
    }),

    remove: vi.fn(async (id: number) => {
      if (!inMemoryTasks.has(id)) {
        throw new NotFoundException(`Task with ID ${id} not found`);
      }
      inMemoryTasks.delete(id);
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
      providers: [
        {
          provide: TasksService,
          useValue: mockTasksService,
        },
        {
          provide: DataSource,
          useValue: { getRepository: vi.fn() },
        },
        {
          provide: RoleCacheService,
          useValue: { get: vi.fn(), set: vi.fn(), invalidate: vi.fn() },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: 1, email: "tester@example.com" };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TaskOwnershipGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();

    // Attach W1 global validation pipe & X2 filter
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
  });

  afterAll(async () => {
    await app.close();
  });

  // C6: Happy path create then read
  it("POST /tasks creates a task and returns 201 with body fields", async () => {
    const response = await request(app.getHttpServer())
      .post("/tasks")
      .send({
        title: "Integration Test Task",
        description: "Created in e2e test",
        status: "todo",
        priority: 3,
        projectId: 1,
      })
      .expect(201);

    expect(response.body).toHaveProperty("id");
    expect(response.body.title).toBe("Integration Test Task");
    expect(response.body.status).toBe("todo");
    expect(response.body.priority).toBe(3);
    expect(response.body.projectId).toBe(1);
  });

  it("GET /tasks/:id returns 200 with loaded relations", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/tasks")
      .send({
        title: "Fetchable Task",
        projectId: 1,
      })
      .expect(201);

    const taskId = createRes.body.id;

    const getRes = await request(app.getHttpServer())
      .get(`/tasks/${taskId}`)
      .expect(200);

    expect(getRes.body.id).toBe(taskId);
    expect(getRes.body.title).toBe("Fetchable Task");
    expect(getRes.body).toHaveProperty("project");
  });

  // C6: Validation failure expecting 400
  it("POST /tasks with invalid body (short title, bad priority, bad status) returns 400", async () => {
    const res = await request(app.getHttpServer())
      .post("/tasks")
      .send({
        title: "ab", // shorter than 3 characters
        priority: 9, // greater than 5
        status: "nope", // invalid enum
        projectId: 1,
      })
      .expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(res.body).toHaveProperty("message");
    expect(res.body).toHaveProperty("path", "/tasks");
    expect(res.body).toHaveProperty("timestamp");
  });

  // X3: Unknown extra field rejected with 400 (forbidNonWhitelisted)
  it("POST /tasks with unknown extra field returns 400 (forbidNonWhitelisted)", async () => {
    const res = await request(app.getHttpServer())
      .post("/tasks")
      .send({
        title: "Valid Title",
        projectId: 1,
        hackerField: "malicious_input",
      })
      .expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(res.body.message).toEqual(
      expect.arrayContaining([
        expect.stringContaining("property hackerField should not exist"),
      ]),
    );
  });

  // X3 & C4: Non-existent projectId on create returns 404
  it("POST /tasks with non-existent projectId returns 404", async () => {
    const res = await request(app.getHttpServer())
      .post("/tasks")
      .send({
        title: "Task with missing project",
        projectId: 9999,
      })
      .expect(404);

    expect(res.body.statusCode).toBe(404);
    expect(res.body.message).toBe("Project with ID 9999 not found");
  });

  // X3: Unknown task ID returns 404
  it("GET /tasks/:id with unknown ID returns 404", async () => {
    const res = await request(app.getHttpServer())
      .get("/tasks/999999")
      .expect(404);

    expect(res.body.statusCode).toBe(404);
    expect(res.body.message).toBe("Task with ID 999999 not found");
  });

  // C3 & X3: DELETE /tasks/:id returns 204, subsequent DELETE or GET returns 404
  it("DELETE /tasks/:id returns 204 No Content, and second DELETE returns 404", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/tasks")
      .send({
        title: "Task to be deleted",
        projectId: 1,
      })
      .expect(201);

    const taskId = createRes.body.id;

    // First delete -> 204 No Content
    await request(app.getHttpServer()).delete(`/tasks/${taskId}`).expect(204);

    // Second delete -> 404 Not Found
    await request(app.getHttpServer()).delete(`/tasks/${taskId}`).expect(404);

    // GET deleted task -> 404 Not Found
    await request(app.getHttpServer()).get(`/tasks/${taskId}`).expect(404);
  });
});
