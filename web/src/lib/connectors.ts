// P1：数据库 / API 连接器的 bff 客户端。风格与 lib/media.ts 一致。
import { apiFetch, authHeaders, jsonOrThrow } from "./api";

export type ConnectorKind = "mysql" | "postgres" | "api";
export type ApiAuthType = "none" | "bearer" | "api-key" | "basic";

export interface SqlConnectorConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  ssl?: boolean;
}

export interface ApiConnectorConfig {
  baseUrl: string;
  authType: ApiAuthType;
  apiKeyHeader?: string;
}

export type ConnectorConfig = SqlConnectorConfig | ApiConnectorConfig;

export interface Connector {
  id: string;
  kind: ConnectorKind;
  name: string;
  config: ConnectorConfig;
  created_at: string;
  updated_at: string;
}

export interface TestResult {
  ok: boolean;
  message?: string;
}

export interface ExtractResult {
  columns: string[];
  rows: Record<string, string>[];
}

export interface ApiPaginationConfig {
  pageParam?: string;
  pageSizeParam?: string;
  pageSize?: number;
  listPath?: string;
}

function jsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json", ...authHeaders() };
}

export function listConnectors(): Promise<Connector[]> {
  return apiFetch("/api/connectors", { headers: authHeaders() }).then(jsonOrThrow<Connector[]>);
}

export function testConnector(kind: ConnectorKind, config: ConnectorConfig, secret: string): Promise<TestResult> {
  return apiFetch("/api/connectors/test", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ kind, config, secret }) }).then(
    jsonOrThrow<TestResult>,
  );
}

export function createConnector(kind: ConnectorKind, name: string, config: ConnectorConfig, secret: string): Promise<Connector> {
  return apiFetch("/api/connectors", { method: "POST", headers: jsonHeaders(), body: JSON.stringify({ kind, name, config, secret }) }).then(
    jsonOrThrow<Connector>,
  );
}

export function deleteConnector(id: string): Promise<void> {
  return apiFetch(`/api/connectors/${id}`, { method: "DELETE", headers: authHeaders() }).then((res) => {
    if (!res.ok) throw new Error(`删除失败 (${res.status})`);
  });
}

export function listTables(connectorId: string): Promise<string[]> {
  return apiFetch(`/api/connectors/${connectorId}/tables`, { headers: authHeaders() }).then(jsonOrThrow<string[]>);
}

export function extractSqlRows(connectorId: string, table: string, limit: number): Promise<ExtractResult> {
  return apiFetch(`/api/connectors/${connectorId}/extract`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ table, limit }),
  }).then(jsonOrThrow<ExtractResult>);
}

export function extractApiRows(
  connectorId: string,
  path: string,
  method: "GET" | "POST",
  pagination: ApiPaginationConfig | undefined,
  limit: number,
): Promise<ExtractResult> {
  return apiFetch(`/api/connectors/${connectorId}/extract`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ path, method, pagination, limit }),
  }).then(jsonOrThrow<ExtractResult>);
}
