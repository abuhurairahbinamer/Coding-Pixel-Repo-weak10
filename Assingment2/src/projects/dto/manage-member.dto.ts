import { IsEnum, IsInt, IsNotEmpty } from "class-validator";
import { ProjectRole } from "../../common/enums/project-role.enum.js";

export class ManageMemberDto {
  @IsInt()
  @IsNotEmpty()
  userId!: number;

  @IsEnum(ProjectRole)
  @IsNotEmpty()
  role!: ProjectRole;
}
