// ============================================================================
// [W2] WARM-UP REQUIREMENT: Bound to authenticated user via @CurrentUser()
// [X1] CHALLENGE REQUIREMENT: Task creator_id used by TaskOwnershipGuard
// ============================================================================
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from "typeorm";
import { Project } from "./project.entity.js";
import { User } from "./user.entity.js";
import { Tag } from "./tag.entity.js";
import { Comment } from "./comment.entity.js";
import { TaskStatus } from "../common/enums/task-status.enum.js";

@Entity("tasks")
export class Task {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({
    type: "enum",
    enum: TaskStatus,
    default: TaskStatus.TODO,
  })
  status!: TaskStatus;

  @Column({ type: "int", default: 1 })
  priority!: number;

  @Column({ type: "int", name: "project_id" })
  projectId!: number;

  @ManyToOne(() => Project, (project) => project.tasks, { onDelete: "CASCADE" })
  @JoinColumn({ name: "project_id" })
  project!: Relation<Project>;

  // [W2] & [X1] Creator of the task, set from @CurrentUser() on creation
  @Column({ type: "int", name: "creator_id", nullable: true })
  creatorId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "creator_id" })
  creator!: Relation<User> | null;

  // [X1] Assignee of the task; allowed to edit the task under TaskOwnershipGuard
  @Column({ type: "int", name: "assignee_id", nullable: true })
  assigneeId!: number | null;

  @ManyToOne(() => User, (user) => user.assignedTasks, {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "assignee_id" })
  assignee!: Relation<User> | null;

  @Column({ type: "timestamp", nullable: true, name: "due_date" })
  dueDate!: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @ManyToMany(() => Tag, (tag) => tag.tasks, { cascade: true })
  @JoinTable({
    name: "task_tags",
    joinColumn: { name: "task_id", referencedColumnName: "id" },
    inverseJoinColumn: { name: "tag_id", referencedColumnName: "id" },
  })
  tags!: Relation<Tag[]>;

  @OneToMany(() => Comment, (comment) => comment.task)
  comments!: Relation<Comment[]>;
}
