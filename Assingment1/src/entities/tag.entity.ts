import {
  Column,
  Entity,
  ManyToMany,
  PrimaryGeneratedColumn,
  type Relation,
} from "typeorm";
import { Task } from "./task.entity.js";

@Entity("tags")
export class Tag {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 100, unique: true })
  name!: string;

  @ManyToMany(() => Task, (task) => task.tags)
  tasks!: Relation<Task[]>;
}
