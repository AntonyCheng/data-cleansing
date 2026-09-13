// P1 连接器：只做"人在界面上点一下，立刻连接、立刻抓取"，不做定时/增量同步（见 P1 方案）。

export interface SqlConnectorConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  ssl?: boolean;
}

export type ApiAuthType = "none" | "bearer" | "api-key" | "basic";

export interface ApiConnectorConfig {
  baseUrl: string;
  authType: ApiAuthType;
  // authType === "api-key" 时，把凭证放进这个请求头名里；其余鉴权方式固定用 Authorization
  apiKeyHeader?: string;
  // authType === "basic" 时，secret 里存 "username:password"
}

export type ConnectorConfig = SqlConnectorConfig | ApiConnectorConfig;

export interface TestResult {
  ok: boolean;
  message?: string;
}

export interface ExtractResult {
  columns: string[];
  rows: Record<string, string>[];
}

export interface ApiPaginationConfig {
  pageParam?: string; // 默认 "page"
  pageSizeParam?: string; // 默认 "pageSize"
  pageSize?: number; // 默认 50
  // 响应体不是数组时，从哪个点路径取数组，例如 "data.items"；留空则要求响应体本身是数组
  listPath?: string;
}

export interface ApiExtractRequest {
  path: string;
  method: "GET" | "POST";
  pagination?: ApiPaginationConfig;
  limit: number;
}

// 单次抓取/预览的硬上限，哪怕前端传更大的 limit 也会在这里被截断——
// 与本地文件上传的 10,000 行上限对齐（CreateTask.tsx），避免一次拉爆内存或喂给浏览器巨大 JSON。
export const MAX_EXTRACT_ROWS = 10_000;
export const CONNECT_TIMEOUT_MS = 8000;
