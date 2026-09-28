// ============================================================================
// [W1] WARM-UP REQUIREMENT: refresh_tokens table entity
// Stores only the hash of the refresh token, never the raw token (HINT in W1)
// [X1] family_id is mapped to support rotation family reuse detection
// ============================================================================
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from "typeorm";
import { User } from "./user.entity.js";

@Entity("refresh_tokens")
export class RefreshToken {
  // [W1] id PK
  @PrimaryGeneratedColumn()
  id!: number;

  // [W1] user_id FK to users NOT NULL
  @Column({ name: "user_id", type: "int" })
  userId!: number;

  // [W1] token_hash NOT NULL: store SHA-256 hash, never raw token in database
  @Column({ name: "token_hash", type: "varchar", length: 255 })
  tokenHash!: string;

  // [X1] family_id: track rotation lineage to detect token reuse
  @Column({ name: "family_id", type: "varchar", length: 255 })
  familyId!: string;

  // [W1] & [X2] expires_at NOT NULL: source of truth for token expiration
  @Column({ name: "expires_at", type: "timestamp" })
  expiresAt!: Date;

  // [W1] & [C3] revoked_at NULL: set to timestamp upon rotation or logout
  @Column({ name: "revoked_at", type: "timestamp", nullable: true })
  revokedAt!: Date | null;

  // [W1] created_at
  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @ManyToOne(() => User, (user) => user.refreshTokens, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: Relation<User>;
}
