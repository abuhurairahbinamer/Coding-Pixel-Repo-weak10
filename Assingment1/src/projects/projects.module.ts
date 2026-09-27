import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Project } from "../entities/project.entity.js";
import { ProjectMember } from "../entities/project-member.entity.js";
import { ProjectsService } from "./projects.service.js";
import { ProjectsController } from "./projects.controller.js";
import { RoleCacheService } from "./role-cache.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([Project, ProjectMember])],
  controllers: [ProjectsController],
  providers: [ProjectsService, RoleCacheService],
  exports: [ProjectsService, RoleCacheService, TypeOrmModule],
})
export class ProjectsModule {}
