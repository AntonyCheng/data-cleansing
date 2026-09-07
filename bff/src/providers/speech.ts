import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { addCost, speechAucCost } from "../cost.js";
import type { TranscriptLine } from "../types.js";

const BASE = "https://openspeech.bytedance.com/api/v3/auc/bigmodel";

function headers(requestId: string) {
  // 新版豆包语音（2.0 模型）用 X-Api-Key 鉴权，值为语音控制台「API Key」
  return {
    "content-type": "application/json",
    "X-Api-Key": config.speech.apiKey,
    "X-Api-App-Key": config.speech.appId,
    "X-Api-Resource-Id": config.speech.resourceIdAuc,
    "X-Api-Request-Id": requestId,
    "X-Api-Sequence": "-1",
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Utterance {
  start_time?: number;
  end_time?: number;
  text?: string;
  speaker?: string;
  additions?: { speaker?: string };
}

/** 大模型录音文件识别（极速版）：提交 + 轮询 */
export async function recognizeAudio(input: {
  audioUrl: string;
  format: string;
}): Promise<{ text: string; lines: TranscriptLine[] }> {
  const requestId = randomUUID();

  const submit = await fetch(`${BASE}/submit`, {
    method: "POST",
    headers: headers(requestId),
    body: JSON.stringify({
      audio: { url: input.audioUrl, format: input.format },
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: true,
        enable_speaker_info: true,
        show_utterances: true,
      },
    }),
  });
  const submitCode = submit.headers.get("X-Api-Status-Code");
  if (submitCode && submitCode !== "20000000") {
    throw new Error(`录音识别提交失败 ${submitCode}: ${submit.headers.get("X-Api-Message") ?? ""}`);
  }

  for (let i = 0; i < 60; i++) {
    await delay(2000);
    const q = await fetch(`${BASE}/query`, { method: "POST", headers: headers(requestId), body: "{}" });
    const code = q.headers.get("X-Api-Status-Code");
    if (code === "20000000") {
      const body = (await q.json()) as {
        result?: { text?: string; utterances?: Utterance[]; additions?: { duration?: string } };
        audio_info?: { duration?: number };
      };
      const utt = body.result?.utterances ?? [];
      const lines: TranscriptLine[] = utt.map((u) => ({
        speaker: u.additions?.speaker ?? u.speaker ?? "S1",
        start_ms: u.start_time ?? 0,
        end_ms: u.end_time ?? 0,
        text: u.text ?? "",
      }));
      const durMs =
        body.audio_info?.duration ??
        Number(body.result?.additions?.duration ?? 0) ??
        (lines.length ? lines[lines.length - 1].end_ms : 0);
      addCost("speech.auc", speechAucCost(durMs));
      return { text: body.result?.text ?? lines.map((l) => l.text).join(""), lines };
    }
    // 20000001/20000002 处理中；55xxxxxx 多为网关瞬时错误，继续轮询；45xxxxxx 为客户端错误，直接失败
    if (code && !["20000001", "20000002"].includes(code)) {
      if (code.startsWith("45")) {
        throw new Error(`录音识别失败 ${code}: ${q.headers.get("X-Api-Message") ?? ""}`);
      }
      // 其它非终态码：记录并继续重试
      console.warn(`[speech] 查询返回 ${code}，继续轮询 (${q.headers.get("X-Api-Message") ?? ""})`);
    }
  }
  throw new Error("录音识别超时（120s）");
}
