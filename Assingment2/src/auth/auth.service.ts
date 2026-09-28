import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import * as crypto from "crypto";
import { DataSource, Repository } from "typeorm";
import { RefreshToken } from "../entities/refresh-token.entity.js";
import { User } from "../entities/user.entity.js";
import { LoginDto } from "./dto/login.dto.js";
import { RegisterDto } from "./dto/register.dto.js";

// [C1] Identical message for unknown email and wrong password to prevent user enumeration
const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";

export interface UserResponse {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,

    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  // ==========================================================================
  // [X3] CHALLENGE REQUIREMENT: Configurable Argon2 Cost Parameters
  // Strong default cost in production (OWASP recommendation: 64MB memory, 3 iterations)
  // Lower cost in test environment (1MB memory, 1 iteration) for fast test execution
  // ==========================================================================
  public getArgon2Options() {
    const timeCost = Number(
      this.configService.get<number>("ARGON2_TIME_COST", 3),
    );
    const memoryCost = Number(
      this.configService.get<number>("ARGON2_MEMORY_COST", 65536),
    );
    const parallelism = Number(
      this.configService.get<number>("ARGON2_PARALLELISM", 1),
    );

    return {
      type: argon2.argon2id as 0 | 1 | 2,
      timeCost,
      memoryCost,
      parallelism,
    };
  }

  // ==========================================================================
  // [W2] WARM-UP REQUIREMENT: POST /auth/register
  // Hashes password with argon2 before saving.
  // Explicitly constructs response object containing neither password nor password_hash.
  // ==========================================================================
  async register(dto: RegisterDto): Promise<UserResponse> {
    const existingUser = await this.userRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException("Email is already registered");
    }

    // [W2] & [X3] Hash password using argon2 with configurable cost parameters
    const hashedPassword: string = await argon2.hash(
      dto.password,
      this.getArgon2Options(),
    );

    const newUser = this.userRepository.create({
      name: dto.name,
      email: dto.email.toLowerCase(),
      passwordHash: hashedPassword,
    });

    const savedUser = await this.userRepository.save(newUser);

