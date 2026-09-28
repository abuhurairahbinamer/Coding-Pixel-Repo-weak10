import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, type Relation } from "typeorm";
import { User } from "./user.entity.js";
import { Project } from "./project.entity.js";
import { ProjectRole } from "../common/enums/project-role.enum.js";

@Entity("project_members")
export class ProjectMember {
  @PrimaryColumn({ type: "int", name: "user_id" })
  userId!: number;

  @PrimaryColumn({ type: "int", name: "project_id" })
  projectId!: number;

  @Column({
    type: "enum",
    enum: ProjectRole,
  })
  role!: ProjectRole;

  @ManyToOne(() => User, (user) => user.projectMembers, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<User>;

  @ManyToOne(() => Project, (project) => project.members, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "project_id" })
  project!: Relation<Project>;
}
