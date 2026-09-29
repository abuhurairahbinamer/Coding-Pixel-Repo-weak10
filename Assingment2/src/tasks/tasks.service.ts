import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Task } from "../entities/task.entity.js";
import { Project } from "../entities/project.entity.js";
import { User } from "../entities/user.entity.js";
import { Tag } from "../entities/tag.entity.js";
import { CreateTaskDto } from "./dto/create-task.dto.js";
import { UpdateTaskDto } from "./dto/update-task.dto.js";
import { QueryTaskDto } from "./dto/query-task.dto.js";
import { TaskStatus } from "../common/enums/task-status.enum.js";

export interface PaginatedTasksResult {
  items: Task[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Tag)
    private readonly tagRepository: Repository<Tag>,
  ) {}

  // [W2] CurrentUser binds caller to created task; [X1] records creatorId
  async create(createTaskDto: CreateTaskDto, currentUser?: { id: number; email: string }): Promise<Task> {
    // C4: Verify projectId exists
    const project = await this.projectRepository.findOne({
      where: { id: createTaskDto.projectId },
    });
    if (!project) {
      throw new NotFoundException(
        `Project with ID ${createTaskDto.projectId} not found`,
      );
    }

    // C4: Verify assigneeId exists if provided
    let assignee: User | null = null;
    if (
      createTaskDto.assigneeId !== undefined &&
      createTaskDto.assigneeId !== null
    ) {
      assignee = await this.userRepository.findOne({
        where: { id: createTaskDto.assigneeId },
      });
      if (!assignee) {
        throw new NotFoundException(
          `Assignee with ID ${createTaskDto.assigneeId} not found`,
        );
      }
    }

    // Load tags if tagIds provided
    let tags: Tag[] = [];
    if (createTaskDto.tagIds && createTaskDto.tagIds.length > 0) {
      tags = await this.tagRepository.findBy({
        id: In(createTaskDto.tagIds),
      });
      if (tags.length !== createTaskDto.tagIds.length) {
        const foundIds = new Set(tags.map((t) => t.id));
        const missingIds = createTaskDto.tagIds.filter(
          (id) => !foundIds.has(id),
        );
        throw new NotFoundException(
          `Tag(s) with ID(s) [${missingIds.join(", ")}] not found`,
        );
      }
    }

    // [W2] & [X1] Set creatorId from authenticated user
    const task = this.taskRepository.create({
      title: createTaskDto.title,
      description: createTaskDto.description ?? null,
      status: createTaskDto.status ?? TaskStatus.TODO,
      priority: createTaskDto.priority ?? 1,
      projectId: createTaskDto.projectId,
      creatorId: currentUser?.id ?? null,
      assigneeId: createTaskDto.assigneeId ?? null,
      dueDate: createTaskDto.dueDate ? new Date(createTaskDto.dueDate) : null,
      tags,
    });

    const savedTask = await this.taskRepository.save(task);
    return this.findOne(savedTask.id);
  }

  async findAll(query: QueryTaskDto): Promise<PaginatedTasksResult> {
    // C2: SelectQueryBuilder with named parameters
    const qb = this.taskRepository
      .createQueryBuilder("task")
      .leftJoinAndSelect("task.project", "project")
      .leftJoinAndSelect("task.assignee", "assignee")
      .leftJoinAndSelect("task.tags", "tags");

    if (query.status) {
      qb.andWhere("task.status = :status", { status: query.status });
    }

    if (query.projectId !== undefined) {
      qb.andWhere("task.projectId = :projectId", {
        projectId: query.projectId,
      });
    }

    if (query.assigneeId !== undefined) {
      qb.andWhere("task.assigneeId = :assigneeId", {
        assigneeId: query.assigneeId,
      });
    }

    // X1: Pagination with page and pageSize
    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize =
      query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : 10;

    qb.skip((page - 1) * pageSize).take(pageSize);
    qb.orderBy("task.id", "ASC");

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: number): Promise<Task> {
    const task = await this.taskRepository.findOne({
      where: { id },
      relations: {
        project: true,
        assignee: true,
        tags: true,
      },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  async update(id: number, updateTaskDto: UpdateTaskDto): Promise<Task> {
    const task = await this.findOne(id);

    if (updateTaskDto.projectId !== undefined) {
      const project = await this.projectRepository.findOne({
        where: { id: updateTaskDto.projectId },
      });
      if (!project) {
        throw new NotFoundException(
          `Project with ID ${updateTaskDto.projectId} not found`,
        );
      }
      task.projectId = updateTaskDto.projectId;
    }

    if (updateTaskDto.assigneeId !== undefined) {
      if (updateTaskDto.assigneeId === null) {
        task.assigneeId = null;
        task.assignee = null;
      } else {
        const assignee = await this.userRepository.findOne({
          where: { id: updateTaskDto.assigneeId },
        });
        if (!assignee) {
          throw new NotFoundException(
            `Assignee with ID ${updateTaskDto.assigneeId} not found`,
          );
        }
        task.assigneeId = updateTaskDto.assigneeId;
      }
    }

    if (updateTaskDto.tagIds !== undefined) {
      if (updateTaskDto.tagIds.length === 0) {
        task.tags = [];
      } else {
        const tags = await this.tagRepository.findBy({
          id: In(updateTaskDto.tagIds),
        });
        if (tags.length !== updateTaskDto.tagIds.length) {
          const foundIds = new Set(tags.map((t) => t.id));
          const missingIds = updateTaskDto.tagIds.filter(
            (tagId) => !foundIds.has(tagId),
          );
          throw new NotFoundException(
            `Tag(s) with ID(s) [${missingIds.join(", ")}] not found`,
          );
        }
        task.tags = tags;
      }
    }

    if (updateTaskDto.title !== undefined) {
      task.title = updateTaskDto.title;
    }

    if (updateTaskDto.description !== undefined) {
      task.description = updateTaskDto.description;
    }

    if (updateTaskDto.status !== undefined) {
      task.status = updateTaskDto.status;
    }

    if (updateTaskDto.priority !== undefined) {
      task.priority = updateTaskDto.priority;
    }

    if (updateTaskDto.dueDate !== undefined) {
      task.dueDate = updateTaskDto.dueDate
        ? new Date(updateTaskDto.dueDate)
        : null;
    }

    await this.taskRepository.save(task);
    return this.findOne(id);
  }

  async remove(id: number): Promise<void> {
    const task = await this.findOne(id);
    await this.taskRepository.remove(task);
  }
}
