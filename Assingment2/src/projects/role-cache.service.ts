import { Injectable } from "@nestjs/common";
import { ProjectRole } from "../common/enums/project-role.enum.js";

interface CacheEntry {
  role: ProjectRole;
  expiresAt: number;
}

// ============================================================================
// [X3] CHALLENGE REQUIREMENT: Cache the role lookup and handle the invalidation
// WHY: The guard hits project_members on every protected request, which makes it
// the most repeated query in the application.
// HINT: Cache per user and project with a short lifetime, and clear the entry
// when a membership row changes.
// CHECK: Repeated requests no longer query project_members every time, and revoking
// a membership takes effect immediately rather than when the cache expires.
// WORST-CASE STALENESS WINDOW: 60 seconds (for out-of-band DB updates),
// and 0 seconds (immediate invalidation) for application-level membership updates.
// ============================================================================
@Injectable()
export class RoleCacheService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly defaultTtlMs = 60 * 1000; // 60 seconds worst-case staleness window

  private getCacheKey(userId: number, projectId: number): string {
    return `${userId}:${projectId}`;
  }

  // [X3] Retrieve cached role if exists and not expired
  get(userId: number, projectId: number): ProjectRole | null {
    const key = this.getCacheKey(userId, projectId);
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.role;
  }

  // [X3] Cache user role for project with TTL
  set(userId: number, projectId: number, role: ProjectRole, ttlMs = this.defaultTtlMs): void {
    const key = this.getCacheKey(userId, projectId);
    this.cache.set(key, {
      role,
      expiresAt: Date.now() + ttlMs,
    });
  }

  // [X3] Invalidate specific user's cached role for a project immediately
  invalidate(userId: number, projectId: number): void {
    const key = this.getCacheKey(userId, projectId);
    this.cache.delete(key);
  }

  // [X3] Invalidate all cached roles for a project
  invalidateProject(projectId: number): void {
    const prefix = `:${projectId}`;
    for (const key of this.cache.keys()) {
      if (key.endsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  // [X3] Clear entire cache (e.g. for testing)
  clear(): void {
    this.cache.clear();
  }

  // [X3] Documented worst-case staleness window in seconds
  getStalenessWindowSeconds(): number {
    return this.defaultTtlMs / 1000;
  }
}
