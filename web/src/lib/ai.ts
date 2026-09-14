// AI 对话的大模型客户端。对话统一走 /api/ai/chat（SSE 流式）：模型先判断意图（数据问答 /
// 选清洗规则 / 闲聊），回答文本以增量事件实时到达；选规则时只返回"规则目录 id + 参数覆盖"，
// 具体校验和执行仍在前端（buildRuleMatch + validateRules）。
import { authHeaders } from "./api";
import { makeRule, ruleCatalog } from "../data/rules";
import { parseNumber } from "./engine";
import type { Field, Rule } from "./types";

// execute() 里这几个参数会被 Number(...) 直接转数字（不像 parseNumber 会处理"100万"这种单位）——
// 模型习惯按人话给"100万"，这里统一转成纯数字字符串，转不出来就宁可丢弃、退回 makeRule 的默认值，
// 也不要塞一个会让 Number(...) 变成 NaN 的怪值进去。
const NUMERIC_PARAM_KEYS = new Set(["min", "max", "prefix", "suffix", "digits"]);
const FILTER_OPERATORS = new Set(["等于", "不等于", "包含", "不包含", "大于", "小于", "为空", "不为空"]);

export interface SuggestedRule {
  catalogId: string;
  field?: string;
  fields?: string[];
  params?: Record<string, string>;
}
export type ChatIntent = "qa" | "clean" | "chat";
export interface ChatResponse {
  intent: ChatIntent;
  reply: string;
  rules: SuggestedRule[];
  explanation: string;
}

// 数据问答上下文的截断常量——与后端约定一致，超限部分由后端再兜底截一次。
// 500 行足够完整装下 438 条的景区名录这类演示大表（约 2 万 token，turbo 上下文内无压力）
const MAX_DATA_ROWS = 500;
const MAX_CELL_CHARS = 200;

/** 把任务的原始行压成给模型看的数据载荷：行数和单格长度都截断，防止大表格撑爆 prompt */
export function buildDataPayload(
  rows: { values: Record<string, string | null> }[],
  fields: Field[],
): { columns: string[]; rows: Record<string, string | null>[] } {
  const columns = fields.map((f) => f.key);
  return {
    columns,
    rows: rows.slice(0, MAX_DATA_ROWS).map((r) =>
      Object.fromEntries(
        columns.map((key) => {
          const v = r.values[key];
          return [key, v === null || v === undefined ? null : String(v).slice(0, MAX_CELL_CHARS)];
        }),
      ),
    ),
  };
}

export interface ChatStreamHandlers {
  /** 回答文本增量（已按 JSON 字符串转义还原），逐字渲染用 */
  onDelta?: (text: string) => void;
  /** 模型判定出的意图（识别到就早触发，可用于切换 UI 提示） */
  onIntent?: (intent: ChatIntent) => void;
}

/** 对低基数列（distinct ≤ 20）计算取值分布，随 QA 上下文发给模型。
 *  大表上让 LLM 逐行"数数"既慢又容易错（438 行景区表数 4A 实测数出错误值）——
 *  计数类问题让模型直接引用这份聚合统计，又快又准。 */
export function buildColumnStats(
  rows: { values: Record<string, string | null> }[],
  fields: Field[],
): { column: string; distinct: number; values: { value: string; count: number }[] }[] {
  const stats: { column: string; distinct: number; values: { value: string; count: number }[] }[] = [];
  for (const field of fields) {
    const counts = new Map<string, number>();
    let distinct = 0;
    for (const row of rows) {
      const v = row.values[field.key];
      if (v === null || v === undefined || v === "") continue;
      if (!counts.has(v)) {
        distinct++;
        // 超过 20 个不同值就没必要继续精确数了（高基数列不给分布）
        if (distinct > 20) break;
      }
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    if (distinct > 20) continue;
    stats.push({
      column: field.key,
      distinct,
      values: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([value, count]) => ({ value, count })),
    });
  }
  return stats;
}

/** 流式对话：服务端 SSE 推 intent → delta* → final（完整结构化结果，以此为准）。
 *  校验失败时服务端返回普通 JSON 错误（HTTP 非 200），这里统一抛 Error 走调用方的降级路径。 */
