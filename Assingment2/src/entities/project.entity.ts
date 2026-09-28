import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from "typeorm";
import { User } from "./user.entity.js";
import { ProjectMember } from "./project-member.entity.js";
import { Task } from "./task.entity.js";

@Entity("projects")
export class Project {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "int", name: "owner_id" })
  ownerId!: number;

  @ManyToOne(() => User, (user) => user.projects, { onDelete: "CASCADE" })
  @JoinColumn({ name: "owner_id" })
  owner!: Relation<User>;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @OneToMany(() => ProjectMember, (projectMember) => projectMember.project)
  members!: Relation<ProjectMember[]>;

  @OneToMany(() => Task, (task) => task.project)
  tasks!: Relation<Task[]>;
}
