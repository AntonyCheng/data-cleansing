import { Kysely, PostgresDialect, type Generated } from "kysely";
import pg from "pg";
import { config } from "./config.js";

/** 账号角色。DB 里存 text、TS 用联合类型，沿用 connectors.kind 的既有范式（不加 CHECK 约束）。
 *  安全前提：判断一律用等值比较 `!== "admin"`（见 auth.ts:requireAdmin）——
 *  这样任何脏值都只会退化成普通用户，不会提权。若将来改成 role === "Admin" 这类模糊匹配，这个前提就没了。 */
export type UserRole = "admin" | "user";

export interface UsersTable {
  // id 由应用层用 crypto.randomUUID() 生成后插入，不依赖 pgcrypto/uuid-ossp 扩展
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  // 带 DB 默认值 'user'，所以现有的两处 insert（注册、seedDemo）都不用显式传；
  // select 出来一定是 UserRole（非 undefined），requireAdmin 可直接用
  role: Generated<UserRole>;
  created_at: Generated<Date>;
}

// 一个用户对应一整坨工作区 JSON（前端 Store 类型），P0 刻意不拆表——
// 现在前端本来就是"整体覆盖式"写法，服务端原样承接即可，见 P0 方案的取舍说明。
export interface WorkspacesTable {
  user_id: string;
  data: unknown;
  updated_at: Generated<Date>;
}

export type ConnectorKind = "mysql" | "postgres" | "api";

// config 是非敏感连接信息，secret 是加密后的密码/Token（crypto.ts）——两者分列存放，
// 是为了 GET /api/connectors 可以直接 select 除 secret 外的所有列，不用每次手动摘掉敏感字段。
export interface ConnectorsTable {
  id: string;
  owner_id: string;
  kind: ConnectorKind;
  name: string;
  config: unknown;
  secret: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

interface Database {
  users: UsersTable;
  workspaces: WorkspacesTable;
  connectors: ConnectorsTable;
}

export const pool = new pg.Pool({ connectionString: config.db.url });

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
});
