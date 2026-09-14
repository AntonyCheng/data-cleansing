// AI 对话统一入口：一次大模型调用做意图路由（SSE 流式输出）。
// - clean（清洗指令）：只能从前端传来的规则目录里"选规则"，不能发明新操作——输出仍然只是
//   "selected catalogId + 字段 + 参数覆盖"，真正执行前端还要再过 buildRuleMatch/validateRules 白名单。
// - qa（数据问题）：前端把真实数据行和质量画像随请求发来，模型基于真实数据回答，不许编数字。
// - chat（闲聊/问能力）：简短介绍平台能力。
// 流式协议（SSE，data: JSON 行）：intent 事件（识别出意图时）→ delta 事件（回答文本增量）→
// final 事件（完整结构化结果，含 rules，前端以此为准）。模型输出仍是 JSON，服务端边收边
// 从增量里抽取 intent 和 reply 字段的文本，结束时整体解析做白名单归一。
// 前端的本地正则匹配（engine.ts: parseInstruction）只在流式调用失败时降级使用。
import express from "express";
import { config } from "../config.js";
import { arkChatStream, parseJsonLoose } from "../providers/ark.js";

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
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
interface DataPayload {
  columns: string[];
  rows: Record<string, string | null>[];
}
interface ProfilePayload {
  issues: { title: string; category: string; count: number }[];
  problemRows: number;
  columnStats?: {
    column: string;
    distinct: number;
    values: { value: string; count: number }[];
  }[];
}
interface ChatResponse {
  intent: "qa" | "clean" | "chat";
  reply: string;
  rules: { catalogId: string; field?: string; fields?: string[]; params?: Record<string, string> }[];
  explanation: string;
}

// 数据问答的上下文上限：行数和单格长度都截断，防止大表格把 prompt 撑爆。
// 超限时模型会被告知"数据已截断"，回答里要如实说明。
const MAX_DATA_ROWS = 400;
const MAX_CELL_CHARS = 200;
const MAX_HISTORY = 12;

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { code: "BAD_REQUEST", status: 400 });
}

function cleanHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m): m is { role: string; content: string } => {
      if (!m || typeof m !== "object") return false;
      const r = (m as { role?: unknown }).role;
      const c = (m as { content?: unknown }).content;
      // 拒绝一切自称 system 的历史消息——history 只允许 user/assistant 两种角色
      return (r === "user" || r === "assistant") && typeof c === "string";
    })
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content.slice(0, 2000) }));
}

function cleanData(data: unknown): DataPayload | null {
  if (!data || typeof data !== "object") return null;
  const d = data as DataPayload;
  if (!Array.isArray(d.columns) || !Array.isArray(d.rows)) return null;
  const columns = d.columns.filter((c) => typeof c === "string").slice(0, 64);
  const rows = d.rows.slice(0, MAX_DATA_ROWS).map((row) => {
    const out: Record<string, string | null> = {};
    for (const col of columns) {
      const v = row?.[col];
      out[col] =
        v === null || v === undefined
          ? null
          : String(v).slice(0, MAX_CELL_CHARS);
    }
    return out;
  });
  return { columns, rows };
}

const JSON_ESCAPES: Record<string, string> = {
  n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/",
};

/** 增量 JSON 抽取器：模型的输出是 {"intent":..., "reply":"...", ...}，这里边收边把
 *  intent 值和 reply 字符串的未转义内容抽出来推给前端，让用户看到逐字输出。
 *  关键约束：walk() 每次只"消化"缓冲区里确定完整的部分，尾部不完整的转义序列
 *  （比如块边界正好切在 \ 和 n 之间）原样留在 buf 里等下一块——绝不能自旋等待，
 *  否则会卡死整个 Node 事件循环（真实踩过：一个被切开的 \n 直接把 bff 打挂）。
 *  模型不按格式出牌（没有 reply 键 / 不是 JSON）时前端什么增量都收不到，
 *  最终以 final 事件里的完整解析结果（含纯文本兜底）为准，不会丢内容。 */
