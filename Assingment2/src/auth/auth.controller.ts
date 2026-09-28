import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service.js";
import { RegisterDto } from "./dto/register.dto.js";
import { LoginDto } from "./dto/login.dto.js";
import { RefreshTokenDto } from "./dto/refresh.dto.js";
import { LogoutDto } from "./dto/logout.dto.js";
import { JwtAuthGuard } from "./guards/jwt-auth.guard.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";

// ============================================================================
// Deliverable: The Five /auth routes
// [W1] WARM-UP REQUIREMENT: Rate-limit the auth routes (register, login, refresh)
//      with tightened limits (5 requests per 60 seconds)
// [X2] CHALLENGE REQUIREMENT: Mark public routes with @Public() decorator
// 1. POST /auth/register (@Public, @Throttle)
// 2. POST /auth/login    (@Public, @Throttle)
// 3. POST /auth/refresh  (@Public, @Throttle)
// 4. POST /auth/logout   (@Public - caller identifies via presented refresh token)
// 5. GET /auth/me        (Protected by JwtAuthGuard)
// ============================================================================
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // [W2] POST /auth/register: Hash password with argon2, return response without password/hash
  // [W1] Tightened rate-limit: 5 requests per minute
  // [X2] Public route
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // [C1] & [C2] POST /auth/login: Verify password (401 on failure), issue short-lived JWT & refresh token
  // [W1] Tightened rate-limit: 5 requests per minute
  // [X2] Public route
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  // [C3], [X1], [X2] POST /auth/refresh: Validate refresh token, mark old one revoked, rotate token pair
  // [W1] Tightened rate-limit: 5 requests per minute
  // [X2] Public route
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  // [C4] POST /auth/logout: Revoke caller's presented refresh token
  // [X2] Public route
  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.OK)
  async logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refreshToken);
  }

  // [5th /auth route] GET /auth/me: Returns current authenticated user
  // Protected route (requires valid Bearer token)
  @Get("me")
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser("id") userId: number) {
    return this.authService.getProfile(userId);
  }
}
