import { Test, TestingModule } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataSource } from "typeorm";
import { TasksController } from "./tasks.controller.js";
import { TasksService } from "./tasks.service.js";
import { CreateTaskDto } from "./dto/create-task.dto.js";
import { UpdateTaskDto } from "./dto/update-task.dto.js";
import { QueryTaskDto } from "./dto/query-task.dto.js";
import { TaskStatus } from "../common/enums/task-status.enum.js";
import { Task } from "../entities/task.entity.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { TaskOwnershipGuard } from "../common/guards/task-ownership.guard.js";
import { RoleCacheService } from "../projects/role-cache.service.js";

describe("TasksController", () => {
  let controller: TasksController;

  const mockTasksService = {
    create: vi.fn(),
    findAll: vi.fn(),
    findOne: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  };

  const mockUser = { id: 1, email: "tester@example.com" };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
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
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(TaskOwnershipGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TasksController>(TasksController);
  });

  it("should create a task via service", async () => {
    const dto: CreateTaskDto = {
      title: "New Task",
      projectId: 1,
    };
    const expectedTask = { id: 1, ...dto, creatorId: mockUser.id } as Task;
    mockTasksService.create.mockResolvedValue(expectedTask);

    const result = await controller.create(dto, mockUser);
    expect(mockTasksService.create).toHaveBeenCalledWith(dto, mockUser);
    expect(result).toEqual(expectedTask);
  });

  it("should findAll tasks via service with query parameters", async () => {
    const query: QueryTaskDto = {
      status: TaskStatus.TODO,
      projectId: 1,
      page: 1,
      pageSize: 10,
    };
    const expectedResult = {
      items: [{ id: 1, title: "Task 1" } as Task],
      total: 1,
      page: 1,
      pageSize: 10,
    };
    mockTasksService.findAll.mockResolvedValue(expectedResult);

    const result = await controller.findAll(query);
    expect(mockTasksService.findAll).toHaveBeenCalledWith(query);
    expect(result).toEqual(expectedResult);
  });

  it("should findOne task by id via service", async () => {
    const expectedTask = { id: 1, title: "Task 1" } as Task;
    mockTasksService.findOne.mockResolvedValue(expectedTask);

    const result = await controller.findOne(1);
    expect(mockTasksService.findOne).toHaveBeenCalledWith(1);
    expect(result).toEqual(expectedTask);
  });

  it("should update a task by id via service", async () => {
    const dto: UpdateTaskDto = {
      title: "Updated Title",
    };
    const expectedTask = { id: 1, title: "Updated Title" } as Task;
    mockTasksService.update.mockResolvedValue(expectedTask);

    const result = await controller.update(1, dto);
    expect(mockTasksService.update).toHaveBeenCalledWith(1, dto);
    expect(result).toEqual(expectedTask);
  });

  it("should delete a task by id via service", async () => {
    mockTasksService.remove.mockResolvedValue(undefined);

    await controller.remove(1);
    expect(mockTasksService.remove).toHaveBeenCalledWith(1);
  });
});
