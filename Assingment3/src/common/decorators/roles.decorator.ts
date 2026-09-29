import { SetMetadata } from "@nestjs/common";
import { ProjectRole } from "../enums/project-role.enum.js";

// ============================================================================
// [C1] CORE REQUIREMENT: Add a @Roles() decorator
// Sets the metadata for allowed roles on the route or controller.
// WHY: Authorization here is per project, not a global admin flag.
// Roles are data: changing a membership row must change access with no code change.
// ============================================================================
export const ROLES_KEY = "roles";
export const Roles = (...roles: ProjectRole[]) => SetMetadata(ROLES_KEY, roles);
