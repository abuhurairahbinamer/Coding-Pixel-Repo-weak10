// ============================================================================
// Week 10 Assignment 3: Production Hardening
// [C2] CORE REQUIREMENT: Read configuration through one typed module everywhere else
// ============================================================================
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EnvironmentVariables } from "./env.validation.js";

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<EnvironmentVariables, true>) {}

  get<T = unknown>(key: keyof EnvironmentVariables): T {
    return this.configService.get(key as any, { infer: true }) as T;
  }

  get nodeEnv(): "development" | "production" | "test" {
    return this.configService.get("NODE_ENV", { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  get isTest(): boolean {
    return this.nodeEnv === "test";
  }

  get port(): number {
    return Number(this.configService.get("PORT", { infer: true }));
  }

  get dbHost(): string {
    return this.configService.get("DB_HOST", { infer: true });
  }

  get dbPort(): number {
    return Number(this.configService.get("DB_PORT", { infer: true }));
  }

  get dbUsername(): string {
    return this.configService.get("DB_USERNAME", { infer: true });
  }

  get dbPassword(): string {
    return this.configService.get("DB_PASSWORD", { infer: true });
  }

  get dbName(): string {
    return this.configService.get("DB_NAME", { infer: true });
  }

  get frontendUrl(): string {
    return this.configService.get("FRONTEND_URL", { infer: true });
  }

  get jwtSecret(): string {
    return this.configService.get("JWT_SECRET", { infer: true });
  }

  get jwtAccessExpiration(): string {
    return this.configService.get("JWT_ACCESS_EXPIRATION_TIME", { infer: true });
  }

  get jwtRefreshExpiration(): string {
    return this.configService.get("JWT_REFRESH_EXPIRATION_TIME", { infer: true });
  }

  get argon2TimeCost(): number {
    return Number(this.configService.get("ARGON2_TIME_COST", { infer: true }));
  }

  get argon2MemoryCost(): number {
    return Number(this.configService.get("ARGON2_MEMORY_COST", { infer: true }));
  }

  get argon2Parallelism(): number {
    return Number(this.configService.get("ARGON2_PARALLELISM", { infer: true }));
  }

  get throttleTtl(): number {
    return Number(this.configService.get("THROTTLE_TTL", { infer: true }));
  }

  get throttleLimit(): number {
    return Number(this.configService.get("THROTTLE_LIMIT", { infer: true }));
  }

  get throttleAuthLimit(): number {
    return Number(this.configService.get("THROTTLE_AUTH_LIMIT", { infer: true }));
  }
}
