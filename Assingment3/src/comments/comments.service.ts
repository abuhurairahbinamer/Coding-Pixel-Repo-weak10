import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Comment } from "../entities/comment.entity.js";
import { Task } from "../entities/task.entity.js";
import { CreateCommentDto } from "./dto/create-comment.dto.js";
import { UpdateCommentDto } from "./dto/update-comment.dto.js";

@Injectable()
export class CommentsService {
  constructor(
    @InjectRepository(Comment)
    private readonly commentRepository: Repository<Comment>,
    @InjectRepository(Task)
    private readonly taskRepository: Repository<Task>,
  ) {}

  // ============================================================================
  // [W2] CurrentUser binds the comment author to the authenticated caller
  // ============================================================================
  async create(
    taskId: number,
    createCommentDto: CreateCommentDto,
    currentUser: { id: number; email: string },
  ): Promise<Comment> {
    const task = await this.taskRepository.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const comment = this.commentRepository.create({
      taskId,
      body: createCommentDto.body,
      // [W2] Identity comes exclusively from the authenticated user token
      authorId: currentUser.id,
    });

    return this.commentRepository.save(comment);
  }

  async findByTaskId(taskId: number): Promise<Comment[]> {
    return this.commentRepository.find({
      where: { taskId },
      relations: { author: true },
      order: { createdAt: "ASC" },
    });
  }

  async findOne(id: number): Promise<Comment> {
    const comment = await this.commentRepository.findOne({
      where: { id },
      relations: { author: true, task: true },
    });
    if (!comment) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }
    return comment;
  }

  async update(id: number, updateCommentDto: UpdateCommentDto): Promise<Comment> {
    const comment = await this.findOne(id);
    comment.body = updateCommentDto.body;
    return this.commentRepository.save(comment);
  }

  async remove(id: number): Promise<void> {
    const comment = await this.findOne(id);
    await this.commentRepository.remove(comment);
  }
}
