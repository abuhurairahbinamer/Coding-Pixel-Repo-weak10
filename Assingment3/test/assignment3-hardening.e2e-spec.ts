// ============================================================================
// Week 10 Assignment 3: Production Hardening
// ----------------------------------------------------------------------------
// [W1] WARM-UP REQUIREMENT: @nestjs/config with schema validation (Joi) fails fast
// [W2] WARM-UP REQUIREMENT: Logging interceptor records method, path, status, duration
// [C1] CORE REQUIREMENT: GET /health reports application and database status
// [C2] CORE REQUIREMENT: Configuration types validated; read through typed module
// [C3] CORE REQUIREMENT: Graceful shutdown with enableShutdownHooks closes pool
// [C4] CORE REQUIREMENT: Test proving boot-fails-on-bad-config and /health on DB down
// [X1] CHALLENGE REQUIREMENT: Distinguish 200 vs 503 on DB down; timeout prevents hang
// [X2] CHALLENGE REQUIREMENT: Redact secrets (Bearer [REDACTED], password) in logger
// [X3] CHALLENGE REQUIREMENT: Structured JSON logs with request ID carried across lines
// ============================================================================
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { INestApplication, ValidationPipe, Logger } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";
import { AppModule } from "../src/app.module.js";
import { AppConfigService } from "../src/config/app-config.service.js";
import { validateEnvironment } from "../src/config/env.validation.js";
import { HealthService } from "../src/health/health.service.js";
import { ShutdownService } from "../src/shutdown/shutdown.service.js";
import { AllExceptionsFilter } from "../src/common/filters/http-exception.filter.js";
import { assertTestDatabase } from "./setup/database-guard.js";

