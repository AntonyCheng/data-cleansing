// AI 对话改规则的大模型兜底客户端。本地正则（engine.ts: parseInstruction）先匹配，
// 未命中时才调这里——服务端只返回"选中的规则目录 id + 参数覆盖"，具体校验和执行仍在前端。
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
export interface SuggestRuleResponse {
  rules: SuggestedRule[];
  explanation: string;
}

export async function suggestRule(
  text: string,
  fields: { key: string; label: string; type: string }[],
  catalog: { id: string; name: string; description: string; operation: string; target: string; params?: Record<string, string> }[],
): Promise<SuggestRuleResponse> {
  const res = await fetch("/api/ai/suggest-rule", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ text, fields, catalog }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { message?: string } }).error;
    throw new Error(err?.message ?? `请求失败 (${res.status})`);
  }
  return body as SuggestRuleResponse;
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
export function buildRuleMatch(response: SuggestRuleResponse, fields: Field[]): RuleMatch | null {
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
