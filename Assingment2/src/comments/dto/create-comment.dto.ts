import { IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";

export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  body!: string;

  // [W2] Client may claim authorId or userId, but backend strictly sets authorId from @CurrentUser()
  @IsOptional()
  authorId?: number;

  @IsOptional()
  userId?: number;
}
