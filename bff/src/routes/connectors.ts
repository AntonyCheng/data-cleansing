// P1：数据库 / API 连接器管理与抓取。全部路由已在 index.ts 挂载处套了 requireAuth。
import { randomUUID } from "node:crypto";
import express from "express";
import { db } from "../db.js";
import type { ConnectorKind } from "../db.js";
import { decryptSecret, encryptSecret } from "../crypto.js";
import * as sqlConnector from "../connectors/sql.js";
import * as apiConnector from "../connectors/api.js";
import type { ApiConnectorConfig, ApiExtractRequest, SqlConnectorConfig } from "../connectors/types.js";

const router = express.Router();

const KINDS: ConnectorKind[] = ["mysql", "postgres", "api"];
function isKind(v: unknown): v is ConnectorKind {
  return typeof v === "string" && (KINDS as string[]).includes(v);
}
function badRequest(message: string): never {
  throw Object.assign(new Error(message), { code: "BAD_REQUEST", status: 400 });
}

async function testByKind(kind: ConnectorKind, config: unknown, secret: string) {
  if (kind === "api") return apiConnector.testConnection(config as ApiConnectorConfig, secret);
  return sqlConnector.testConnection(kind, config as SqlConnectorConfig, secret);
}

async function loadOwnedConnector(id: string, ownerId: string) {
  const row = await db.selectFrom("connectors").selectAll().where("id", "=", id).where("owner_id", "=", ownerId).executeTakeFirst();
  if (!row) throw Object.assign(new Error("连接不存在"), { code: "NOT_FOUND", status: 404 });
  return row;
}

router.get("/", async (req, res, next) => {
  try {
    const rows = await db
      .selectFrom("connectors")
      .select(["id", "kind", "name", "config", "created_at", "updated_at"])
      .where("owner_id", "=", req.userId!)
      .orderBy("created_at", "desc")
      .execute();
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post("/test", async (req, res, next) => {
  try {
    const { kind, config, secret } = req.body as { kind?: unknown; config?: unknown; secret?: unknown };
    if (!isKind(kind)) badRequest("未知连接类型");
    if (!config || typeof config !== "object") badRequest("缺少连接配置");
    const result = await testByKind(kind, config, typeof secret === "string" ? secret : "");
    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { kind, name, config, secret } = req.body as {
      kind?: unknown;
      name?: unknown;
      config?: unknown;
      secret?: unknown;
    };
    if (!isKind(kind)) badRequest("未知连接类型");
    if (!name || typeof name !== "string") badRequest("请填写连接名称");
    if (!config || typeof config !== "object") badRequest("缺少连接配置");
    if (typeof secret !== "string") badRequest("缺少凭证");
    const id = randomUUID();
    await db
      .insertInto("connectors")
      .values({ id, owner_id: req.userId!, kind, name, config: JSON.stringify(config), secret: encryptSecret(secret) })
      .execute();
    res.status(201).json({ id, kind, name, config });
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    await db.deleteFrom("connectors").where("id", "=", req.params.id).where("owner_id", "=", req.userId!).execute();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

router.get("/:id/tables", async (req, res, next) => {
  try {
    const row = await loadOwnedConnector(req.params.id, req.userId!);
    if (row.kind === "api") badRequest("API 连接没有「表」的概念");
    const tables = await sqlConnector.listTables(row.kind, row.config as SqlConnectorConfig, decryptSecret(row.secret));
    res.json(tables);
  } catch (e) {
    next(e);
  }
});

router.post("/:id/extract", async (req, res, next) => {
  try {
    const row = await loadOwnedConnector(req.params.id, req.userId!);
    const limit = Number(req.body?.limit ?? 20);
    if (row.kind === "api") {
      const { path, method, pagination } = req.body as Partial<ApiExtractRequest>;
      if (!path || typeof path !== "string") badRequest("请填写请求路径");
      const result = await apiConnector.extractRows(row.config as ApiConnectorConfig, decryptSecret(row.secret), {
        path,
        method: method === "POST" ? "POST" : "GET",
        pagination,
        limit,
      });
      res.json(result);
    } else {
      const { table } = req.body as { table?: unknown };
      if (!table || typeof table !== "string") badRequest("请选择表");
      const result = await sqlConnector.extractRows(row.kind, row.config as SqlConnectorConfig, decryptSecret(row.secret), table, limit);
      res.json(result);
    }
  } catch (e) {
    next(e);
  }
});

export default router;
