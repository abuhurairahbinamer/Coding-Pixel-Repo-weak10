import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Task } from "../entities/task.entity.js";
import { Tag } from "../entities/tag.entity.js";
import { Project } from "../entities/project.entity.js";
import { User } from "../entities/user.entity.js";
import { Comment } from "../entities/comment.entity.js";
import { ProjectMember } from "../entities/project-member.entity.js";
import { TasksService } from "./tasks.service.js";
import { TasksController } from "./tasks.controller.js";
import { ProjectsModule } from "../projects/projects.module.js";
import { RolesGuard } from "../common/guards/roles.guard.js";
import { TaskOwnershipGuard } from "../common/guards/task-ownership.guard.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, Tag, Project, User, Comment, ProjectMember]),
    ProjectsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, RolesGuard, TaskOwnershipGuard],
  exports: [TasksService, TypeOrmModule],
})
export class TasksModule {}
