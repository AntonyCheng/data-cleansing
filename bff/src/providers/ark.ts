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

/** 从模型输出里尽力解析出 JSON 对象（兼容 ```json 围栏 / 前后杂讯） */
export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`无法从模型输出解析 JSON: ${text.slice(0, 200)}`);
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