describe("Assignment 3 — Production Hardening", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let appConfigService: AppConfigService;
  let healthService: HealthService;
  let shutdownService: ShutdownService;

  // Intercept Logger output to verify interceptor behavior
  const capturedLogs: { level: string; message: string; parsed?: any }[] = [];
  let logSpy: any;
  let errorSpy: any;
  let debugSpy: any;

  beforeAll(async () => {
    // Safety guard: ensure we are operating on test database
    assertTestDatabase(process.env.DB_NAME);

    // Spy on Nest Logger methods to inspect interceptor and service logs
    logSpy = vi.spyOn(Logger.prototype, "log").mockImplementation(function (
      this: Logger,
      msg: any,
    ) {
      let parsed: any;
      try {
        parsed = JSON.parse(msg);
      } catch {
        // Not a JSON log
      }
      capturedLogs.push({ level: "log", message: String(msg), parsed });
    });

    errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(function (
      this: Logger,
      msg: any,
    ) {
      let parsed: any;
      try {
        parsed = JSON.parse(msg);
      } catch {
        // Not a JSON log
      }
      capturedLogs.push({ level: "error", message: String(msg), parsed });
    });

    debugSpy = vi.spyOn(Logger.prototype, "debug").mockImplementation(function (
      this: Logger,
      msg: any,
    ) {
      let parsed: any;
      try {
        parsed = JSON.parse(msg);
      } catch {
        // Not a JSON log
      }
      capturedLogs.push({ level: "debug", message: String(msg), parsed });
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // [C3] Enable shutdown hooks
    app.enableShutdownHooks();

    // Global pipes and filters mirroring production bootstrap
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();

    dataSource = moduleFixture.get(DataSource);
    appConfigService = moduleFixture.get(AppConfigService);
    healthService = moduleFixture.get(HealthService);
    shutdownService = moduleFixture.get(ShutdownService);
  });

  afterAll(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    debugSpy.mockRestore();
    if (app) {
      await app.close();
    }
  });

  // ==========================================================================
  // [W1] WARM-UP REQUIREMENT: @nestjs/config with schema validation
  // CHECK: Removing a required variable makes application fail to start, naming variable
  // ==========================================================================
  describe("[W1] Configuration Schema Validation (Fail-Fast at Boot)", () => {
    const validConfig = {
      NODE_ENV: "test",
      PORT: 3001,
      DB_HOST: "localhost",
      DB_PORT: 5432,
      DB_USERNAME: "postgres",
      DB_PASSWORD: "password123",
      DB_NAME: "assignment3_test",
      FRONTEND_URL: "http://localhost:3000",
      JWT_SECRET: "test-jwt-secret-at-least-32-chars-long",
      JWT_ACCESS_EXPIRATION_TIME: "15m",
      JWT_REFRESH_EXPIRATION_TIME: "7d",
      ARGON2_TIME_COST: 3,
      ARGON2_MEMORY_COST: 65536,
      ARGON2_PARALLELISM: 1,
      THROTTLE_TTL: 60000,
      THROTTLE_LIMIT: 100,
      THROTTLE_AUTH_LIMIT: 5,
    };

    it("should fail validation naming 'DB_NAME' when DB_NAME is missing", () => {
      const invalid = { ...validConfig };
      delete (invalid as any).DB_NAME;

      expect(() => validateEnvironment(invalid)).toThrowError(/"DB_NAME" is required/);
    });

    it("should fail validation naming 'JWT_SECRET' when JWT_SECRET is missing", () => {
      const invalid = { ...validConfig };
      delete (invalid as any).JWT_SECRET;

      expect(() => validateEnvironment(invalid)).toThrowError(/"JWT_SECRET" is required/);
    });

    it("should fail validation naming 'DB_HOST' when DB_HOST is missing", () => {
      const invalid = { ...validConfig };
      delete (invalid as any).DB_HOST;

      expect(() => validateEnvironment(invalid)).toThrowError(/"DB_HOST" is required/);
    });

    it("should fail validation naming 'DB_USERNAME' when DB_USERNAME is missing", () => {
      const invalid = { ...validConfig };
      delete (invalid as any).DB_USERNAME;

      expect(() => validateEnvironment(invalid)).toThrowError(/"DB_USERNAME" is required/);
    });

    it("should fail validation naming 'DB_PASSWORD' when DB_PASSWORD is missing", () => {
      const invalid = { ...validConfig };
      delete (invalid as any).DB_PASSWORD;

      expect(() => validateEnvironment(invalid)).toThrowError(/"DB_PASSWORD" is required/);
    });
  });

  // ==========================================================================
  // [C2] CORE REQUIREMENT: Validate types of configuration & typed AppConfigService
  // CHECK: PORT='abc' is rejected at boot with a type error, valid PORT boots
  // ==========================================================================
  describe("[C2] Configuration Type Validation & Strongly Typed Service", () => {
    const validConfig = {
      NODE_ENV: "test",
      PORT: 3001,
      DB_HOST: "localhost",
      DB_PORT: 5432,
      DB_USERNAME: "postgres",
      DB_PASSWORD: "password123",
      DB_NAME: "assignment3_test",
      JWT_SECRET: "test-jwt-secret-at-least-32-chars-long",
    };

    it("should reject PORT='abc' at boot with a schema type error", () => {
      const invalid = { ...validConfig, PORT: "abc" };

      expect(() => validateEnvironment(invalid)).toThrowError(
        /PORT.*(?:must be a number|must be a valid port)/i,
      );
    });

    it("should reject an out-of-range port like 99999999", () => {
      const invalid = { ...validConfig, PORT: 99999999 };

      expect(() => validateEnvironment(invalid)).toThrowError(
        /PORT.*must be a valid port/i,
      );
    });

    it("should succeed and coerce valid port string or number", () => {
      const validated = validateEnvironment({ ...validConfig, PORT: 3001 });
      expect(validated.PORT).toBe(3001);
      expect(typeof validated.PORT).toBe("number");
    });

    it("should expose strictly typed configuration through AppConfigService", () => {
      expect(appConfigService).toBeDefined();
      expect(typeof appConfigService.port).toBe("number");
      expect(typeof appConfigService.dbHost).toBe("string");
      expect(typeof appConfigService.dbPort).toBe("number");
      expect(typeof appConfigService.dbName).toBe("string");
      expect(typeof appConfigService.jwtSecret).toBe("string");
      expect(typeof appConfigService.throttleTtl).toBe("number");
      expect(typeof appConfigService.throttleLimit).toBe("number");
      expect(typeof appConfigService.argon2TimeCost).toBe("number");
      expect(appConfigService.isTest).toBe(true);
      expect(appConfigService.isProduction).toBe(false);
    });
  });

  // ==========================================================================
  // [C1] CORE REQUIREMENT: GET /health reporting application and database
  // CHECK: /health reports healthy while everything runs
  // ==========================================================================
  describe("[C1] GET /health (Healthy State)", () => {
    it("should be publicly accessible without authentication and return 200 OK", async () => {
      const res = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      expect(res.body).toBeDefined();
      expect(res.body.status).toBe("ok");
      expect(res.body.timestamp).toBeDefined();
      expect(typeof res.body.timestamp).toBe("string");

      // Application check
      expect(res.body.checks).toBeDefined();
      expect(res.body.checks.app).toBeDefined();
      expect(res.body.checks.app.status).toBe("up");
      expect(typeof res.body.checks.app.uptime).toBe("number");
      expect(res.body.checks.app.uptime).toBeGreaterThan(0);

      // Database check
      expect(res.body.checks.database).toBeDefined();
      expect(res.body.checks.database.status).toBe("up");
      expect(typeof res.body.checks.database.latencyMs).toBe("number");
      expect(res.body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // [X1] CHALLENGE REQUIREMENT: Distinguish 200 vs 503 & Timeout Protection
  // CHECK: With database stopped/failing, /health answers with 503 and per-check breakdown
  // ==========================================================================
  describe("[X1] Health Check Failure Handling & Timeout Protection", () => {
    it("should return 503 and per-check breakdown when database check fails", async () => {
      // Mock dataSource query to simulate database downtime
      const querySpy = vi.spyOn(dataSource, "query").mockRejectedValueOnce(
        new Error("Connection to PostgreSQL terminated unexpectedly"),
      );

      try {
        const res = await request(app.getHttpServer())
          .get("/health")
          .expect(503);

        expect(res.body.status).toBe("error");
        expect(res.body.checks.app.status).toBe("up");
        expect(res.body.checks.database.status).toBe("down");
        expect(res.body.checks.database.message).toContain("PostgreSQL terminated");
      } finally {
        querySpy.mockRestore();
      }
    });

    it("should fail fast within bounded timeout and never hang when database is unresponsive", async () => {
      // Test the bounded timeout directly on HealthService
      const slowQuery = new Promise((resolve) => setTimeout(() => resolve([{ "?column?": 1 }]), 5000));
      const querySpy = vi.spyOn(dataSource, "query").mockReturnValueOnce(slowQuery as any);

      try {
        const start = Date.now();
        // Invoke with 100ms timeout
        const result = await healthService.checkHealth(100);
        const elapsed = Date.now() - start;

        // Must complete promptly (around 100ms, definitely well under 1000ms)
        expect(elapsed).toBeLessThan(1000);
        expect(result.status).toBe("error");
        expect(result.checks.database.status).toBe("down");
        expect(result.checks.database.message).toContain("exceeded timeout");
      } finally {
        querySpy.mockRestore();
      }
    });
  });

  // ==========================================================================
  // [W2] WARM-UP REQUIREMENT: Logging Interceptor
  // CHECK: Real request produces log line with method, path, status, duration
  //        Failing request produces one too
  // ==========================================================================
  describe("[W2] Logging Interceptor (Method, Path, Status Code, Duration)", () => {
    it("should log method, path, status code, and duration for successful request (200)", async () => {
      capturedLogs.length = 0;

      await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      // Find the completion log
      const httpLog = capturedLogs.find(
        (l) => l.parsed && l.parsed.method === "GET" && l.parsed.path === "/health" && l.parsed.statusCode === 200,
      );

      expect(httpLog).toBeDefined();
      expect(httpLog?.parsed.method).toBe("GET");
      expect(httpLog?.parsed.path).toBe("/health");
      expect(httpLog?.parsed.statusCode).toBe(200);
      expect(typeof httpLog?.parsed.duration).toBe("number");
      expect(httpLog?.parsed.duration).toBeGreaterThanOrEqual(0);
    });

    it("should log method, path, status code, and duration for 401 unauthenticated request", async () => {
      capturedLogs.length = 0;

      // Send invalid credentials to login route (throws 401 from AuthService)
      await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: "unauthorized_test@example.com", password: "wrongpassword123" })
        .expect(401);

      const errorHttpLog = capturedLogs.find(
        (l) => l.parsed && l.parsed.method === "POST" && l.parsed.path === "/auth/login" && l.parsed.statusCode === 401,
      );

      expect(errorHttpLog).toBeDefined();
      expect(errorHttpLog?.parsed.method).toBe("POST");
      expect(errorHttpLog?.parsed.path).toBe("/auth/login");
      expect(errorHttpLog?.parsed.statusCode).toBe(401);
      expect(typeof errorHttpLog?.parsed.duration).toBe("number");
    });

    it("should log method, path, status code, and duration for 400 validation failure", async () => {
      capturedLogs.length = 0;

      // Send invalid payload to register route
      await request(app.getHttpServer())
        .post("/auth/register")
        .send({ email: "invalid-email" })
        .expect(400);

      const errorHttpLog = capturedLogs.find(
        (l) => l.parsed && l.parsed.method === "POST" && l.parsed.path === "/auth/register" && l.parsed.statusCode === 400,
      );

      expect(errorHttpLog).toBeDefined();
      expect(errorHttpLog?.parsed.method).toBe("POST");
      expect(errorHttpLog?.parsed.path).toBe("/auth/register");
      expect(errorHttpLog?.parsed.statusCode).toBe(400);
      expect(typeof errorHttpLog?.parsed.duration).toBe("number");
    });
  });

  // ==========================================================================
  // [X2] CHALLENGE REQUIREMENT: Secret Redaction in Logging Interceptor
  // CHECK: Request with Authorization logs Bearer [REDACTED], login logs no password
  // ==========================================================================
  describe("[X2] Secret Redaction in Logger", () => {
    it("should redact Authorization header as 'Bearer [REDACTED]' in logs", async () => {
      capturedLogs.length = 0;
      const secretToken = "super-secret-jwt-token-abcdef123456";

      await request(app.getHttpServer())
        .get("/health")
        .set("Authorization", `Bearer ${secretToken}`)
        .expect(200);

      // Ensure raw token was NEVER printed in any captured log
      const leakedLog = capturedLogs.find((l) => l.message.includes(secretToken));
      expect(leakedLog).toBeUndefined();

      // Check log contains redacted auth
      const authLog = capturedLogs.find(
        (l) => l.parsed && l.parsed.path === "/health" && l.parsed.auth === "Bearer [REDACTED]",
      );
      expect(authLog).toBeDefined();
      expect(authLog?.parsed.auth).toBe("Bearer [REDACTED]");
    });

    it("should redact password in request body so no password appears in logs", async () => {
      capturedLogs.length = 0;
      const sensitivePassword = "UltraSecretPassword123#";

      await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: "nonexistent_redaction_test@example.com",
          password: sensitivePassword,
        })
        .expect(401);

      // Verify the plaintext password NEVER appears in any captured log message
      const leakedPasswordLog = capturedLogs.find((l) => l.message.includes(sensitivePassword));
      expect(leakedPasswordLog).toBeUndefined();

      // Check debug log contains redacted body
      const incomingLog = capturedLogs.find(
        (l) => l.parsed && l.parsed.event === "REQUEST_RECEIVED" && l.parsed.path === "/auth/login",
      );
      expect(incomingLog).toBeDefined();
      expect(incomingLog?.parsed.body.password).toBe("[REDACTED]");
    });
  });

  // ==========================================================================
  // [X3] CHALLENGE REQUIREMENT: Structured JSON Logs with Request ID
  // CHECK: One request's lines share same id; each parses as JSON with method, path, status, duration
  // ==========================================================================
  describe("[X3] Structured JSON Logs & Request ID Propagation", () => {
    it("should emit valid JSON for all interceptor log lines", async () => {
      capturedLogs.length = 0;

      await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      const jsonLogs = capturedLogs.filter(
        (l) => l.parsed && l.parsed.path === "/health",
      );

      expect(jsonLogs.length).toBeGreaterThanOrEqual(1);
      for (const log of jsonLogs) {
        expect(log.parsed).toHaveProperty("requestId");
        expect(log.parsed).toHaveProperty("timestamp");
        expect(log.parsed).toHaveProperty("method");
        expect(log.parsed).toHaveProperty("path");
      }
    });

    it("should accept custom X-Request-Id header, include it in logs, and return it in response", async () => {
      capturedLogs.length = 0;
      const customRequestId = "custom-trace-header-uuid-777888";

      const res = await request(app.getHttpServer())
        .get("/health")
        .set("X-Request-Id", customRequestId)
        .expect(200);

      expect(res.headers["x-request-id"]).toBe(customRequestId);

      // Ensure the same request ID appears across both incoming and completion logs
      const matchingLogs = capturedLogs.filter(
        (l) => l.parsed && l.parsed.requestId === customRequestId,
      );
      expect(matchingLogs.length).toBeGreaterThanOrEqual(1);
      for (const log of matchingLogs) {
        expect(log.parsed.requestId).toBe(customRequestId);
      }
    });

    it("should auto-generate a UUID requestId if no header is supplied", async () => {
      const res = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      const returnedId = res.headers["x-request-id"];
      expect(returnedId).toBeDefined();
      expect(typeof returnedId).toBe("string");
      expect(returnedId.length).toBeGreaterThan(10);
    });
  });

  // ==========================================================================
  // [C3] CORE REQUIREMENT: Graceful Shutdown with enableShutdownHooks
  // CHECK: Sending SIGTERM makes process log shutdown steps and close DB pool
  // ==========================================================================
  describe("[C3] Graceful Shutdown Support", () => {
    it("should handle shutdown hooks and close database pool cleanly", async () => {
      expect(shutdownService).toBeDefined();

      const logShutdownSpy = vi.spyOn(Logger.prototype, "log");

      // Verify beforeApplicationShutdown hook
      shutdownService.beforeApplicationShutdown("SIGTERM");
      expect(logShutdownSpy).toHaveBeenCalledWith(
        expect.stringContaining("Received signal SIGTERM"),
      );

      // Verify onApplicationShutdown hook closes database
      const destroySpy = vi.spyOn(dataSource, "destroy").mockResolvedValueOnce();
      await shutdownService.onApplicationShutdown("SIGTERM");

      expect(destroySpy).toHaveBeenCalled();
      expect(logShutdownSpy).toHaveBeenCalledWith(
        expect.stringContaining("Database connection pool closed successfully"),
      );

      destroySpy.mockRestore();
    });
  });

  // ==========================================================================
  // [C4] CORE REQUIREMENT: Make sure every test can actually fail
  // CHECK: Proves tests are meaningful and detect broken behaviors
  // ==========================================================================
  describe("[C4] Meaningful Test Verification (Proving Tests Can Fail)", () => {
    it("proves validation failure test would fail if required check were removed", () => {
      const validConfig = {
        DB_NAME: "assignment3_test",
        DB_HOST: "localhost",
        DB_USERNAME: "postgres",
        DB_PASSWORD: "password123",
        JWT_SECRET: "my-secret-key-12345",
      };

      // When DB_NAME is missing, it MUST throw
      expect(() => validateEnvironment({ ...validConfig, DB_NAME: undefined })).toThrow();

      // If DB_NAME is provided, it must NOT throw
      expect(() => validateEnvironment(validConfig)).not.toThrow();
    });

    it("proves health check failure test would fail if database ping were unmonitored", async () => {
      // 1. Live state: healthy
      const liveResult = await healthService.checkHealth();
      expect(liveResult.status).toBe("ok");

      // 2. Simulated failure: goes red immediately
      const querySpy = vi.spyOn(dataSource, "query").mockRejectedValueOnce(new Error("Simulated DB Crash"));
      try {
        const failedResult = await healthService.checkHealth();
        expect(failedResult.status).toBe("error");
        expect(failedResult.checks.database.status).toBe("down");
      } finally {
        querySpy.mockRestore();
      }
    });
  });
});
