// ============================================================================
// [C2] CORE REQUIREMENT: Passport JWT Strategy reading token from Authorization header
// Secrets come exclusively from .env, payload is strictly limited to sub and email
// ============================================================================
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

export interface JwtPayload {
  sub: number;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    // [C2] HINT: JWT secret comes from .env, never hardcoded in source
    const jwtSecret = configService.getOrThrow<string>("JWT_SECRET");

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  // [C2] Payload contains only sub and email
  async validate(payload: JwtPayload) {
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException("Invalid token payload");
    }
    return { id: payload.sub, email: payload.email };
  }
}
