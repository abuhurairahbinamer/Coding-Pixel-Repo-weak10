import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { Task } from "../../entities/task.entity.js";
import { ProjectMember } from "../../entities/project-member.entity.js";
import { ProjectRole } from "../enums/project-role.enum.js";
import { RoleCacheService } from "../../projects/role-cache.service.js";

// ============================================================================
// [X1] CHALLENGE REQUIREMENT: Resource-ownership guard
// Restricts editing a task to only its creator or assignee, while allowing
// project owner or admin to override.
// WHY: Role and ownership are different questions. "A member may edit tasks"
// and "a member may edit anyone's task" are not the same rule.
// HINT: Load the resource in the guard, compare it against @CurrentUser(),
// and let the project owner or admin override.
// CHECK: A member editing another member's task gets 403; the assignee succeeds;
// an owner still succeeds.
// ============================================================================
@Injectable()
export class TaskOwnershipGuard implements CanActivate {
  constructor(
    private readonly dataSource: DataSource,
    private readonly roleCacheService: RoleCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new UnauthorizedException("Authentication required");
    }

    // Resolve taskId from route parameter (:id)
    const taskId = parseInt(request.params?.id, 10);
    if (isNaN(taskId)) {
      throw new NotFoundException("Task ID is missing or invalid");
    }

    // Load task from database
    const taskRepo = this.dataSource.getRepository(Task);
    const task = await taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    // 1. Task creator has ownership
    if (task.creatorId === user.id) {
      return true;
    }

    // 2. Task assignee has ownership
    if (task.assigneeId === user.id) {
      return true;
    }

    // 3. Project owner or admin can override ownership restriction
    let userRole = request.projectRole || this.roleCacheService.get(user.id, task.projectId);

    if (!userRole) {
      const memberRepo = this.dataSource.getRepository(ProjectMember);
      const membership = await memberRepo.findOne({
        where: { userId: user.id, projectId: task.projectId },
      });
      if (membership) {
        userRole = membership.role;
        this.roleCacheService.set(user.id, task.projectId, userRole);
      }
    }

    if (userRole === ProjectRole.OWNER || userRole === ProjectRole.ADMIN) {
      return true;
    }

    // Otherwise, a member trying to edit another member's task is rejected with 403 Forbidden
    throw new ForbiddenException(
      "Only the task creator, assignee, or a project owner/admin may edit this task",
    );
  }
}
