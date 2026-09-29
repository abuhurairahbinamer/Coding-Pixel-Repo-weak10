// ============================================================================
// Week 10 Assignment 3: Production Hardening
// [C1] CORE REQUIREMENT: GET /health endpoint reporting application and database
// [X1] CHALLENGE REQUIREMENT: Distinguish 200 (healthy) vs 503 (database down)
// ============================================================================
import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import type { Response } from "express";
import { HealthService } from "./health.service.js";
import { Public } from "../common/decorators/public.decorator.js";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @Public()
  async getHealth(@Res({ passthrough: true }) res: Response) {
    const health = await this.healthService.checkHealth();

    // [X1] Return 503 when any dependency (such as the database) fails
    if (health.status !== "ok" || health.checks.database.status === "down") {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    } else {
      res.status(HttpStatus.OK);
    }

    return health;
  }
}
