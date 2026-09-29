// ============================================================================
// [C3] CORE REQUIREMENT: POST /auth/refresh DTO
// Validates refresh token payload
// ============================================================================
import { IsNotEmpty, IsString } from "class-validator";

export class RefreshTokenDto {
  @IsNotEmpty({ message: "Refresh token is required" })
  @IsString({ message: "Refresh token must be a string" })
  refreshToken!: string;
}
