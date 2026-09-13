// 数据库连接器：MySQL / PostgreSQL。每次操作现开一个只连一条连接的临时连接池，用完即关——
// 这是 P1 的连接器，跟 bff/src/db.ts 那个连"应用自己数据库"的常驻连接完全分开、互不相关。
import { Kysely, MysqlDialect, PostgresDialect, sql } from "kysely";
import { createPool as createMysqlPool } from "mysql2";
import pg from "pg";
import type { ConnectorKind } from "../db.js";
import { CONNECT_TIMEOUT_MS, MAX_EXTRACT_ROWS, type ExtractResult, type SqlConnectorConfig, type TestResult } from "./types.js";

// 表名/列名只允许常见的标识符字符，防止哪怕经过 sql.id() 也传进奇怪的东西
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
function assertSafeIdentifier(name: string, label: string): void {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw Object.assign(new Error(`${label}包含非法字符`), { code: "BAD_IDENTIFIER", status: 400 });
  }
}

interface AnyRow {
  [key: string]: unknown;
}
type Db = Kysely<{ [table: string]: AnyRow }>;

function openDb(kind: ConnectorKind, config: SqlConnectorConfig, secret: string): { db: Db; close: () => Promise<void> } {
  if (kind === "mysql") {
    const pool = createMysqlPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: secret,
      ssl: config.ssl ? {} : undefined,
      connectTimeout: CONNECT_TIMEOUT_MS,
      connectionLimit: 1,
    });
    const db = new Kysely<{ [table: string]: AnyRow }>({ dialect: new MysqlDialect({ pool }) });
    return { db, close: () => new Promise((resolve) => pool.end(() => resolve())) };
  }
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: secret,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    max: 1,
  });
  const db = new Kysely<{ [table: string]: AnyRow }>({ dialect: new PostgresDialect({ pool }) });
  return { db, close: () => pool.end() };
}

export async function testConnection(kind: ConnectorKind, config: SqlConnectorConfig, secret: string): Promise<TestResult> {
  const { db, close } = openDb(kind, config, secret);
  try {
    await sql`select 1`.execute(db);
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "连接失败" };
  } finally {
    await close().catch(() => {});
  }
}

export async function listTables(kind: ConnectorKind, config: SqlConnectorConfig, secret: string): Promise<string[]> {
  const { db, close } = openDb(kind, config, secret);
  try {
    const schemaFilter = kind === "mysql" ? sql`table_schema = database()` : sql`table_schema = 'public'`;
    const result = await sql<{
      table_name: string;
    }>`select table_name from information_schema.tables where table_type = 'BASE TABLE' and ${schemaFilter} order by table_name`.execute(
      db,
    );
    return result.rows.map((r) => r.table_name);
  } finally {
    await close().catch(() => {});
  }
}

export async function extractRows(
  kind: ConnectorKind,
  config: SqlConnectorConfig,
  secret: string,
  table: string,
  limit: number,
): Promise<ExtractResult> {
  assertSafeIdentifier(table, "表名");
  const cappedLimit = Math.max(1, Math.min(limit, MAX_EXTRACT_ROWS));
  const { db, close } = openDb(kind, config, secret);
  try {
    // 表名经 sql.id() 走驱动的标识符转义，不做字符串拼接；只做 SELECT，不接受任意 SQL 文本
    const result = await sql<AnyRow>`select * from ${sql.id(table)} limit ${sql.lit(cappedLimit)}`.execute(db);
    const rows = result.rows;
    const columns = rows.length ? Object.keys(rows[0]) : [];
    const cell = (v: unknown): string => (v == null ? "" : v instanceof Date ? v.toISOString() : String(v));
    return {
      columns,
      rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c, cell(r[c])]))),
    };
  } finally {
    await close().catch(() => {});
  }
}
