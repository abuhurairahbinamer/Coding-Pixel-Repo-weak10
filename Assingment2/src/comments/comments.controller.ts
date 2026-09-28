import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ParsePositiveIntPipe } from "../common/pipes/parse-positive-int.pipe.js";
import { CommentsService } from "./comments.service.js";
import { CreateCommentDto } from "./dto/create-comment.dto.js";
import { UpdateCommentDto } from "./dto/update-comment.dto.js";
import { Comment } from "../entities/comment.entity.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { Roles } from "../common/decorators/roles.decorator.js";
import { Public } from "../common/decorators/public.decorator.js";
import { ProjectRole } from "../common/enums/project-role.enum.js";

// ============================================================================
// [W1] WARM-UP REQUIREMENT: Protect all write routes on comments with JwtAuthGuard
// [W2] WARM-UP REQUIREMENT: Bind comment author using @CurrentUser()
// [C1] CORE REQUIREMENT: RolesGuard reads caller's role on the relevant project
// [C3] CORE REQUIREMENT: Cross-project isolation: user cannot comment outside their project
// [C4] CORE REQUIREMENT: Order guards so JwtAuthGuard runs before RolesGuard
// [X2] CHALLENGE REQUIREMENT: Read routes marked @Public()
// ============================================================================
@Controller()
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  // [W1] Protected write route
  // [C1] & [C3] RolesGuard checks role on the project that owns the task
  // [C4] Guard ordering: JwtAuthGuard (401) -> RolesGuard (403)
  // [W2] CurrentUser binds caller to comment
  // [C3] Route parameter validated to ensure positive integer before DB lookup
  @Post("tasks/:taskId/comments")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER)
  async create(
    @Param("taskId", ParsePositiveIntPipe) taskId: number,
    @Body() createCommentDto: CreateCommentDto,
    @CurrentUser() currentUser: { id: number; email: string },
  ): Promise<Comment> {
    return this.commentsService.create(taskId, createCommentDto, currentUser);
  }

  // [X2] Public GET route
  // [C3] Route parameter validated to ensure positive integer before DB lookup
  @Get("tasks/:taskId/comments")
  @Public()
  async findByTaskId(
    @Param("taskId", ParsePositiveIntPipe) taskId: number,
  ): Promise<Comment[]> {
    return this.commentsService.findByTaskId(taskId);
  }

  // [X2] Public GET route
  // [C3] Route parameter validated to ensure positive integer before DB lookup
  @Get("comments/:id")
  @Public()
  async findOne(@Param("id", ParsePositiveIntPipe) id: number): Promise<Comment> {
    return this.commentsService.findOne(id);
  }

  // [W1] Protected write route
  // [C1] & [C3] Guard checks role on project
  // [C3] Route parameter validated to ensure positive integer before DB lookup
  @Patch("comments/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER)
  async update(
    @Param("id", ParsePositiveIntPipe) id: number,
    @Body() updateCommentDto: UpdateCommentDto,
  ): Promise<Comment> {
    return this.commentsService.update(id, updateCommentDto);
  }

  // [W1] Protected write route
  // [C1] & [C3] Guard checks role on project
  // [C3] Route parameter validated to ensure positive integer before DB lookup
  @Delete("comments/:id")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ProjectRole.OWNER, ProjectRole.ADMIN, ProjectRole.MEMBER)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id", ParsePositiveIntPipe) id: number): Promise<void> {
    await this.commentsService.remove(id);
  }
}
