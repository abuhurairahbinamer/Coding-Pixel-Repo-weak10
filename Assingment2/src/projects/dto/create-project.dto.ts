import { IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  name!: string;

  // [W2] Client may attempt to send ownerId or userId, but backend strictly overrides with @CurrentUser()
  @IsOptional()
  ownerId?: number;

  @IsOptional()
  userId?: number;
}
