import { MigrationInterface, QueryRunner } from "typeorm";

// ============================================================================
// [W1] WARM-UP REQUIREMENT: Add migration for users.password_hash and refresh_tokens
// [X1] CHALLENGE REQUIREMENT: Include family_id to track rotation families and detect reuse
// ============================================================================
export class AddPasswordHashAndRefreshTokens1788000000000 implements MigrationInterface {
  name = "AddPasswordHashAndRefreshTokens1788000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // [W1] Add password_hash column to existing users table
    await queryRunner.query(
      `ALTER TABLE "users" ADD "password_hash" character varying(255)`,
    );

    // [W1] Create refresh_tokens table:
    // id (PK), user_id (FK to users), token_hash (NOT NULL), expires_at (NOT NULL),
    // revoked_at (NULL), created_at (DEFAULT now())
    // [X1] family_id is included to enable rotation family tracking and reuse detection
    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "token_hash" character varying(255) NOT NULL,
        "family_id" character varying(255) NOT NULL,
        "expires_at" TIMESTAMP NOT NULL,
        "revoked_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );

    // [W1] & [C3] Index token_hash for O(1) hash lookups during refresh/logout
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash")`,
    );

    // [X1] Index family_id and user_id for fast batch revocation upon reuse detection
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_family_id" ON "refresh_tokens" ("family_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // [W1] Check: migration:revert cleanly removes indexes, refresh_tokens table, and password_hash column
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_refresh_tokens_family_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_refresh_tokens_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_refresh_tokens_token_hash"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "password_hash"`,
    );
  }
}
