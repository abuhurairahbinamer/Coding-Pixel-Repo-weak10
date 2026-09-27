// ============================================================================
// [W1] WARM-UP REQUIREMENT: Data source configuration for TypeORM migrations
// - Separate database configured via environment variables
// - synchronize is strictly FALSE: schema changes only occur through migrations
// ============================================================================
import "reflect-metadata";
import { config } from "dotenv";
import { DataSource } from "typeorm";
import { User } from "./entities/user.entity.js";
import { RefreshToken } from "./entities/refresh-token.entity.js";
import { Project } from "./entities/project.entity.js";
import { ProjectMember } from "./entities/project-member.entity.js";
import { Task } from "./entities/task.entity.js";
import { Comment } from "./entities/comment.entity.js";
import { Tag } from "./entities/tag.entity.js";

// [W1] All migrations in execution order to build the full schema from scratch
import { InitialSchema1787656797093 } from "./migrations/1787656797093-InitialSchema.js";
import { AddTaskIndexes1787664050166 } from "./migrations/1787664050166-AddTaskIndexes.js";
import { AddPasswordHashAndRefreshTokens1788000000000 } from "./migrations/1788000000000-AddPasswordHashAndRefreshTokens.js";
import { AddTaskCreatorId1788100000000 } from "./migrations/1788100000000-AddTaskCreatorId.js";

// Load environment variables (supports .env or .env.test depending on NODE_ENV)
config({ path: process.env.NODE_ENV === "test" ? ".env.test" : ".env" });

const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME || "postgres",
  password: process.env.DB_PASSWORD || "12345",
  database: process.env.DB_NAME || "assignment1",
  // [W1] Check: synchronize must always be false across the entire application
  synchronize: false,
  logging: process.env.NODE_ENV !== "test" && process.env.TYPEORM_LOGGING === "true",
  entities: [
    User,
    RefreshToken,
    Project,
    ProjectMember,
    Task,
    Comment,
    Tag,
  ],
  migrations: [
    InitialSchema1787656797093,
    AddTaskIndexes1787664050166,
    AddPasswordHashAndRefreshTokens1788000000000,
    AddTaskCreatorId1788100000000,
  ],
});

export default AppDataSource;
