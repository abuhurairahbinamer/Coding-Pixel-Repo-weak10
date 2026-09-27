import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from "class-validator";
import { TaskStatus } from "../../common/enums/task-status.enum.js";

export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  priority?: number;

  @IsInt()
  @IsNotEmpty()
  projectId!: number;

  @IsOptional()
  @IsInt()
  assigneeId?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tagIds?: number[];

  @IsOptional()
  @IsString()
  dueDate?: string;

  // [W2] Client may pass a claimed userId or creatorId in the body, but backend ignores it in favor of @CurrentUser()
  @IsOptional()
  userId?: number;

  @IsOptional()
  creatorId?: number;
}
