import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Comment } from "../entities/comment.entity.js";
import { Task } from "../entities/task.entity.js";
import { ProjectMember } from "../entities/project-member.entity.js";
import { CommentsService } from "./comments.service.js";
import { CommentsController } from "./comments.controller.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { RolesGuard } from "../common/guards/roles.guard.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([Comment, Task, ProjectMember]),
    ProjectsModule,
  ],
  controllers: [CommentsController],
  providers: [CommentsService, RolesGuard],
  exports: [CommentsService, TypeOrmModule],
})
export class CommentsModule {}
