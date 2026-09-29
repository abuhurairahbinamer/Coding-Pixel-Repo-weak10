import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DataSource } from "typeorm";
import { ROLES_KEY } from "../decorators/roles.decorator.js";
import { ProjectRole } from "../enums/project-role.enum.js";
import { ProjectMember } from "../../entities/project-member.entity.js";
import { Task } from "../../entities/task.entity.js";
import { Comment } from "../../entities/comment.entity.js";
import { RoleCacheService } from "../../projects/role-cache.service.js";

// ============================================================================
// [C1] CORE REQUIREMENT: RolesGuard reads caller's role from project_members
// [C2] CORE REQUIREMENT: Enforce destructive rule (only owner or admin delete project)
// [C3] CORE REQUIREMENT: Cross-project isolation (role on project A grants nothing on B)
// [C4] CORE REQUIREMENT: Guard ordering: JwtAuthGuard runs first; RolesGuard yields 401 if unauthenticated
// [X3] CHALLENGE REQUIREMENT: Reads role from RoleCacheService to minimize database load
// ============================================================================
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
    private readonly roleCacheService: RoleCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // [C1] Extract required roles from @Roles() decorator
    const requiredRoles = this.reflector.getAllAndOverride<ProjectRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no @Roles() decorator is attached, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // [C4] Order check: If JwtAuthGuard has not run or failed to authenticate,
    // throw 401 Unauthorized instead of 403 Forbidden.
    if (!user || !user.id) {
      throw new UnauthorizedException("Authentication required before authorization");
    }

    // [C1] & [C3] HINT: The guard needs the project ID for the request.
    // It may come from route params, request body, or by loading the target resource.
    const projectId = await this.resolveProjectId(request);

    if (!projectId) {
      throw new ForbiddenException("Unable to determine project context for role verification");
    }

    // [X3] CHALLENGE: Check in-memory RoleCacheService before hitting project_members
    let userRole = this.roleCacheService.get(user.id, projectId);

    if (!userRole) {
      const memberRepo = this.dataSource.getRepository(ProjectMember);
      const membership = await memberRepo.findOne({
        where: {
          userId: user.id,
          projectId: projectId,
        },
      });

      if (membership) {
        userRole = membership.role;
        // [X3] Cache the resolved role with TTL
        this.roleCacheService.set(user.id, projectId, userRole);
      }
    }

    // [C3] Reject a user acting outside their own project:
    // A role on project A grants nothing on project B. If no membership exists, return 403 Forbidden.
    if (!userRole) {
      throw new ForbiddenException("You are not a member of this project");
    }

    // [C1] & [C2] Check if caller's role matches any of the required roles
    const hasRole = requiredRoles.includes(userRole);
    if (!hasRole) {
      throw new ForbiddenException(
        `Role '${userRole}' is not authorized to perform this action. Required roles: ${requiredRoles.join(", ")}`,
      );
    }

    // Attach verified projectRole to request for downstream handlers or guards
    request.projectRole = userRole;
    request.projectId = projectId;

    return true;
  }

  // Resolves the project ID based on route params, body, or database lookup
  private async resolveProjectId(request: any): Promise<number | null> {
    // 1. Explicit projectId in route parameter (/projects/:projectId/...)
    if (request.params?.projectId) {
      const parsed = parseInt(request.params.projectId, 10);
      return isNaN(parsed) ? null : parsed;
    }

    // 2. Project ID from route parameter on projects controller (/projects/:id)
    const baseUrl = request.baseUrl || request.url || "";
    if (request.params?.id && (baseUrl.includes("/projects") || request.route?.path?.includes("projects"))) {
      const parsed = parseInt(request.params.id, 10);
      return isNaN(parsed) ? null : parsed;
    }

    // 3. Project ID in request body (e.g. POST /tasks with { projectId: 1 })
    if (request.body?.projectId) {
      const parsed = parseInt(request.body.projectId, 10);
      return isNaN(parsed) ? null : parsed;
    }

    // 4. Task ID in route parameter (e.g. PATCH /tasks/:id or DELETE /tasks/:id)
    if (request.params?.id && (baseUrl.includes("/tasks") || request.route?.path?.includes("tasks"))) {
      const taskId = parseInt(request.params.id, 10);
      if (isNaN(taskId)) return null;

      const taskRepo = this.dataSource.getRepository(Task);
      const task = await taskRepo.findOne({ where: { id: taskId } });
      if (!task) {
        throw new NotFoundException(`Task with ID ${taskId} not found`);
      }
      return task.projectId;
    }

    // 5. Nested Task ID in route parameter (e.g. POST /tasks/:taskId/comments)
    if (request.params?.taskId) {
      const taskId = parseInt(request.params.taskId, 10);
      if (isNaN(taskId)) return null;

      const taskRepo = this.dataSource.getRepository(Task);
      const task = await taskRepo.findOne({ where: { id: taskId } });
      if (!task) {
        throw new NotFoundException(`Task with ID ${taskId} not found`);
      }
      return task.projectId;
    }

    // 6. Comment ID in route parameter (e.g. PATCH /comments/:id or DELETE /comments/:id)
    if (request.params?.id && (baseUrl.includes("/comments") || request.route?.path?.includes("comments"))) {
      const commentId = parseInt(request.params.id, 10);
      if (isNaN(commentId)) return null;

      const commentRepo = this.dataSource.getRepository(Comment);
      const comment = await commentRepo.findOne({
        where: { id: commentId },
        relations: { task: true },
      });
      if (!comment) {
        throw new NotFoundException(`Comment with ID ${commentId} not found`);
      }
      return comment.task ? comment.task.projectId : null;
    }

    return null;
  }
}
