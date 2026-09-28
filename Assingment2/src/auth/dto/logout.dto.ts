// ============================================================================
// [C4] CORE REQUIREMENT: POST /auth/logout DTO
// Validates logout payload presenting the refresh token to revoke
// ============================================================================
import { IsNotEmpty, IsString } from "class-validator";

export class LogoutDto {
  @IsNotEmpty({ message: "Refresh token is required" })
  @IsString({ message: "Refresh token must be a string" })
  refreshToken!: string;
}
