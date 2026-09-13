import { Kysely, PostgresDialect, type Generated } from "kysely";
import pg from "pg";
import { config } from "./config.js";

export interface UsersTable {
  // id 由应用层用 crypto.randomUUID() 生成后插入，不依赖 pgcrypto/uuid-ossp 扩展
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
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
