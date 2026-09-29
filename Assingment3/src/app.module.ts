// ============================================================================
// Week 10 Assignment 3: Production Hardening
// [W1] WARM-UP REQUIREMENT: @nestjs/config with schema validation (Joi)
// [W2] WARM-UP REQUIREMENT: Global logging interceptor (method, path, status, duration)
// [C1] CORE REQUIREMENT: GET /health reporting application and database
// [C2] CORE REQUIREMENT: Strictly typed configuration via AppConfigModule & AppConfigService
// [C3] CORE REQUIREMENT: Graceful shutdown support via enableShutdownHooks
// [X1] CHALLENGE REQUIREMENT: Distinguish 200 vs 503 on database down and fast timeout
// [X2] CHALLENGE REQUIREMENT: Secret redaction in logger
// [X3] CHALLENGE REQUIREMENT: Structured JSON logs with request ID
// ============================================================================
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AppConfigModule } from "./config/app-config.module.js";
import { AppConfigService } from "./config/app-config.service.js";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { AuthModule } from "./auth/auth.module.js";
import { UsersModule } from "./users/users.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { CommentsModule } from "./comments/comments.module.js";
import { HealthModule } from "./health/health.module.js";
import { ShutdownModule } from "./shutdown/shutdown.module.js";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard.js";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter.js";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor.js";
import { AppThrottlerStorage } from "./common/throttler/app-throttler-storage.js";

@Module({
  imports: [
    // [W1] & [C2] Validated typed configuration module
    AppConfigModule,

    // [W1] Throttler configuration reading from typed AppConfigService
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        storage: new AppThrottlerStorage(),
        throttlers: [
          {
            name: "default",
            ttl: config.throttleTtl,
            limit: config.throttleLimit,
          },
        ],
        getTracker: (req: Record<string, any>) => {
          const forwarded = req.headers?.["x-forwarded-for"];
          const ip = forwarded
            ? String(forwarded).split(",")[0].trim()
            : req.ip || "127.0.0.1";
          const email = req.body?.email
            ? String(req.body.email).toLowerCase().trim()
            : "";
          return email ? `${ip}:${email}` : ip;
        },
        errorMessage: "Too Many Requests: Rate limit exceeded. Please try again later.",
      }),
    }),

    // Database connection configured via typed AppConfigService
    TypeOrmModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        type: "postgres" as const,
        host: config.dbHost,
        port: config.dbPort,
        username: config.dbUsername,
        password: config.dbPassword,
        database: config.dbName,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),

    AuthModule,
    UsersModule,
    ProjectsModule,
    TasksModule,
    CommentsModule,
    // [C1] & [X1] HealthModule providing GET /health
    HealthModule,
    // [C3] Graceful shutdown lifecycle management
    ShutdownModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // ThrottlerGuard executes first
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Global JwtAuthGuard enforcing authentication by default
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Global exception filter guaranteeing uniform 5-field error responses
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // [W2, X2, X3] Global LoggingInterceptor with structured JSON, request ID and secret redaction
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
