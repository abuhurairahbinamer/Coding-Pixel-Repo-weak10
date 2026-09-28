import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ParsePositiveIntPipe } from "../common/pipes/parse-positive-int.pipe.js";
import { ProjectsService } from "./projects.service.js";
import { CreateProjectDto } from "./dto/create-project.dto.js";
import { ManageMemberDto } from "./dto/manage-member.dto.js";
import { Project } from "../entities/project.entity.js";
import { ProjectMember } from "../entities/project-member.entity.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { Roles } from "../common/decorators/roles.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import { ProjectRole } from "../common/enums/project-role.enum.js";

// ============================================================================
// [W1] WARM-UP REQUIREMENT: Protect write routes with JwtAuthGuard
// [W2] WARM-UP REQUIREMENT: Extract identity via @CurrentUser()
// [C2] CORE REQUIREMENT: Only owner or admin may delete a project (204 No Content)
// [C4] CORE REQUIREMENT: Order guards so JwtAuthGuard runs before RolesGuard
// [X2] CHALLENGE REQUIREMENT: GET routes left public with @Public() decorator
// ============================================================================
@Controller("projects")
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // [W1] & [W2] Creating project requires valid Bearer token; caller becomes owner
  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @Body() createProjectDto: CreateProjectDto,
    @CurrentUser() currentUser: { id: number; email: string },
  ): Promise<Project> {
    return this.projectsService.create(createProjectDto, currentUser);
  }

  // [X2] Public GET route: allowed without authentication
  @Get()
  @Public()
  async findAll(): Promise<Project[]> {
    return this.projectsService.findAll();
  }

  // [X2] Public GET route: allowed without authentication
  // [C3] Route parameter validated to ensure positive integer before DB lookup
  @Get(":id")
  @Public()
  async findOne(@Param("id", ParsePositiveIntPipe) id: number): Promise<Project> {
    return this.projectsService.findById(id);
  }

  // [C2] Destructive rule: only owner or admin may delete a project
  // [C4] Guard ordering: JwtAuthGuard executes first (returning 401 if unauthenticated),
  // followed by RolesGuard (returning 403 if role is member or viewer).
  @Delete(":id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParsePositiveIntPipe) id: number): Promise<void> {
    await this.projectsService.remove(id);
  }

  // Manage project membership: only owner or admin can invite/change roles
  @Post(":id/members")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN)
  async addMember(
    @Param("id", ParsePositiveIntPipe) id: number,
    @Body() manageMemberDto: ManageMemberDto,
  ): Promise<ProjectMember> {
    return this.projectsService.addOrUpdateMember(
      id,
      manageMemberDto.userId,
      manageMemberDto.role,
    );
  }

  // Remove member: only owner or admin can remove members
  @Delete(":id/members/:userId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param("id", ParsePositiveIntPipe) id: number,
    @Param("userId", ParsePositiveIntPipe) userId: number,
  ): Promise<void> {
    await this.projectsService.removeMember(id, userId);
  }
}
