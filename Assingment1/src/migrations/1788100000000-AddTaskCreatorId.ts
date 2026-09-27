import { MigrationInterface, QueryRunner } from "typeorm";

// ============================================================================
// [W2] & [X1] Add creator_id column to tasks table to support:
// - [W2] Binding resource creation to @CurrentUser()
// - [X1] Resource-ownership authorization checks (only creator or assignee may edit)
// ============================================================================
export class AddTaskCreatorId1788100000000 implements MigrationInterface {
  name = "AddTaskCreatorId1788100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // [W2] & [X1] Add creator_id column to tasks table referencing users(id)
    await queryRunner.query(
      `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "creator_id" integer`,
    );

    await queryRunner.query(
      `ALTER TABLE "tasks" ADD CONSTRAINT "FK_tasks_creator_id" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_creator_id" ON "tasks" ("creator_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_tasks_creator_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "FK_tasks_creator_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tasks" DROP COLUMN IF EXISTS "creator_id"`,
    );
  }
}