export async function chatWithAI(
  opts: {
    text: string;
    history: { role: "user" | "assistant"; content: string }[];
    fields: { key: string; label: string; type: string }[];
    catalog: { id: string; name: string; description: string; operation: string; target: string; params?: Record<string, string> }[];
    data: { columns: string[]; rows: Record<string, string | null>[] } | null;
    profile: {
      issues: { title: string; category: string; count: number }[];
      problemRows: number;
      columnStats?: { column: string; distinct: number; values: { value: string; count: number }[] }[];
    } | null;
  },
  handlers: ChatStreamHandlers = {},
): Promise<ChatResponse> {
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = (body as { error?: { message?: string } }).error;
    throw new Error(err?.message ?? `请求失败 (${res.status})`);
  }
  if (!res.body) throw new Error("当前浏览器不支持流式响应");
  const isSse = (res.headers.get("content-type") ?? "").includes("text/event-stream");
  if (!isSse) {
    // 兜底：万一服务端没按 SSE 返回，按普通 JSON 处理
    return (await res.json()) as ChatResponse;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finalResp: ChatResponse | null = null;
  const handleFrame = (frame: string) => {
    for (const line of frame.split("\n")) {
      if (!line.startsWith("data:")) continue;
      let ev: { type: string; intent?: ChatIntent; text?: string; response?: ChatResponse; message?: string };
      try {
        ev = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (ev.type === "delta" && typeof ev.text === "string") handlers.onDelta?.(ev.text);
      else if (ev.type === "intent" && ev.intent) handlers.onIntent?.(ev.intent);
      else if (ev.type === "final" && ev.response) finalResp = ev.response;
      else if (ev.type === "error") throw new Error(ev.message ?? "模型调用失败");
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      handleFrame(frame);
    }
  }
  if (buf.trim()) handleFrame(buf);
  if (!finalResp) throw new Error("连接中断，未收到完整回复");
  return finalResp;
}

export interface RuleMatch {
  rules: Rule[];
  custom: boolean;
  name: string;
  explanation: string;
}

/** 把模型的建议转成可执行的 Rule[]——只认目录里真实存在的 id，field/fields 只认任务里真实存在的字段，
 *  跟本地正则匹配（engine.ts: parseInstruction）产出同一种形状，两条路径共用后面的展示/执行逻辑。
 *  这里"过滤掉编不存在的 id/字段"就是 DSL 白名单的第一道关卡，执行前 validateRules() 还会再挡一次。 */
export function buildRuleMatch(
  response: { rules: SuggestedRule[]; explanation: string },
  fields: Field[],
): RuleMatch | null {
  const fieldKeys = new Set(fields.map((f) => f.key));
  const rules: Rule[] = [];
  const names: string[] = [];
  for (const s of response.rules) {
    const def = ruleCatalog.find((r) => r.id === s.catalogId);
    if (!def) continue; // 模型编了一个不存在的规则 id，直接丢弃
    const rule = makeRule(def, fields);
    if (s.field && fieldKeys.has(s.field)) rule.field = s.field;
    if (s.fields) {
      const valid = s.fields.filter((k) => fieldKeys.has(k));
      if (valid.length) rule.fields = valid;
    }
    if (s.params) {
      // 只接受这条规则本来就有的参数键名——模型发明的新键名（比如把 operator 写成"比较方式"）
      // 直接丢弃，宁可保留 makeRule 给的默认值，也不要让一个没人读的野键名静默生效。
      const allowedKeys = new Set(Object.keys(rule.params));
      const merged = { ...rule.params };
      for (const [k, v] of Object.entries(s.params)) {
        if (!allowedKeys.has(k)) continue;
        if (k === "operator") {
          if (FILTER_OPERATORS.has(v)) merged[k] = v;
          continue;
        }
        if (!NUMERIC_PARAM_KEYS.has(k)) {
          merged[k] = v;
          continue;
        }
        const n = parseNumber(v);
        if (n !== null) merged[k] = String(n);
      }
      rule.params = merged;
    }
    rules.push(rule);
    names.push(def.name);
  }
  if (!rules.length) return null;
  return { rules, custom: true, name: names.join(" + "), explanation: response.explanation };
}
