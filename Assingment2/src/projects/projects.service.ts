import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Project } from "../entities/project.entity.js";
import { ProjectMember } from "../entities/project-member.entity.js";
import { ProjectRole } from "../common/enums/project-role.enum.js";
import { CreateProjectDto } from "./dto/create-project.dto.js";
import { RoleCacheService } from "./role-cache.service.js";

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepository: Repository<Project>,
    @InjectRepository(ProjectMember)
    private readonly projectMemberRepository: Repository<ProjectMember>,
    private readonly roleCacheService: RoleCacheService,
  ) {}

  // ============================================================================
  // [W2] CurrentUser binds the created project to the authenticated user
  // Client-supplied ownerId/userId is strictly ignored in favor of authenticated caller
  // ============================================================================
  async create(createProjectDto: CreateProjectDto, currentUser: { id: number; email: string }): Promise<Project> {
    const project = this.projectRepository.create({
      name: createProjectDto.name,
      // [W2] Token user ID is the single source of truth for identity
      ownerId: currentUser.id,
    });

    const savedProject = await this.projectRepository.save(project);

    // Automatically make creator the 'owner' in project_members
    const membership = this.projectMemberRepository.create({
      userId: currentUser.id,
      projectId: savedProject.id,
      role: ProjectRole.OWNER,
    });
    await this.projectMemberRepository.save(membership);

    // [X3] Cache owner role
    this.roleCacheService.set(currentUser.id, savedProject.id, ProjectRole.OWNER);

    return savedProject;
  }

  async findById(id: number): Promise<Project> {
    const project = await this.projectRepository.findOne({
      where: { id },
      relations: {
        owner: true,
        members: {
          user: true,
        },
      },
    });
    if (!project) {
      throw new NotFoundException(`Project with ID ${id} not found`);
    }
    return project;
  }

  async findAll(): Promise<Project[]> {
    return this.projectRepository.find({
      relations: { owner: true },
    });
  }

  // ============================================================================
  // [C2] Destructive rule: only owner or admin may delete a project (204 No Content)
  // ============================================================================
  async remove(id: number): Promise<void> {
    const project = await this.findById(id);
    await this.projectRepository.remove(project);

    // [X3] Invalidate cached roles for this project
    this.roleCacheService.invalidateProject(id);
  }

  // Manage project memberships (supporting dynamic role change tests & X3 invalidation)
  async addOrUpdateMember(
    projectId: number,
    userId: number,
    role: ProjectRole,
  ): Promise<ProjectMember> {
    // Verify project exists
    await this.findById(projectId);

    let member = await this.projectMemberRepository.findOne({
      where: { projectId, userId },
    });

    if (member) {
      member.role = role;
    } else {
      member = this.projectMemberRepository.create({
        projectId,
        userId,
        role,
      });
    }

    const saved = await this.projectMemberRepository.save(member);

    // [X3] Invalidate or update cached role immediately
    this.roleCacheService.set(userId, projectId, role);

    return saved;
  }

  async removeMember(projectId: number, userId: number): Promise<void> {
    const member = await this.projectMemberRepository.findOne({
      where: { projectId, userId },
    });
    if (!member) {
      throw new NotFoundException(`User ${userId} is not a member of project ${projectId}`);
    }

    await this.projectMemberRepository.remove(member);

    // [X3] Immediately invalidate cache entry upon member removal
    this.roleCacheService.invalidate(userId, projectId);
  }
}
