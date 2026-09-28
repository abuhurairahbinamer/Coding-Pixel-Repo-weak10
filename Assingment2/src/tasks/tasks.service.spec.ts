import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TasksService } from "./tasks.service.js";
import { Task } from "../entities/task.entity.js";
import { Project } from "../entities/project.entity.js";
import { User } from "../entities/user.entity.js";
import { Tag } from "../entities/tag.entity.js";
import { TaskStatus } from "../common/enums/task-status.enum.js";
import { CreateTaskDto } from "./dto/create-task.dto.js";
import { UpdateTaskDto } from "./dto/update-task.dto.js";

describe("TasksService", () => {
  let service: TasksService;

  const mockTaskRepository = {
    create: vi.fn(),
    save: vi.fn(),
    findOne: vi.fn(),
    remove: vi.fn(),
    createQueryBuilder: vi.fn(),
  };

  const mockProjectRepository = {
    findOne: vi.fn(),
  };

  const mockUserRepository = {
    findOne: vi.fn(),
  };

  const mockTagRepository = {
    findBy: vi.fn(),
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        {
          provide: getRepositoryToken(Task),
          useValue: mockTaskRepository,
        },
        {
          provide: getRepositoryToken(Project),
          useValue: mockProjectRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(Tag),
          useValue: mockTagRepository,
        },
      ],
    }).compile();

    service = module.get<TasksService>(TasksService);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    const validDto: CreateTaskDto = {
      title: "Test Task",
      description: "A test task description",
      status: TaskStatus.TODO,
      priority: 3,
      projectId: 1,
      assigneeId: 2,
    };

    it("should successfully create a task when project and assignee exist", async () => {
      const mockProject = { id: 1, name: "Project Alpha" } as Project;
      const mockUser = { id: 2, name: "John Doe" } as User;
      const mockCreatedTask = {
        id: 10,
        ...validDto,
        dueDate: null,
        tags: [],
      } as Task;
      const mockFetchedTask = {
        ...mockCreatedTask,
        project: mockProject,
        assignee: mockUser,
        tags: [],
      } as Task;

      mockProjectRepository.findOne.mockResolvedValue(mockProject);
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockTaskRepository.create.mockReturnValue(mockCreatedTask);
      mockTaskRepository.save.mockResolvedValue(mockCreatedTask);
      mockTaskRepository.findOne.mockResolvedValue(mockFetchedTask);

      const result = await service.create(validDto);

      expect(mockProjectRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { id: 2 },
      });
      expect(mockTaskRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockFetchedTask);
    });

    it("should throw NotFoundException (404) if projectId does not exist (C4)", async () => {
      mockProjectRepository.findOne.mockResolvedValue(null);

      await expect(service.create(validDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(validDto)).rejects.toThrow(
        "Project with ID 1 not found",
      );
    });

    it("should throw NotFoundException (404) if assigneeId does not exist (C4)", async () => {
      mockProjectRepository.findOne.mockResolvedValue({ id: 1 } as Project);
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.create(validDto)).rejects.toThrow(NotFoundException);
      await expect(service.create(validDto)).rejects.toThrow(
        "Assignee with ID 2 not found",
      );
    });

    it("should throw NotFoundException (404) if any tagId does not exist", async () => {
      const dtoWithTags: CreateTaskDto = {
        ...validDto,
        tagIds: [100, 200],
      };
      mockProjectRepository.findOne.mockResolvedValue({ id: 1 } as Project);
      mockUserRepository.findOne.mockResolvedValue({ id: 2 } as User);
      mockTagRepository.findBy.mockResolvedValue([{ id: 100, name: "Tag 1" }]);

      await expect(service.create(dtoWithTags)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("findAll", () => {
    it("should build query with combinable filters and pagination (C2 & X1)", async () => {
      const mockTasks = [
        { id: 1, title: "Task 1", status: TaskStatus.TODO, projectId: 1 },
      ] as Task[];

      const mockQb = {
        leftJoinAndSelect: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        take: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        getManyAndCount: vi.fn().mockResolvedValue([mockTasks, 1]),
      };

      mockTaskRepository.createQueryBuilder.mockReturnValue(mockQb);

      const query = {
        status: TaskStatus.TODO,
        projectId: 1,
        assigneeId: 2,
        page: 1,
        pageSize: 10,
      };

      const result = await service.findAll(query);

      expect(mockTaskRepository.createQueryBuilder).toHaveBeenCalledWith(
        "task",
      );
      expect(mockQb.andWhere).toHaveBeenCalledWith("task.status = :status", {
        status: TaskStatus.TODO,
      });
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        "task.projectId = :projectId",
        {
          projectId: 1,
        },
      );
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        "task.assigneeId = :assigneeId",
        { assigneeId: 2 },
      );
      expect(mockQb.skip).toHaveBeenCalledWith(0);
      expect(mockQb.take).toHaveBeenCalledWith(10);
      expect(result).toEqual({
        items: mockTasks,
        total: 1,
        page: 1,
        pageSize: 10,
      });
    });
  });

  describe("findOne", () => {
    it("should return a task with relations loaded (W2)", async () => {
      const mockTask = {
        id: 1,
        title: "Test",
        project: { id: 1, name: "Project 1" },
        assignee: { id: 2, name: "User 1" },
        tags: [],
      } as unknown as Task;

      mockTaskRepository.findOne.mockResolvedValue(mockTask);

      const result = await service.findOne(1);

      expect(mockTaskRepository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: {
          project: true,
          assignee: true,
          tags: true,
        },
      });
      expect(result).toEqual(mockTask);
    });

    it("should throw NotFoundException (404) if task not found", async () => {
      mockTaskRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe("update", () => {
    it("should partially update a task and return updated entity (C3)", async () => {
      const existingTask = {
        id: 1,
        title: "Old Title",
        description: "Old Desc",
        status: TaskStatus.TODO,
        priority: 2,
        projectId: 1,
        assigneeId: 2,
      } as Task;

      const updateDto: UpdateTaskDto = {
        title: "New Title",
      };

      mockTaskRepository.findOne
        .mockResolvedValueOnce(existingTask)
        .mockResolvedValueOnce({ ...existingTask, title: "New Title" });
      mockTaskRepository.save.mockResolvedValue({
        ...existingTask,
        title: "New Title",
      });

      const result = await service.update(1, updateDto);

      expect(result.title).toBe("New Title");
      expect(mockTaskRepository.save).toHaveBeenCalled();
    });

    it("should throw NotFoundException if update task not found", async () => {
      mockTaskRepository.findOne.mockResolvedValue(null);

      await expect(service.update(999, { title: "New Title" })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("remove", () => {
    it("should remove task when found (C3)", async () => {
      const existingTask = { id: 1, title: "Task to delete" } as Task;
      mockTaskRepository.findOne.mockResolvedValue(existingTask);
      mockTaskRepository.remove.mockResolvedValue(existingTask);

      await expect(service.remove(1)).resolves.toBeUndefined();
      expect(mockTaskRepository.remove).toHaveBeenCalledWith(existingTask);
    });

    it("should throw NotFoundException (404) on remove if task not found", async () => {
      mockTaskRepository.findOne.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    });
  });
});
