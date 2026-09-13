// API 连接器：手动配置鉴权 + 页码翻页，不解析任意 OpenAPI 文档、不支持游标翻页（见 P1 方案）。
import {
  CONNECT_TIMEOUT_MS,
  MAX_EXTRACT_ROWS,
  type ApiConnectorConfig,
  type ApiExtractRequest,
  type ExtractResult,
  type TestResult,
} from "./types.js";

function authHeaders(config: ApiConnectorConfig, secret: string): Record<string, string> {
  switch (config.authType) {
    case "bearer":
      return { Authorization: `Bearer ${secret}` };
    case "api-key":
      return { [config.apiKeyHeader || "X-Api-Key"]: secret };
    case "basic":
      return { Authorization: `Basic ${Buffer.from(secret).toString("base64")}` };
    default:
      return {};
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function testConnection(config: ApiConnectorConfig, secret: string): Promise<TestResult> {
  try {
    const res = await fetchWithTimeout(config.baseUrl, { headers: authHeaders(config, secret) });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `鉴权失败（HTTP ${res.status}），请检查凭证` };
    }
    return { ok: true, message: `已连通（HTTP ${res.status}）` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "连接失败" };
  }
}

// 点路径取值，例如 "data.items" → obj.data.items
function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

export async function extractRows(config: ApiConnectorConfig, secret: string, req: ApiExtractRequest): Promise<ExtractResult> {
  const limit = Math.max(1, Math.min(req.limit, MAX_EXTRACT_ROWS));
  const headers = authHeaders(config, secret);
  const pagination = req.pagination;
  const pageParam = pagination?.pageParam || "page";
  const pageSizeParam = pagination?.pageSizeParam || "pageSize";
  const pageSize = pagination?.pageSize || 50;
  const MAX_PAGES = 200; // 安全上限，防止翻页配置错误导致无限请求

  const collected: Record<string, unknown>[] = [];
  let page = 1;
  while (collected.length < limit && page <= MAX_PAGES) {
    const url = new URL(req.path, config.baseUrl);
    if (pagination) {
      url.searchParams.set(pageParam, String(page));
      url.searchParams.set(pageSizeParam, String(pageSize));
    }
    const res = await fetchWithTimeout(url.toString(), { method: req.method, headers });
    if (!res.ok) throw Object.assign(new Error(`请求失败（HTTP ${res.status}）`), { code: "FETCH_FAILED", status: 502 });
    const body: unknown = await res.json();
    const list = pagination?.listPath ? getByPath(body, pagination.listPath) : body;
    if (!Array.isArray(list)) {
      throw Object.assign(
        new Error(pagination?.listPath ? `响应里 ${pagination.listPath} 不是数组` : "响应体不是数组，请配置「列表字段路径」"),
        { code: "NOT_ARRAY", status: 400 },
      );
    }
    collected.push(...(list as Record<string, unknown>[]));
    if (!pagination || list.length < pageSize) break; // 没配翻页，或这一页不满，说明到底了
    page += 1;
  }

  const rows = collected.slice(0, limit);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return {
    columns,
    rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] == null ? "" : String(r[c])]))),
  };
}