    // [W2] HINT: Build the response from an explicit list of fields rather than returning the entity
    return {
      id: savedUser.id,
      name: savedUser.name,
      email: savedUser.email,
      createdAt: savedUser.createdAt,
    };
  }

  // ==========================================================================
  // [C1] & [C2] CORE REQUIREMENTS: POST /auth/login
  // [C1] Verifies password. Returns identical 401 for wrong password and unknown email.
  // [C2] Issues short-lived access JWT (payload: sub, email) & stores refresh token hash.
  // ==========================================================================
  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.userRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    // [C1] User not found -> return 401 with generic message
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // [C1] Verify password using argon2
    const isPasswordValid = await argon2.verify(
      user.passwordHash,
      dto.password,
    );

    // [C1] Wrong password -> return identical 401 with the exact same message
    if (!isPasswordValid) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    // [C2] Issue access JWT and refresh token
    return this.generateTokenPair(user);
  }

  // ==========================================================================
  // [C3], [X1], [X2] REQUIREMENTS: POST /auth/refresh
  // [C3] Atomic token rotation inside a single database transaction.
  // [X1] Token reuse detection: presenting already-revoked token revokes all user sessions.
  // [X2] Reject expired refresh tokens with 401 even if never revoked.
  // ==========================================================================
  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    // [W1] & [C3] Compute deterministic SHA-256 hash of presented raw refresh token
    const tokenHash = this.hashToken(rawRefreshToken);

    // Look up token by its hash
    const tokenRecord = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
      relations: { user: true },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    // [X1] CHALLENGE REQUIREMENT: Reuse Detection
    // If the token was already revoked, someone is reusing an invalidated token.
    // Revoke every refresh token of that user to terminate both victim and attacker sessions.
    if (tokenRecord.revokedAt !== null) {
      await this.refreshTokenRepository
        .createQueryBuilder()
        .update(RefreshToken)
        .set({ revokedAt: new Date() })
        .where("user_id = :userId AND revoked_at IS NULL", {
          userId: tokenRecord.userId,
        })
        .execute();

      throw new UnauthorizedException(
        "Revoked refresh token reuse detected; all sessions revoked",
      );
    }

    // [X2] CHALLENGE REQUIREMENT: Expiry Check
    // Database expires_at is the source of truth; reject with 401 if in the past.
    if (new Date() >= new Date(tokenRecord.expiresAt)) {
      throw new UnauthorizedException("Refresh token has expired");
    }

    // [C3] HINT: Revoke old token and insert new token inside ONE database transaction
    return await this.dataSource.transaction(async (manager) => {
      // 1. Mark old token as revoked
      tokenRecord.revokedAt = new Date();
      await manager.save(RefreshToken, tokenRecord);

      // 2. Generate new refresh token carrying forward the existing family_id
      const newRawRefreshToken = this.generateSecureRandomToken();
      const newRefreshTokenHash = this.hashToken(newRawRefreshToken);
      const refreshExpiryMs = this.getRefreshExpirationMs();
      const newExpiresAt = new Date(Date.now() + refreshExpiryMs);

      const newRefreshTokenRecord = manager.create(RefreshToken, {
        userId: tokenRecord.userId,
        tokenHash: newRefreshTokenHash,
        familyId: tokenRecord.familyId,
        expiresAt: newExpiresAt,
        revokedAt: null,
      });

      await manager.save(RefreshToken, newRefreshTokenRecord);

      // 3. Issue new short-lived access JWT
      const accessToken = this.issueAccessToken(
        tokenRecord.user.id,
        tokenRecord.user.email,
      );

      return {
        accessToken,
        refreshToken: newRawRefreshToken,
      };
    });
  }

  // ==========================================================================
  // [C4] CORE REQUIREMENT: POST /auth/logout
  // Revoke caller's current refresh token by marking revoked_at in database.
  // The row is kept (not deleted) for audit history.
  // ==========================================================================
  async logout(rawRefreshToken: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(rawRefreshToken);

    const tokenRecord = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
    });

    if (tokenRecord && tokenRecord.revokedAt === null) {
      tokenRecord.revokedAt = new Date();
      await this.refreshTokenRepository.save(tokenRecord);
    }

    return { message: "Logged out successfully" };
  }

  // ==========================================================================
  // [5th /auth route] GET /auth/me
  // Returns currently authenticated user profile
  // ==========================================================================
  async getProfile(userId: number): Promise<UserResponse> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    };
  }

  // ==========================================================================
  // HELPER METHODS (Token generation, hashing, and configuration parsing)
  // ==========================================================================

  // [C2] Generate access token and initial refresh token for user
  private async generateTokenPair(user: User): Promise<AuthTokens> {
    const accessToken = this.issueAccessToken(user.id, user.email);

    const rawRefreshToken = this.generateSecureRandomToken();
    const tokenHash = this.hashToken(rawRefreshToken);
    // [X1] Assign a new family_id for this login session
    const familyId = crypto.randomUUID();
    const refreshExpiryMs = this.getRefreshExpirationMs();
    const expiresAt = new Date(Date.now() + refreshExpiryMs);

    // [C2] Save hash and expiry in refresh_tokens table
    const refreshTokenRecord = this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash,
      familyId,
      expiresAt,
      revokedAt: null,
    });

    await this.refreshTokenRepository.save(refreshTokenRecord);

    return {
      accessToken,
      refreshToken: rawRefreshToken,
    };
  }

  // [C2] Issue access JWT: Payload strictly limited to sub and email, expiry from .env
  private issueAccessToken(userId: number, email: string): string {
    const accessExpiration = this.configService.get<string>(
      "JWT_ACCESS_EXPIRATION_TIME",
      "15m",
    );
    const jwtSecret = this.configService.getOrThrow<string>("JWT_SECRET");

    return this.jwtService.sign(
      { sub: userId, email },
      {
        secret: jwtSecret,
        expiresIn: accessExpiration as any,
      },
    );
  }

  // [W1] Hash refresh token using SHA-256 (deterministic, safe for high-entropy random secrets)
  public hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  // Generate cryptographically random token string
  private generateSecureRandomToken(): string {
    return crypto.randomBytes(40).toString("hex");
  }

  // Parse refresh expiration time string (e.g. '7d', '24h', '60m') to milliseconds
  private getRefreshExpirationMs(): number {
    const expiryStr = this.configService.get<string>(
      "JWT_REFRESH_EXPIRATION_TIME",
      "7d",
    );

    const match = expiryStr.match(/^(\d+)([smhd])$/);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      switch (unit) {
        case "s":
          return value * 1000;
        case "m":
          return value * 60 * 1000;
        case "h":
          return value * 60 * 60 * 1000;
        case "d":
          return value * 24 * 60 * 60 * 1000;
      }
    }

    const parsedNum = Number(expiryStr);
    return isNaN(parsedNum) ? 7 * 24 * 60 * 60 * 1000 : parsedNum;
  }
}
