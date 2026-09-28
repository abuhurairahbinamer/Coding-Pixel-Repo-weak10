import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import Joi from "joi";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { AuthModule } from "./auth/auth.module.js";
import { UsersModule } from "./users/users.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { CommentsModule } from "./comments/comments.module.js";
import { JwtAuthGuard } from "./auth/guards/jwt-auth.guard.js";
import { AllExceptionsFilter } from "./common/filters/http-exception.filter.js";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor.js";
import { AppThrottlerStorage } from "./common/throttler/app-throttler-storage.js";

// ============================================================================
// [W1] WARM-UP REQUIREMENT: Global rate limiting with @nestjs/throttler
// [C1] CORE REQUIREMENT: Global exception filter returning 5 consistent fields
// [C4] CORE REQUIREMENT: Global JwtAuthGuard ensures authentication runs before RolesGuard
// [X2] CHALLENGE REQUIREMENT: Global logging interceptor with secret redaction
// [X2] CHALLENGE REQUIREMENT: Invert the default by applying JwtAuthGuard globally
// ============================================================================
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === "test" ? [".env.test", ".env"] : [".env"],
      validationSchema: Joi.object({
        DB_HOST: Joi.string().required(),
        DB_PORT: Joi.number().default(5432),
        DB_USERNAME: Joi.string().required(),
        DB_PASSWORD: Joi.string().required(),
        DB_NAME: Joi.string().required(),
        PORT: Joi.number().default(3000),

        // [W2] Frontend URL for CORS
        FRONTEND_URL: Joi.string().default("http://localhost:3000"),

        // [C2] JWT Secret and expiration configurations
        JWT_SECRET: Joi.string().required(),
        JWT_ACCESS_EXPIRATION_TIME: Joi.string().default("15m"),
        JWT_REFRESH_EXPIRATION_TIME: Joi.string().default("7d"),

        // [X3] Argon2 cost parameters
        ARGON2_TIME_COST: Joi.number().default(3),
        ARGON2_MEMORY_COST: Joi.number().default(65536),
        ARGON2_PARALLELISM: Joi.number().default(1),

        // [W1] Throttler parameters
        THROTTLE_TTL: Joi.number().default(60000),
        THROTTLE_LIMIT: Joi.number().default(100),
        THROTTLE_AUTH_LIMIT: Joi.number().default(5),

        // [X3] Environment
        NODE_ENV: Joi.string().default("development"),
      }),
    }),

    // [W1] Configure global ThrottlerModule with hybrid IP+Account tracker & isolated storage
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        storage: new AppThrottlerStorage(),
        throttlers: [
          {
            name: "default",
            ttl: Number(configService.get<number>("THROTTLE_TTL", 60000)),
            limit: Number(configService.get<number>("THROTTLE_LIMIT", 100)),
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

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: "postgres" as const,
        host: configService.getOrThrow<string>("DB_HOST"),
        port: Number(configService.getOrThrow<string>("DB_PORT")),
        username: configService.getOrThrow<string>("DB_USERNAME"),
        password: configService.getOrThrow<string>("DB_PASSWORD"),
        database: configService.getOrThrow<string>("DB_NAME"),
        autoLoadEntities: true,
        // [W1] Check: synchronize remains strictly false across the whole application
        synchronize: false,
      }),
    }),

    AuthModule,
    UsersModule,
    ProjectsModule,
    TasksModule,
    CommentsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // [W1] Edge ThrottlerGuard executes first (returning 429 when rate limit is exceeded)
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // [X2] Global JwtAuthGuard enforcing authentication by default (returning 401 when unauthenticated)
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // [C1] Global AllExceptionsFilter guaranteeing uniform 5-field error responses
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // [X2] Global LoggingInterceptor with automatic sensitive key redaction
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