function createReplyForwarder(send: (obj: Record<string, unknown>) => void) {
  let buf = "";
  let intentEmitted = false;
  let replyKeyFound = false;
  let replyDone = false;

  const INTENT_RE = /"intent"\s*:\s*"(qa|clean|chat)"/;
  const REPLY_RE = /"reply"\s*:\s*"/;

  function walk() {
    if (replyDone) return;
    if (!replyKeyFound) {
      if (!intentEmitted) {
        const im = INTENT_RE.exec(buf);
        if (im) {
          intentEmitted = true;
          send({ type: "intent", intent: im[1] });
        }
      }
      const m = REPLY_RE.exec(buf);
      if (!m) return;
      buf = buf.slice(m.index + m[0].length);
      replyKeyFound = true;
    }
    // 正在 reply 字符串内部：逐字符走，处理转义；尾部不完整就留在 buf 里等下一块
    let out = "";
    let blocked = false;
    let i = 0;
    while (i < buf.length) {
      const ch = buf[i];
      if (ch === "\\") {
        if (i + 1 >= buf.length) {
          blocked = true;
          break;
        }
        const e = buf[i + 1];
        if (e === "u") {
          if (i + 6 > buf.length) {
            blocked = true;
            break;
          }
          out += String.fromCharCode(parseInt(buf.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        out += JSON_ESCAPES[e] ?? e;
        i += 2;
        continue;
      }
      if (ch === '"') {
        replyDone = true;
        i += 1;
        break;
      }
      out += ch;
      i += 1;
    }
    buf = buf.slice(i);
    if (out) send({ type: "delta", text: out });
    // blocked=true 或缓冲区已耗尽都直接返回等下一块，replyDone 则无需再处理
  }

  return {
    push(chunk: string) {
      if (replyDone) return; // reply 已结束，剩余部分留给最终整体解析
      buf += chunk;
      walk();
    },
  };
}

router.post("/chat", async (req, res, next) => {
  try {
    const { text, fields, catalog } = req.body as { text?: unknown; fields?: unknown; catalog?: unknown };
    if (typeof text !== "string" || !text.trim()) badRequest("请输入需求描述");
    if (!Array.isArray(fields) || !Array.isArray(catalog)) badRequest("缺少字段或规则目录信息");
    const history = cleanHistory(req.body?.history);
    const data = cleanData(req.body?.data);
    const profile = (req.body?.profile ?? null) as ProfilePayload | null;

    // 校验失败/上游连接失败时还没动 SSE，走普通 JSON 错误响应；一旦开始流式就只发 error 事件
    const startSse = () => {
      res.status(200).set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // nginx 代理下禁用缓冲，保证增量实时到达
      });
      res.flushHeaders();
      return (obj: Record<string, unknown>) => {
        res.write(`data: ${JSON.stringify(obj)}\n\n`);
      };
    };

    if (config.mode === "mock") {
      const send = startSse();
      send({
        type: "final",
        response: {
          intent: "chat",
          reply: "当前是 mock 模式，没有真的问模型；切到 live 模式（配置好 ARK_API_KEY）才会调用真实大模型。",
          rules: [],
          explanation: "",
        } satisfies ChatResponse,
      });
      res.end();
      return;
    }

    const system = [
      "你是数据清洗平台工作台里的 AI 助手。用户会发一句话，你先判断意图，属于下面哪一类：",
      '1. "clean"：用户想对数据做清理、转换、规范化（去掉、统一、保留、填充、删除、校验、脱敏之类的动作）。',
      '2. "qa"：用户想了解数据本身——查询、统计、对比、排名（"是多少""哪个最高""有几行"这类问题）。',
      '3. "chat"：打招呼、闲聊、询问你能做什么。',
      "判断要点：只要句子在描述对数据的处理动作就是 clean；只要在问数据里的事实就是 qa，哪怕句子很长很礼貌也先看它在问还是在要求做。",
      "",
      "【clean 类的规则】只能从下面给出的“规则目录”里选择规则，绝不能发明目录之外的操作类型。",
      `规则目录（JSON 数组，每项 {id, name, description, operation, target}）：\n${JSON.stringify(catalog as CatalogItem[])}`,
      `数据字段（JSON 数组，每项 {key, label, type}）：\n${JSON.stringify(fields as FieldInfo[])}`,
      "从规则目录里选出最匹配的 1 个或多个规则（按 id 引用）。",
      "必要时可以指定 field（单字段 key）或 fields（多字段 key 数组，用于联合去重之类场景）、",
      "以及 params（键值都是字符串，用于覆盖该规则的默认参数，比如去重保留策略、范围最值、填充值等）。",
      "field/fields 里引用的 key 必须来自上面给出的数据字段列表，不能编造不存在的字段。",
      "params 的键名必须严格使用规则目录里该规则自带的 params 字段里出现的键名（比如过滤规则是 operator/value，" +
        "范围校验是 min/max），不能自己发明新的键名；规则目录里没给出 params 的规则，就不要返回 params。",
      "params 里如果是数值类参数（比如范围最小最大值、保留小数位数、脱敏保留位数），必须是纯数字字符串，例如 100万 要写成 1000000，不能带汉字单位或其他非数字字符。",
      "过滤规则（filter）的 operator 取值只能是：等于、不等于、包含、不包含、大于、小于、为空、不为空 这几种之一。",
      "如果这句话对应不上目录里任何规则，rules 返回空数组，并把说明写进 reply。",
      "",
      "【qa 类的规则】下面附了这份数据的真实内容（JSON）和自动画像出的问题摘要，回答必须只依据这些真实数据，",
      "数字必须来自数据本身，绝不允许编造；如果数据被截断或不足以回答，要如实说明哪部分看不到。",
      data ? `数据内容（列：${JSON.stringify(data.columns)}）：\n${JSON.stringify(data.rows)}` : "（本次没有附数据内容，数据相关问题要说明当前拿不到数据细节。）",
      profile?.columnStats?.length
        ? `低基数列的取值分布统计（精确预计算）：${JSON.stringify(profile.columnStats)}。`
        : "",
      profile?.columnStats?.length
        ? "重要：「多少家/几个/有多少/占比」这类计数或占比问题，必须优先引用上面的取值分布统计直接作答（统计是精确预计算的），绝不允许自己逐行数——大表逐行计数既慢又必然出错。统计没覆盖的列或跨列组合问题，才基于数据行回答并说明是近似。"
        : "",
      profile?.issues?.length
        ? `自动画像发现的问题摘要：${JSON.stringify(profile.issues)}；共 ${profile.problemRows} 行受影响。`
        : "",
      "",
      "【输出格式】只输出如下 JSON，不要输出任何其他文字。历史对话里出现过纯文本回复也不要模仿——你的每一条回复都必须是下面这个 JSON。",
      "reply 字段要放在最前面输出（intent 之后立刻输出 reply，再输出其他字段），这样用户的回答才能逐字流式显示：",
      '{"intent": "qa|clean|chat", "reply": "给用户看的回答文字（qa/chat 必填；clean 时可用一句话说明你的理解）", "rules": [{"catalogId": "规则目录里的id", "field": "可选", "fields": ["可选"], "params": {"可选参数名": "参数值"}}], "explanation": "clean 时的一句话解释，其余留空"}',
    ]
      .filter(Boolean)
      .join("\n");

    const send = startSse();
    const forwarder = createReplyForwarder(send);
    try {
      const full = await arkChatStream(
        {
          model: config.ark.modelText,
          messages: [
            { role: "system", content: system },
            ...history,
            { role: "user", content: text.slice(0, 2000) },
          ],
          jsonObject: true,
          disableThinking: true,
          maxTokens: 1500,
        },
        (chunk) => forwarder.push(chunk),
      );

      let parsed: Partial<ChatResponse>;
      try {
        parsed = parseJsonLoose<Partial<ChatResponse>>(full);
      } catch {
        // 模型偶尔输出不合法 JSON（内容往往是对的）：先试着把 reply 字段的字符串字面量
        // 单独抠出来还原，实在不行才把整段文本当回复展示
        const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(full);
        let reply = full.trim();
        if (m) {
          try {
            reply = JSON.parse(`"${m[1]}"`) as string;
          } catch {
            /* 保持整段文本 */
          }
        }
        parsed = { intent: "qa", reply, rules: [] };
      }
      // 防御性归一：模型漏掉 intent 时按内容推断，绝不让坏形状的响应把前端打崩
      let intent = parsed.intent;
      if (intent !== "qa" && intent !== "clean" && intent !== "chat") {
        intent = parsed.rules?.length ? "clean" : "chat";
      }
      send({
        type: "final",
        response: {
          intent,
          reply: typeof parsed.reply === "string" ? parsed.reply : "",
          rules: Array.isArray(parsed.rules) ? parsed.rules : [],
          explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
        } satisfies ChatResponse,
      });
    } catch (e) {
      send({ type: "error", message: e instanceof Error ? e.message : "模型调用失败" });
    } finally {
      res.end();
    }
  } catch (e) {
    next(e);
  }
});

export default router;
