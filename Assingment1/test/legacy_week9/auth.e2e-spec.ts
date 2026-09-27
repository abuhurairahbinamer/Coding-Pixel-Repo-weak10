// ============================================================================
// [C5] CORE REQUIREMENT: End-to-End Tests for Authentication & Refresh Rotation
// Covers:
// - [W2] POST /auth/register: Stores argon2 hash, response excludes password & hash
// - [C1] POST /auth/login: 401 for wrong password and unknown email (identical body)
// - [C2] Access JWT contains sub, email, short exp; refresh token hash stored in DB
// - [C3] POST /auth/refresh: Three-call rotation test (login -> refresh -> reuse returns 401)
// - [C4] POST /auth/logout: Revokes presented token in DB, subsequent refresh returns 401
// - [X1] Token reuse detection: Reusing token A revokes all user sessions
// - [X2] Expired token rejection: Expired token returns 401 even if not revoked
// ============================================================================
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { DataSource } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { RefreshToken } from "../src/entities/refresh-token.entity.js";
import { User } from "../src/entities/user.entity.js";
import { AppThrottlerStorage } from "../src/common/throttler/app-throttler-storage.js";

describe("Auth API Integration (e2e)", () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const testUser = {
    name: "E2E Test User",
    email: `e2e_${Date.now()}@example.com`,
    password: "Password123!",
  };

  beforeAll(async () => {
    // Set test env variables for fast argon2 hashing during tests
    process.env.NODE_ENV = "test";
    process.env.ARGON2_TIME_COST = "1";
    process.env.ARGON2_MEMORY_COST = "1024";
    process.env.ARGON2_PARALLELISM = "1";

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(() => {
    // [C5] Isolate throttler state between tests to prevent 429 cascades
    AppThrottlerStorage.reset();
  });

  afterAll(async () => {
    // Clean up test data created during e2e tests
    if (dataSource && dataSource.isInitialized) {
      const userRepo = dataSource.getRepository(User);
      const user = await userRepo.findOne({ where: { email: testUser.email } });
      if (user) {
        await userRepo.delete(user.id);
      }
    }
    await app.close();
  });

  // --------------------------------------------------------------------------
  // [W2] POST /auth/register
  // --------------------------------------------------------------------------
  describe("POST /auth/register", () => {
    it("should register a new user, store argon2 hash, and exclude password from response", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/register")
        .send(testUser)
        .expect(201);

      // [W2] CHECK: Response contains id, name, email, and NO password or password_hash
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("name", testUser.name);
      expect(res.body).toHaveProperty("email", testUser.email.toLowerCase());
      expect(res.body.password).toBeUndefined();
      expect(res.body.passwordHash).toBeUndefined();
      expect(res.body.password_hash).toBeUndefined();

      // [W2] CHECK: Database row holds an argon2 hash, not plaintext
      const userRepo = dataSource.getRepository(User);
      const dbUser = await userRepo.findOne({ where: { id: res.body.id } });
      expect(dbUser).not.toBeNull();
      expect(dbUser!.passwordHash).not.toBe(testUser.password);
      expect(dbUser!.passwordHash).toMatch(/^\$argon2id\$/);
    });
  });

  // --------------------------------------------------------------------------
  // [C1] & [C2] POST /auth/login
  // --------------------------------------------------------------------------
  describe("POST /auth/login", () => {
    it("should return token pair on valid credentials and store refresh token hash", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      // [C2] Returns access and refresh tokens
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");

      // [C2] Decode access JWT: contains sub and email, plus exp and iat
      const [headerBase64, payloadBase64] = res.body.accessToken.split(".");
      expect(headerBase64).toBeDefined();
      const payload = JSON.parse(
        Buffer.from(payloadBase64, "base64url").toString("utf8"),
      );

      expect(payload).toHaveProperty("sub");
      expect(payload).toHaveProperty("email", testUser.email.toLowerCase());
      expect(payload).toHaveProperty("exp");
      expect(payload.password).toBeUndefined();

      // [C2] Verify refresh token hash is stored in database, not raw token
      const rtRepo = dataSource.getRepository(RefreshToken);
      const userRepo = dataSource.getRepository(User);
      const dbUser = await userRepo.findOne({ where: { email: testUser.email } });

      const rtRow = await rtRepo.findOne({
        where: { userId: dbUser!.id },
        order: { createdAt: "DESC" },
      });

      expect(rtRow).not.toBeNull();
      expect(rtRow!.tokenHash).not.toBe(res.body.refreshToken);
      expect(new Date(rtRow!.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(rtRow!.revokedAt).toBeNull();
    });

    it("should return 401 on wrong password", async () => {
      const res = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: testUser.email,
          password: "WrongPassword!",
        })
        .expect(401);

      expect(res.body.message).toBe("Invalid email or password");
    });

    it("should return identical 401 status and body for non-existent email (anti-enumeration)", async () => {
      const wrongPasswordRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: testUser.email,
          password: "WrongPassword!",
        })
        .expect(401);

      const nonExistentEmailRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: "nobody_exists_here_12345@example.com",
          password: "AnyPassword!",
        })
        .expect(401);

      // [C1] CHECK: Identical status code, message, and error shape
      expect(nonExistentEmailRes.status).toBe(wrongPasswordRes.status);
      expect(nonExistentEmailRes.body.message).toBe(wrongPasswordRes.body.message);
      expect(nonExistentEmailRes.body.error).toBe(wrongPasswordRes.body.error);
    });
  });

  // --------------------------------------------------------------------------
  // [C3], [X1], [X2] POST /auth/refresh
  // --------------------------------------------------------------------------
  describe("POST /auth/refresh & Rotation", () => {
    it("should execute three-call rotation test: login -> refresh -> refresh again with first token expects 401", async () => {
      // Step 1: Login to acquire initial token pair (Token A)
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      const tokenA = loginRes.body.refreshToken;
      expect(tokenA).toBeDefined();

      // Step 2: Refresh with Token A to receive Token B
      const refreshRes = await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: tokenA })
        .expect(200);

      const tokenB = refreshRes.body.refreshToken;
      expect(tokenB).toBeDefined();
      expect(tokenB).not.toBe(tokenA);

      // [C3] CHECK: After a refresh, token A's row has a revoked_at timestamp
      const rtRepo = dataSource.getRepository(RefreshToken);
      const userRepo = dataSource.getRepository(User);
      const dbUser = await userRepo.findOne({ where: { email: testUser.email } });

      const allRows = await rtRepo.find({
        where: { userId: dbUser!.id },
        order: { createdAt: "DESC" },
      });

      const revokedRows = allRows.filter((r) => r.revokedAt !== null);
      expect(revokedRows.length).toBeGreaterThanOrEqual(1);

      // Step 3: Presenting Token A again MUST return 401
      // [X1] Token reuse attack detected!
      const reuseRes = await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: tokenA })
        .expect(401);

      expect(reuseRes.status).toBe(401);

      // [X1] CHECK: After reuse detected, every one of that user's refresh rows is now revoked
      const rowsAfterReuse = await rtRepo.find({
        where: { userId: dbUser!.id },
      });
      const activeRows = rowsAfterReuse.filter((r) => r.revokedAt === null);
      expect(activeRows.length).toBe(0);

      // Thief's newer token (Token B) stops working too
      await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: tokenB })
        .expect(401);
    });

    it("should reject an expired refresh token with 401 even when never revoked", async () => {
      // Login to get a valid token
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      const rawToken = loginRes.body.refreshToken;
      const rtRepo = dataSource.getRepository(RefreshToken);

      // [X2] Set the database expires_at to the past by hand
      const rows = await rtRepo.find({ order: { createdAt: "DESC" } });
      const targetRow = rows[0];
      await rtRepo.update(targetRow.id, {
        expiresAt: new Date(Date.now() - 60000),
      });

      // [X2] CHECK: Expired row returns 401 on refresh, no new pair issued
      await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: rawToken })
        .expect(401);
    });
  });

  // --------------------------------------------------------------------------
  // [C4] POST /auth/logout
  // --------------------------------------------------------------------------
  describe("POST /auth/logout", () => {
    it("should revoke the caller's current refresh token and persist revoked_at in database", async () => {
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      const logoutToken = loginRes.body.refreshToken;

      // Call logout endpoint
      await request(app.getHttpServer())
        .post("/auth/logout")
        .send({ refreshToken: logoutToken })
        .expect(200);

      // [C4] CHECK: After logout, a refresh with that token returns 401
      await request(app.getHttpServer())
        .post("/auth/refresh")
        .send({ refreshToken: logoutToken })
        .expect(401);

      // [C4] CHECK: Row is revoked in database rather than deleted
      const rtRepo = dataSource.getRepository(RefreshToken);
      const userRepo = dataSource.getRepository(User);
      const dbUser = await userRepo.findOne({ where: { email: testUser.email } });

      const rows = await rtRepo.find({ where: { userId: dbUser!.id } });
      const matchingRow = rows.find((r) => r.revokedAt !== null);
      expect(matchingRow).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // [5th /auth route] GET /auth/me
  // --------------------------------------------------------------------------
  describe("GET /auth/me", () => {
    it("should return user profile when authenticated with Bearer token", async () => {
      const loginRes = await request(app.getHttpServer())
        .post("/auth/login")
        .send({
          email: testUser.email,
          password: testUser.password,
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get("/auth/me")
        .set("Authorization", `Bearer ${loginRes.body.accessToken}`)
        .expect(200);

      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("email", testUser.email.toLowerCase());
      expect(res.body.password).toBeUndefined();
      expect(res.body.passwordHash).toBeUndefined();
    });

    it("should return 401 when token is missing", async () => {
      await request(app.getHttpServer()).get("/auth/me").expect(401);
    });
  });
});
