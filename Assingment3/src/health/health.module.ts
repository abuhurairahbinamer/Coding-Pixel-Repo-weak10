// ============================================================================
// Week 10 Assignment 3: Production Hardening
// [C1] CORE REQUIREMENT: HealthModule exposing GET /health
// ============================================================================
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
