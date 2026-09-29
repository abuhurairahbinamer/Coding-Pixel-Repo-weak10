// ============================================================================
// Week 10 Assignment 3: Production Hardening
// [C3] CORE REQUIREMENT: ShutdownModule
// ============================================================================
import { Module } from "@nestjs/common";
import { ShutdownService } from "./shutdown.service.js";

@Module({
  providers: [ShutdownService],
  exports: [ShutdownService],
})
export class ShutdownModule {}
