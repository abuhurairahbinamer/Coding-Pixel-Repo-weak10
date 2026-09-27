import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from "typeorm";
import { Task } from "./task.entity.js";
import { User } from "./user.entity.js";

@Entity("comments")
export class Comment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int", name: "task_id" })
  taskId!: number;

  @ManyToOne(() => Task, (task) => task.comments, { onDelete: "CASCADE" })
  @JoinColumn({ name: "task_id" })
  task!: Relation<Task>;

  @Column({ type: "int", name: "author_id" })
  authorId!: number;

  @ManyToOne(() => User, (user) => user.comments, { onDelete: "CASCADE" })
  @JoinColumn({ name: "author_id" })
  author!: Relation<User>;

  @Column({ type: "text" })
  body!: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
