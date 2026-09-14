import { config } from "../config.js";
import { addCost, arkCost } from "../cost.js";

interface ArkContent {
  type: "text" | "image_url" | "video_url";
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
}
export interface ArkMessage {
  role: "system" | "user" | "assistant";
  content: string | ArkContent[];
}

/** 调用火山方舟 Chat Completions（OpenAI 兼容） */
export async function arkChat(opts: {
  model: string;
  messages: ArkMessage[];
  jsonObject?: boolean;
  maxTokens?: number;
  /** 关闭深度思考以加速（结构化抽取类任务不需要） */
  disableThinking?: boolean;
}): Promise<string> {
  const res = await fetch(`${config.ark.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.ark.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 4096,
      ...(opts.jsonObject ? { response_format: { type: "json_object" } } : {}),
      ...(opts.disableThinking ? { thinking: { type: "disabled" } } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(new Error(`方舟调用失败 ${res.status}: ${body.slice(0, 500)}`), { code: "ARK_ERROR" });
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const u = data.usage;
  if (u) addCost(`ark:${opts.model}`, arkCost(opts.model, u.prompt_tokens ?? 0, u.completion_tokens ?? 0));
  return data.choices?.[0]?.message?.content ?? "";
}

/** 调用火山方舟 Chat Completions（OpenAI 兼容），流式版本：每收到一段增量文本就回调一次，
 *  返回拼接后的完整内容。SSE 行解析失败的单行直接跳过，不让一条脏行中断整个流。 */
export async function arkChatStream(
  opts: {
    model: string;
    messages: ArkMessage[];
    maxTokens?: number;
    /** 关闭深度思考以加速（结构化抽取类任务不需要） */
    disableThinking?: boolean;
    jsonObject?: boolean;
  },
  onDelta: (text: string) => void,
): Promise<string> {
  const res = await fetch(`${config.ark.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.ark.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 4096,
      stream: true,
      stream_options: { include_usage: true },
      ...(opts.jsonObject ? { response_format: { type: "json_object" } } : {}),
      ...(opts.disableThinking ? { thinking: { type: "disabled" } } : {}),
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`方舟调用失败 ${res.status}: ${body.slice(0, 500)}`),
      { code: "ARK_ERROR" },
    );
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  const handleLine = (raw: string) => {
    const line = raw.trim();
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const j = JSON.parse(payload) as {
        choices?: { delta?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const delta = j.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) {
        full += delta;
        onDelta(delta);
      }
      const u = j.usage;
      if (u) addCost(`ark:${opts.model}`, arkCost(opts.model, u.prompt_tokens ?? 0, u.completion_tokens ?? 0));
    } catch {
      // 单行解析失败只跳过这一行
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      handleLine(line);
    }
  }
  if (buf.trim()) handleLine(buf);
  return full;
}

/** 从模型输出里尽力解析出 JSON 对象（兼容 ```json 围栏 / 前后杂讯） */
export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`无法从模型输出解析 JSON: ${text.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
