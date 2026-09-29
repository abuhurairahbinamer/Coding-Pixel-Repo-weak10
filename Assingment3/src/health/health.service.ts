// ============================================================================
// Week 10 Assignment 3: Production Hardening
// [C1] CORE REQUIREMENT: GET /health reporting application and database status
// [X1] CHALLENGE REQUIREMENT: Distinguish 'application up, database down' with 503
//      and bounded query timeout so health checks never hang
// ============================================================================
import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";

export interface ComponentHealth {
  status: "up" | "down";
  [key: string]: unknown;
}

export interface HealthCheckResponse {
  status: "ok" | "error";
  timestamp: string;
  checks: {
    app: ComponentHealth;
    database: ComponentHealth;
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Performs an active health check on the application and database.
   * [X1] Enforces a strict timeout (default 2500ms) on the database query so slow links fail fast.
   */
  async checkHealth(timeoutMs = 2500): Promise<HealthCheckResponse> {
    const timestamp = new Date().toISOString();

    // 1. Application check: process uptime and status
    const appHealth: ComponentHealth = {
      status: "up",
      uptime: Math.round(process.uptime() * 100) / 100,
    };

    // 2. Database check: execute trivial 'SELECT 1' with bounded timeout
    let databaseHealth: ComponentHealth;
    const dbStart = Date.now();

    try {
      if (!this.dataSource || !this.dataSource.isInitialized) {
        throw new Error("DataSource is not initialized");
      }

      // [X1] Timeout race condition to guarantee check never hangs
      const pingQuery = this.dataSource.query("SELECT 1");
      const timeoutPromise = new Promise((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Database check exceeded timeout of ${timeoutMs}ms`));
        }, timeoutMs);
        // Unref timer so it doesn't block process exit in tests
        if (typeof timer.unref === "function") {
          timer.unref();
        }
      });

      await Promise.race([pingQuery, timeoutPromise]);
      const latencyMs = Date.now() - dbStart;

      databaseHealth = {
        status: "up",
        latencyMs,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Database health check failed: ${errorMsg}`);

      // [X1] Explicitly mark database as down with detailed reason
      databaseHealth = {
        status: "down",
        message: errorMsg,
      };
    }

    // Determine overall health status
    const isOverallHealthy = appHealth.status === "up" && databaseHealth.status === "up";

    return {
      status: isOverallHealthy ? "ok" : "error",
      timestamp,
      checks: {
        app: appHealth,
        database: databaseHealth,
      },
    };
  }
}
