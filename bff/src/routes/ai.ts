// AI 对话改规则：本地正则先匹配（前端 engine.ts 的 parseInstruction，零成本零延迟），
// 未命中的才会打到这里问大模型兜底。模型只能从前端传来的规则目录里"选规则"，不能发明新操作——
// 输出仍然只是"selected catalogId + 字段 + 参数覆盖"，真正执行前端还要再过一遍 validateRules() 白名单。
import express from "express";
import { config } from "../config.js";
import { arkChat, parseJsonLoose } from "../providers/ark.js";

const router = express.Router();

interface CatalogItem {
  id: string;
  name: string;
  description: string;
  operation: string;
  target: string;
  params?: Record<string, string>;
}
interface FieldInfo {
  key: string;
  label: string;
  type: string;
}
interface SuggestResponse {
  rules: { catalogId: string; field?: string; fields?: string[]; params?: Record<string, string> }[];
  explanation: string;
}

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { code: "BAD_REQUEST", status: 400 });
}

router.post("/suggest-rule", async (req, res, next) => {
  try {
    const { text, fields, catalog } = req.body as { text?: unknown; fields?: unknown; catalog?: unknown };
    if (typeof text !== "string" || !text.trim()) badRequest("请输入需求描述");
    if (!Array.isArray(fields) || !Array.isArray(catalog)) badRequest("缺少字段或规则目录信息");

    if (config.mode === "mock") {
      res.json({
        rules: [],
        explanation: "当前是 mock 模式，没有真的问模型；切到 live 模式（配置好 ARK_API_KEY）才会调用真实大模型。",
      } satisfies SuggestResponse);
      return;
    }

    const system = [
      "你是数据清洗助手。只能从下面给出的“规则目录”里选择规则，绝不能发明目录之外的操作类型。",
      `规则目录（JSON 数组，每项 {id, name, description, operation, target}）：\n${JSON.stringify(catalog as CatalogItem[])}`,
      `数据字段（JSON 数组，每项 {key, label, type}）：\n${JSON.stringify(fields as FieldInfo[])}`,
      "任务：理解用户这句话想做什么清洗，从规则目录里选出最匹配的 1 个或多个规则（按 id 引用）。",
      "必要时可以指定 field（单字段 key）或 fields（多字段 key 数组，用于联合去重之类场景）、",
      "以及 params（键值都是字符串，用于覆盖该规则的默认参数，比如去重保留策略、范围最值、填充值等）。",
      "field/fields 里引用的 key 必须来自上面给出的数据字段列表，不能编造不存在的字段。",
      "params 的键名必须严格使用规则目录里该规则自带的 params 字段里出现的键名（比如过滤规则是 operator/value，" +
        "范围校验是 min/max），不能自己发明新的键名；规则目录里没给出 params 的规则，就不要返回 params。",
      "params 里如果是数值类参数（比如范围最小最大值、保留小数位数、脱敏保留位数），必须是纯数字字符串，例如 100万 要写成 1000000，不能带汉字单位或其他非数字字符。",
      "过滤规则（filter）的 operator 取值只能是：等于、不等于、包含、不包含、大于、小于、为空、不为空 这几种之一。",
      "如果这句话对应不上目录里任何规则，rules 返回空数组，并在 explanation 里说明当前支持哪些类型的需求。",
      "只输出如下 JSON，不要输出任何其他文字或解释：",
      '{"rules": [{"catalogId": "规则目录里的id", "field": "可选", "fields": ["可选"], "params": {"可选参数名": "参数值"}}], "explanation": "一句话解释你的理解和建议，给用户看"}',
    ].join("\n\n");

    const content = await arkChat({
      model: config.ark.modelText,
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
      jsonObject: true,
      disableThinking: true,
      maxTokens: 800,
    });
    const parsed = parseJsonLoose<Partial<SuggestResponse>>(content);
    res.json({ rules: parsed.rules ?? [], explanation: parsed.explanation ?? "" } satisfies SuggestResponse);
  } catch (e) {
    next(e);
  }
});

export default router;
