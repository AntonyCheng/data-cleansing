// 「URL / 网页」来源客户端：让 bff 服务端真实抓取网页并解析静态表格。
import { apiFetch, authHeaders } from "./api";

export interface ParsedPage {
  title: string;
  url: string;
  fetchedAt: string;
  tables: { rows: string[][] }[];
}

export async function parsePage(url: string): Promise<ParsedPage> {
  const res = await apiFetch("/api/page/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ url }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { message?: string } }).error;
    throw new Error(err?.message ?? `抓取失败 (${res.status})`);
  }
  return body as ParsedPage;
}
