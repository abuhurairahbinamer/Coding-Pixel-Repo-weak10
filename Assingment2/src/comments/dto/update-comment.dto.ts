import { IsNotEmpty, IsString, MinLength } from "class-validator";

export class UpdateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  body!: string;
}
