// ============================================================================
// Week 10 Assignment 3: Production Hardening
// [C3] CORE REQUIREMENT: Graceful shutdown handling via enableShutdownHooks
// ============================================================================
import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from "@nestjs/common";
import { DataSource } from "typeorm";

@Injectable()
export class ShutdownService
  implements BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger("GracefulShutdown");

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Invoked when a termination signal (SIGTERM, SIGINT) is received.
   * Stops accepting new connections and allows in-flight requests to complete.
   */
  beforeApplicationShutdown(signal?: string) {
    this.logger.log(
      `[GracefulShutdown] Received signal ${signal ?? "SIGTERM"}. Draining in-flight requests and stopping new connections...`,
    );
  }

  /**
   * Invoked after connections have drained.
   * Closes database pools and tears down remaining resources.
   */
  async onApplicationShutdown(signal?: string) {
    this.logger.log(
      `[GracefulShutdown] Closing database connection pool for signal ${signal ?? "SIGTERM"}...`,
    );

    if (this.dataSource && this.dataSource.isInitialized) {
      await this.dataSource.destroy();
      this.logger.log("[GracefulShutdown] Database connection pool closed successfully.");
    }

    this.logger.log("[GracefulShutdown] Application shutdown completed gracefully.");
  }
}
