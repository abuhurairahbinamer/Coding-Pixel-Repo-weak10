import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ParsePositiveIntPipe } from "../common/pipes/parse-positive-int.pipe.js";
import { TasksService, PaginatedTasksResult } from "./tasks.service.js";
import { CreateTaskDto } from "./dto/create-task.dto.js";
import { UpdateTaskDto } from "./dto/update-task.dto.js";
import { QueryTaskDto } from "./dto/query-task.dto.js";
import { Task } from "../entities/task.entity.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { TaskOwnershipGuard } from "../common/guards/task-ownership.guard.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { Roles } from "../common/decorators/roles.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import { ProjectRole } from "../common/enums/project-role.enum.js";

// ============================================================================
// [W1] WARM-UP REQUIREMENT: Protect all write routes (POST, PATCH, DELETE) with JwtAuthGuard
// [W2] WARM-UP REQUIREMENT: Extract identity via @CurrentUser()
// [C1] CORE REQUIREMENT: RolesGuard reads caller's role (owner, admin, member, viewer)
// [C3] CORE REQUIREMENT: Cross-project isolation: role on project A grants nothing on B
// [C4] CORE REQUIREMENT: Order guards so JwtAuthGuard runs before RolesGuard
// [X1] CHALLENGE REQUIREMENT: TaskOwnershipGuard (only creator or assignee may edit)
// [X2] CHALLENGE REQUIREMENT: Public routes marked with @Public()
// ============================================================================
@Controller("tasks")
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  // [W1] Protected write route (Bearer token required)
  // [C1] Only owner, admin, or member may create tasks (viewer receives 403)
  // [C4] Guard ordering: JwtAuthGuard (401) -> RolesGuard (403)
  // [W2] Creator identity extracted from @CurrentUser()
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER)
  async create(
    @Body() createTaskDto: CreateTaskDto,
    @CurrentUser() currentUser: { id: number; email: string },
  ): Promise<Task> {
    return this.tasksService.create(createTaskDto, currentUser);
  }

  // [X2] Public GET route: allowed without authentication
  @Get()
  @Public()
  async findAll(@Query() query: QueryTaskDto): Promise<PaginatedTasksResult> {
    return this.tasksService.findAll(query);
  }

  // [X2] Public GET route: allowed without authentication
  // [C3] Route parameter validated to ensure positive integer before DB lookup
  @Get(":id")
  @Public()
  async findOne(@Param("id", ParsePositiveIntPipe) id: number): Promise<Task> {
    return this.tasksService.findOne(id);
  }

  // [W1] Protected write route
  // [C1] & [C3] RolesGuard checks role on the project that owns this task
  // [X1] TaskOwnershipGuard: only creator or assignee may edit; owner/admin can override
  // [C4] Guard ordering: JwtAuthGuard (401) -> RolesGuard (403) -> TaskOwnershipGuard (403)
  @Patch(":id")
  @UseGuards(JwtAuthGuard, RolesGuard, TaskOwnershipGuard)
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER)
  async update(
    @Param("id", ParsePositiveIntPipe) id: number,
    @Body() updateTaskDto: UpdateTaskDto,
  ): Promise<Task> {
    return this.tasksService.update(id, updateTaskDto);
  }

  // [W1] Protected write route
  // [C1] & [C3] RolesGuard checks caller's role on the project of this task
  // [C4] Guard ordering: JwtAuthGuard runs first, then RolesGuard
  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParsePositiveIntPipe) id: number): Promise<void> {
    await this.tasksService.remove(id);
  }
}
