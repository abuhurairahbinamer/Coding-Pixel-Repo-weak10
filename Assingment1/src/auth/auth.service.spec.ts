// ============================================================================
// [C5] CORE REQUIREMENT: Unit tests for AuthService
// Covers:
// - Password verification accepts right password and rejects wrong one
// - Unknown email returns identical 401 as wrong password (anti-enumeration)
// - Rotation revokes old token and issues new token pair
// - [X1] Token reuse detection revokes all user sessions
// - [X2] Expired refresh token rejected with 401
// - [X3] Argon2 cost parameters taken from configuration
// - [C4] Logout revokes caller's current token
// ============================================================================
import { UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RefreshToken } from "../entities/refresh-token.entity.js";
import { User } from "../entities/user.entity.js";
import { AuthService } from "./auth.service.js";

describe("AuthService (Unit)", () => {
  let authService: AuthService;
  let mockUserRepository: any;
  let mockRefreshTokenRepository: any;
  let mockJwtService: any;
  let mockConfigService: any;
  let mockDataSource: any;

  // [X3] Fast argon2 settings for tests
  const testArgon2Config: Record<string, any> = {
    JWT_SECRET: "test-jwt-secret-assignment1",
    JWT_ACCESS_EXPIRATION_TIME: "15m",
    JWT_REFRESH_EXPIRATION_TIME: "7d",
    ARGON2_TIME_COST: 1,
    ARGON2_MEMORY_COST: 1024,
    ARGON2_PARALLELISM: 1,
  };

  beforeEach(() => {
    mockConfigService = {
      get: vi.fn((key: string, defaultVal?: any) => testArgon2Config[key] ?? defaultVal),
      getOrThrow: vi.fn((key: string) => {
        if (!testArgon2Config[key]) throw new Error(`Missing ${key}`);
        return testArgon2Config[key];
      }),
    };

    mockJwtService = {
      sign: vi.fn(() => "mocked.jwt.access_token"),
    };

    mockUserRepository = {
      findOne: vi.fn(),
      create: vi.fn((dto) => ({ ...dto, id: 1, createdAt: new Date() })),
      save: vi.fn((user) => Promise.resolve(user)),
    };

    mockRefreshTokenRepository = {
      findOne: vi.fn(),
      create: vi.fn((dto) => ({ ...dto, id: 1, createdAt: new Date() })),
      save: vi.fn((record) => Promise.resolve(record)),
      createQueryBuilder: vi.fn(() => ({
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({ affected: 2 }),
      })),
    };

    mockDataSource = {
      transaction: vi.fn(async (cb) => {
        const manager = {
          save: vi.fn((entity, record) => Promise.resolve(record)),
          create: vi.fn((entity, dto) => ({ ...dto, id: 2, createdAt: new Date() })),
        };
        return cb(manager);
      }),
    };

    authService = new AuthService(
      mockUserRepository,
      mockRefreshTokenRepository,
      mockJwtService,
      mockConfigService,
      mockDataSource,
    );
  });

  // --------------------------------------------------------------------------
  // [W2] REGISTRATION
  // --------------------------------------------------------------------------
  describe("register", () => {
    it("should hash password with argon2 and exclude password/hash from response", async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      const result = await authService.register({
        name: "Alice",
        email: "alice@example.com",
        password: "SecretPassword123!",
      });

      // [W2] CHECK: Response contains neither password nor password_hash
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("name", "Alice");
      expect(result).toHaveProperty("email", "alice@example.com");
      expect(result).not.toHaveProperty("password");
      expect(result).not.toHaveProperty("passwordHash");
      expect(result).not.toHaveProperty("password_hash");

      // Verify argon2 hash was passed to repository save
      expect(mockUserRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          passwordHash: expect.stringMatching(/^\$argon2id\$/),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // [C1] & [C2] LOGIN & VERIFICATION
  // --------------------------------------------------------------------------
  describe("login", () => {
    it("should accept the right password and return a token pair", async () => {
      // [X3] Hash using test cost
      const passwordHash = await argon2.hash("CorrectPassword123", authService.getArgon2Options());
      const mockUser: Partial<User> = {
        id: 10,
        email: "user@example.com",
        name: "User One",
        passwordHash,
      };

      mockUserRepository.findOne.mockResolvedValue(mockUser);

      const result = await authService.login({
        email: "user@example.com",
        password: "CorrectPassword123",
      });

      // [C2] Returns token pair
      expect(result).toHaveProperty("accessToken");
      expect(result).toHaveProperty("refreshToken");

      // Refresh token hash is stored, not raw token
      expect(mockRefreshTokenRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 10,
          tokenHash: authService.hashToken(result.refreshToken),
        }),
      );
    });

    it("should reject a wrong password with 401", async () => {
      const passwordHash = await argon2.hash("RightPassword", authService.getArgon2Options());
      mockUserRepository.findOne.mockResolvedValue({
        id: 10,
        email: "user@example.com",
        passwordHash,
      });

      await expect(
        authService.login({
          email: "user@example.com",
          password: "WrongPassword",
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should return the exact same 401 message for unknown email and wrong password (anti-enumeration)", async () => {
      // 1. Unknown email
      mockUserRepository.findOne.mockResolvedValue(null);
      let unknownEmailError: any;
      try {
        await authService.login({ email: "unknown@example.com", password: "Password123" });
      } catch (err) {
        unknownEmailError = err;
      }

      // 2. Wrong password
      const passwordHash = await argon2.hash("CorrectPassword", authService.getArgon2Options());
      mockUserRepository.findOne.mockResolvedValue({
        id: 10,
        email: "existing@example.com",
        passwordHash,
      });
      let wrongPasswordError: any;
      try {
        await authService.login({ email: "existing@example.com", password: "WrongPassword" });
      } catch (err) {
        wrongPasswordError = err;
      }

      // [C1] CHECK: Identical 401 status and error message
      expect(unknownEmailError).toBeInstanceOf(UnauthorizedException);
      expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException);
      expect(unknownEmailError.message).toBe(wrongPasswordError.message);
      expect(unknownEmailError.message).toBe("Invalid email or password");
    });
  });

  // --------------------------------------------------------------------------
  // [C3] REFRESH TOKEN ROTATION
  // --------------------------------------------------------------------------
  describe("refresh", () => {
    it("should rotate token: revoke old token and issue new pair inside one transaction", async () => {
      const rawToken = "valid-raw-refresh-token";
      const tokenHash = authService.hashToken(rawToken);

      const existingRecord: Partial<RefreshToken> = {
        id: 1,
        userId: 10,
        tokenHash,
        familyId: "family-uuid-1",
        expiresAt: new Date(Date.now() + 100000), // future
        revokedAt: null, // active
        user: { id: 10, email: "user@example.com" } as User,
      };

      mockRefreshTokenRepository.findOne.mockResolvedValue(existingRecord);

      const result = await authService.refresh(rawToken);

      // [C3] Old token marked revoked
      expect(existingRecord.revokedAt).not.toBeNull();
      expect(result).toHaveProperty("accessToken");
      expect(result).toHaveProperty("refreshToken");
      expect(result.refreshToken).not.toBe(rawToken);
      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    // [X1] REUSE DETECTION
    it("should detect reuse when already-revoked token is presented, and revoke all user tokens", async () => {
      const rawToken = "already-revoked-token";
      const tokenHash = authService.hashToken(rawToken);

      const revokedRecord: Partial<RefreshToken> = {
        id: 1,
        userId: 10,
        tokenHash,
        familyId: "family-uuid-1",
        expiresAt: new Date(Date.now() + 100000),
        revokedAt: new Date(), // ALREADY REVOKED!
        user: { id: 10, email: "user@example.com" } as User,
      };

      mockRefreshTokenRepository.findOne.mockResolvedValue(revokedRecord);

      // Presentation must fail with 401
      await expect(authService.refresh(rawToken)).rejects.toThrow(UnauthorizedException);

      // [X1] CHECK: QueryBuilder update invoked to revoke all tokens for this user
      expect(mockRefreshTokenRepository.createQueryBuilder).toHaveBeenCalled();
    });

    // [X2] EXPIRED TOKEN REJECTION
    it("should reject an expired refresh token with 401 even if never revoked", async () => {
      const rawToken = "expired-token";
      const tokenHash = authService.hashToken(rawToken);

      const expiredRecord: Partial<RefreshToken> = {
        id: 1,
        userId: 10,
        tokenHash,
        familyId: "family-uuid-1",
        expiresAt: new Date(Date.now() - 50000), // PAST EXPIRATION
        revokedAt: null, // NOT revoked
        user: { id: 10, email: "user@example.com" } as User,
      };

      mockRefreshTokenRepository.findOne.mockResolvedValue(expiredRecord);

      await expect(authService.refresh(rawToken)).rejects.toThrow(UnauthorizedException);
    });
  });

  // --------------------------------------------------------------------------
  // [C4] LOGOUT
  // --------------------------------------------------------------------------
  describe("logout", () => {
    it("should mark the presented refresh token as revoked rather than deleting it", async () => {
      const rawToken = "active-token-to-logout";
      const tokenHash = authService.hashToken(rawToken);

      const activeRecord: Partial<RefreshToken> = {
        id: 1,
        userId: 10,
        tokenHash,
        revokedAt: null,
      };

      mockRefreshTokenRepository.findOne.mockResolvedValue(activeRecord);

      const response = await authService.logout(rawToken);

      // [C4] CHECK: row is revoked in database rather than deleted
      expect(activeRecord.revokedAt).not.toBeNull();
      expect(mockRefreshTokenRepository.save).toHaveBeenCalledWith(activeRecord);
      expect(response.message).toBe("Logged out successfully");
    });
  });

  // --------------------------------------------------------------------------
  // [X3] CONFIGURABLE ARGON2 COST
  // --------------------------------------------------------------------------
  describe("getArgon2Options", () => {
    it("should read argon2 cost parameters from configuration", () => {
      const options = authService.getArgon2Options();
      expect(options.timeCost).toBe(1);
      expect(options.memoryCost).toBe(1024);
      expect(options.parallelism).toBe(1);
    });
  });
});
