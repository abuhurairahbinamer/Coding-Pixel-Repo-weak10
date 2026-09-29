// ============================================================================
// [W1] WARM-UP REQUIREMENT: Add password_hash to users table
// Holds an argon2 hash — never a plaintext password, and never a fast hash (SHA-256)
// ============================================================================
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from "typeorm";
import { Project } from "./project.entity.js";
import { ProjectMember } from "./project-member.entity.js";
import { Task } from "./task.entity.js";
import { Comment } from "./comment.entity.js";
import { RefreshToken } from "./refresh-token.entity.js";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 255, unique: true })
  email!: string;

  // [W1] users.password_hash column added via migration
  @Column({ name: "password_hash", type: "varchar", length: 255, nullable: true })
  passwordHash!: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @OneToMany(() => Project, (project) => project.owner)
  projects!: Relation<Project[]>;

  @OneToMany(() => ProjectMember, (projectMember) => projectMember.user)
  projectMembers!: Relation<ProjectMember[]>;

  @OneToMany(() => Task, (task) => task.assignee)
  assignedTasks!: Relation<Task[]>;

  @OneToMany(() => Comment, (comment) => comment.author)
  comments!: Relation<Comment[]>;

  // [W1] Relation to refresh_tokens table
  @OneToMany(() => RefreshToken, (refreshToken) => refreshToken.user)
  refreshTokens!: Relation<RefreshToken[]>;
}
