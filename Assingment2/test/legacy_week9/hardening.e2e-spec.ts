// ============================================================================
// WEEK 9 ASSIGNMENT 3: SECURITY HARDENING & OWASP TOP-10 E2E TEST SUITE
// Covers:
// - [W1] & [C5] Rate-limiting with @nestjs/throttler (rapid logins return 429 after limit)
// - [W2] & [X1] Helmet security headers (CSP) and restrictive CORS (allow localhost:3000, block evil.com)
// - [C1] & [C5] Global exception filter returning exactly 5 fields: statusCode, message, error, timestamp, path
// - [C2] Strict validation everywhere preventing mass assignment (whitelist & forbidNonWhitelisted reject with 400)
// - [C3] Route parameter validation with ParsePositiveIntPipe (:id must be positive integer; /tasks/abc returns 400)
// - [X2] Secret redaction: 500 error leaks no password/token/stack, logging interceptor redacts credentials
// - [X3] Environment-dependent filter behavior (generic in production, descriptive in development)
// ============================================================================
import { INestApplication, ValidationPipe, ForbiddenException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import helmet from "helmet";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { AllExceptionsFilter } from "../src/common/filters/http-exception.filter.js";
import { AppThrottlerStorage } from "../src/common/throttler/app-throttler-storage.js";
import { sanitizeData } from "../src/common/utils/sanitizer.util.js";

describe("Week 9 Assignment 3: Security Hardening (e2e)", () => {
  let app: INestApplication;
  const allowedOrigin = "http://localhost:3000";
  const disallowedOrigin = "http://evil-attacker.com";

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.ARGON2_TIME_COST = "1";
    process.env.ARGON2_MEMORY_COST = "1024";
    process.env.ARGON2_PARALLELISM = "1";

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // [W2] & [X1] Helmet with CSP
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
          },
        },
        crossOriginEmbedderPolicy: false,
      }),
    );

    // [W2] CORS policy
    app.enableCors({
      origin: (origin, callback) => {
        if (!origin || origin === allowedOrigin) {
          callback(null, true);
        } else {
          callback(
            new ForbiddenException(
              `Disallowed by CORS: origin '${origin}' is not permitted`,
            ),
            false,
          );
        }
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    });

    // [C2] Strict validation pipe
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    // [C1] Global exception filter
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
  });

  beforeEach(() => {
    // [C5] Clean slate: reset throttler storage before each test
    AppThrottlerStorage.reset();
  });

  afterAll(async () => {
    AppThrottlerStorage.reset();
    await app.close();
  });

  // ==========================================================================
  // [W1] & [C5] RATE LIMITING / THROTTLER TESTS
  // ==========================================================================
  describe("Rate Limiting with @nestjs/throttler [W1, C5]", () => {
    it("should allow requests within limit and return 429 Too Many Requests on rapid repeated logins", async () => {
      const throttledIp = "203.0.113.42";
      const loginPayload = {
        email: "throttled_victim@example.com",
        password: "WrongPassword123!",
      };

      // Calls 1 to 5: all within limit (expect 401 for wrong credentials, NOT 429)
      for (let i = 1; i <= 5; i++) {
        const res = await request(app.getHttpServer())
          .post("/auth/login")
          .set("X-Forwarded-For", throttledIp)
          .send(loginPayload);

        expect(res.status).toBe(401);
      }

      // Call 6: exceeds rate limit of 5 requests/min -> must return 429
      const throttledRes = await request(app.getHttpServer())
        .post("/auth/login")
        .set("X-Forwarded-For", throttledIp)
        .send(loginPayload);

      expect(throttledRes.status).toBe(429);
      expect(throttledRes.body).toHaveProperty("statusCode", 429);
      expect(throttledRes.body).toHaveProperty("error", "Too Many Requests");
      expect(throttledRes.body).toHaveProperty("message");
      expect(throttledRes.body).toHaveProperty("timestamp");
      expect(throttledRes.body).toHaveProperty("path", "/auth/login");
    });

    it("should allow normal pace / different client without inheriting previous 429 [C5 Isolation]", async () => {
      // Different IP / account should not be throttled
      const cleanIp = "203.0.113.99";
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .set("X-Forwarded-For", cleanIp)
        .send({
          email: "another_user@example.com",
          password: "SomePassword!",
        });

      expect(res.status).toBe(401); // 401 invalid creds, not 429
    });
  });

  // ==========================================================================
  // [C1] & [C5] ERROR SHAPE CONSISTENCY TESTS
  // ==========================================================================
  describe("Global Exception Filter & Error Shape [C1, C5]", () => {
    it("should return consistent 5-field error shape on a triggered 400 Bad Request", async () => {
      // Trigger a 400 via invalid body
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: "not-an-email" }); // missing password, invalid email format

      expect(res.status).toBe(400);

      const keys = Object.keys(res.body).sort();
      expect(keys).toEqual(["error", "message", "path", "statusCode", "timestamp"]);
      expect(res.body.statusCode).toBe(400);
      expect(res.body.error).toBe("Bad Request");
      expect(res.body.path).toBe("/auth/login");
      expect(typeof res.body.timestamp).toBe("string");
      expect(new Date(res.body.timestamp).getTime()).not.toBeNaN();
    });

    it("should return consistent 5-field error shape on a triggered 404 Not Found", async () => {
      const nonexistentPath = "/api/v1/non-existent-resource-xyz";
      const res = await request(app.getHttpServer()).get(nonexistentPath);

      expect(res.status).toBe(404);

      const keys = Object.keys(res.body).sort();
      expect(keys).toEqual(["error", "message", "path", "statusCode", "timestamp"]);
      expect(res.body.statusCode).toBe(404);
      expect(res.body.error).toBe("Not Found");
      expect(res.body.path).toBe(nonexistentPath);
      expect(typeof res.body.timestamp).toBe("string");
    });
  });

  // ==========================================================================
  // [C2] STRICT VALIDATION & MASS ASSIGNMENT PREVENTION
  // ==========================================================================
  describe("Strict Validation & Mass Assignment Prevention [C2]", () => {
    it("should reject request with 400 Bad Request when unknown field (role) is passed", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/register")
        .send({
          name: "Attacker",
          email: "attacker@example.com",
          password: "Password123!",
          role: "admin", // Unwhitelisted property (mass assignment attempt)
          isAdmin: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Bad Request");
      // Message should mention that property should not exist
      const messageStr = JSON.stringify(res.body.message);
      expect(messageStr).toMatch(/should not exist/i);
    });
  });

  // ==========================================================================
  // [C3] ROUTE PARAMETER VALIDATION (ParsePositiveIntPipe)
  // ==========================================================================
  describe("Route Parameter Validation (ParsePositiveIntPipe) [C3]", () => {
    it("GET /tasks/abc returns 400 Bad Request before reaching database", async () => {
      const res = await request(app.getHttpServer()).get("/tasks/abc");

      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe(400);
      expect(res.body.error).toBe("Bad Request");
      expect(res.body.message).toContain("positive integer");
    });

    it("GET /tasks/0 returns 400 Bad Request (non-positive)", async () => {
      const res = await request(app.getHttpServer()).get("/tasks/0");

      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe(400);
      expect(res.body.error).toBe("Bad Request");
    });

    it("GET /tasks/-5 returns 400 Bad Request (negative)", async () => {
      const res = await request(app.getHttpServer()).get("/tasks/-5");

      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe(400);
      expect(res.body.error).toBe("Bad Request");
    });

    it("GET /projects/not-a-number returns 400 Bad Request", async () => {
      const res = await request(app.getHttpServer()).get("/projects/not-a-number");

      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe(400);
    });

    it("GET /comments/0 returns 400 Bad Request", async () => {
      const res = await request(app.getHttpServer()).get("/comments/0");

      expect(res.status).toBe(400);
      expect(res.body.statusCode).toBe(400);
    });
  });

  // ==========================================================================
  // [W2] & [X1] HELMET SECURITY HEADERS & RESTRICTIVE CORS
  // ==========================================================================
  describe("Helmet Security Headers & CORS Policy [W2, X1]", () => {
    it("should include security headers (CSP, X-Content-Type-Options, etc.)", async () => {
      const res = await request(app.getHttpServer()).get("/");

      // Helmet security headers
      expect(res.headers).toHaveProperty("content-security-policy");
      expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
      expect(res.headers["content-security-policy"]).toContain("frame-src 'none'");
      expect(res.headers).toHaveProperty("x-content-type-options", "nosniff");
      expect(res.headers).toHaveProperty("x-frame-options", "SAMEORIGIN");
    });

    it("should allow request from authorized origin http://localhost:3000", async () => {
      const res = await request(app.getHttpServer())
        .get("/")
        .set("Origin", allowedOrigin);

      expect(res.status).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(allowedOrigin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });

    it("should block request carrying disallowed Origin", async () => {
      const res = await request(app.getHttpServer())
        .get("/")
        .set("Origin", disallowedOrigin);

      // Disallowed origin blocked with 403 Forbidden
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden");
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // [X2] SECRET LEAKAGE PREVENTION & LOG REDACTION
  // ==========================================================================
  describe("Secret Leakage Prevention [X2]", () => {
    it("deliberate 500 error returns no stack trace, no database password, and no token", async () => {
      const res = await request(app.getHttpServer()).get("/test-500");

      expect(res.status).toBe(500);
      expect(res.body.statusCode).toBe(500);
      expect(res.body.error).toBe("Internal Server Error");

      // Verify no sensitive tokens or DB passwords leaked in response
      const bodyStr = JSON.stringify(res.body);
      expect(bodyStr).not.toContain("SuperSecretDbPassword123");
      expect(bodyStr).not.toContain("Bearer_secret_token_123");
      expect(bodyStr).not.toContain("stack");
      expect(res.body).not.toHaveProperty("stack");

      // Verify exactly 5 consistent fields
      const keys = Object.keys(res.body).sort();
      expect(keys).toEqual(["error", "message", "path", "statusCode", "timestamp"]);
    });

    it("sanitizer utility redacts password, token, authorization, secret, and hash", () => {
      const rawPayload = {
        name: "Test",
        password: "MySecretPassword!",
        password_hash: "$argon2id$v=19$m=65536,t=3,p=1$xyz",
        token: "jwt.access.token",
        refreshToken: "refresh-raw-token",
        token_hash: "hash123",
        nested: {
          secret: "super-secret-key",
          authorization: "Bearer secret-jwt-token",
        },
      };

      const sanitized = sanitizeData(rawPayload);

      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.password_hash).toBe("[REDACTED]");
      expect(sanitized.token).toBe("[REDACTED]");
      expect(sanitized.refreshToken).toBe("[REDACTED]");
      expect(sanitized.token_hash).toBe("[REDACTED]");
      expect(sanitized.nested.secret).toBe("[REDACTED]");
      expect(sanitized.nested.authorization).toBe("Bearer [REDACTED]");
      expect(sanitized.name).toBe("Test"); // Safe field preserved
    });
  });

  // ==========================================================================
  // [X3] ENVIRONMENT-DEPENDENT FILTER BEHAVIOR
  // ==========================================================================
  describe("Environment-Dependent Filter Behavior [X3]", () => {
    it("returns generic message in production environment", async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";

        const res = await request(app.getHttpServer()).get("/test-500");

        expect(res.status).toBe(500);
        expect(res.body.message).toBe("Internal server error");
        expect(res.body.error).toBe("Internal Server Error");
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("returns sanitized descriptive message in development/test environment", async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "development";

        const res = await request(app.getHttpServer()).get("/test-500");

        expect(res.status).toBe(500);
        expect(res.body.error).toBe("Internal Server Error");
        // Descriptive but sanitized
        expect(res.body.message).toContain("Fatal database connection failure");
        expect(res.body.message).not.toContain("SuperSecretDbPassword123");
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
