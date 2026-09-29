// ============================================================================
// Week 10 Assignment 3: Production Hardening
// [W1] WARM-UP REQUIREMENT: @nestjs/config schema validation
// [C2] CORE REQUIREMENT: Global typed configuration module
// ============================================================================
import { Global, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnvironment } from "./env.validation.js";
import { AppConfigService } from "./app-config.service.js";

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === "test" ? [".env.test", ".env"] : [".env"],
      validate: validateEnvironment,
    }),
  ],
  providers: [AppConfigService],
  exports: [ConfigModule, AppConfigService],
})
export class AppConfigModule {}
