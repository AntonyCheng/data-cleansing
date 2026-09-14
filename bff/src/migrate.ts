// P0 地基迁移：只有两张表（users、workspaces），刻意不拆分 DataTask/Run 等子结构——
// 见 P0 方案：workspace.data 就是前端 Store 的整坨 JSON，直接照搬现在 localStorage 的存法。
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import { db, pool } from "./db.js";

const migrations: Record<string, Migration> = {
  "001_users": {
    async up(db) {
      await db.schema
        .createTable("users")
        .addColumn("id", "uuid", (col) => col.primaryKey())
        .addColumn("email", "text", (col) => col.notNull().unique())
        .addColumn("password_hash", "text", (col) => col.notNull())
        .addColumn("display_name", "text", (col) => col.notNull())
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
        .execute();
    },
    async down(db) {
      await db.schema.dropTable("users").execute();
    },
  },
  "002_workspaces": {
    async up(db) {
      await db.schema
        .createTable("workspaces")
        .addColumn("user_id", "uuid", (col) => col.primaryKey().references("users.id").onDelete("cascade"))
        .addColumn("data", "jsonb")
        .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
        .execute();
    },
    async down(db) {
      await db.schema.dropTable("workspaces").execute();
    },
  },
  // P1：数据库 / API 连接器。config 是非敏感连接信息（host/port/database/username/baseUrl…），
  // secret 是加密后的密码/Token（见 crypto.ts）——绝不会明文落库，也绝不会整个 workspace JSON
  // 一起回传给浏览器（那是 GET /api/workspace 的返回内容，混进去等于把密码发到前端）。
  "003_connectors": {
    async up(db) {
      await db.schema
        .createTable("connectors")
        .addColumn("id", "uuid", (col) => col.primaryKey())
        .addColumn("owner_id", "uuid", (col) => col.notNull().references("users.id").onDelete("cascade"))
        .addColumn("kind", "text", (col) => col.notNull())
        .addColumn("name", "text", (col) => col.notNull())
        .addColumn("config", "jsonb", (col) => col.notNull())
        .addColumn("secret", "text", (col) => col.notNull())
        .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
        .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
        .execute();
    },
    async down(db) {
      await db.schema.dropTable("connectors").execute();
    },
  },
  // P2：账号角色。平台从"谁都能注册"改成"管理员建号"（见 routes/admin.ts），
  // 需要一个角色位区分管理员与普通用户。ADD COLUMN ... NOT NULL DEFAULT 'user'
  // 在 PG 11+ 是元数据级操作，已有行自动读作 'user'，不需要额外的回填 UPDATE。
  "004_user_role": {
    async up(db) {
      await db.schema
        .alterTable("users")
        .addColumn("role", "text", (col) => col.notNull().defaultTo("user"))
        .execute();
    },
    async down(db) {
      await db.schema.alterTable("users").dropColumn("role").execute();
    },
  },
};

const provider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};

/** 跑到最新版本；幂等，已执行过的 migration 会被跳过。调用方负责自己的 pool 生命周期。 */
export async function migrateToLatest(): Promise<void> {
  const migrator = new Migrator({ db, provider });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    console.log(`[migrate] ${r.status}: ${r.migrationName}`);
  }
  if (error) throw error;
}

// 仅当直接执行本文件时（`npm run migrate`）才跑一次并退出；被 index.ts import 时不会触发。
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  migrateToLatest()
    .catch((e: unknown) => {
      console.error("[migrate] 失败:", e);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
