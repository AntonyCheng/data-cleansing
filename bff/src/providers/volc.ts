// 编排层：mock 返回样例；live 调用真实火山服务。

import { extname } from "node:path";
import { config } from "../config.js";
import {
  mockAudioResult,
  mockImageResult,
  mockVideoResult,
  mockVideoStream,
} from "../mock.js";
import type {
  AudioResult,
  ImageResult,
  VideoResult,
  VideoStreamMsg,
} from "../types.js";
import { arkChat, parseJsonLoose } from "./ark.js";
import { recognizeAudio } from "./speech.js";
import { putAndSign } from "./tos.js";
import { extractAudioWav, extractFrames } from "./video.js";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

// ---------------- 图片 ----------------

const IMAGE_PROMPT = `你是票据/证照/图片结构化助手。识别图片内容并只返回一个 JSON 对象，字段：
- layout: 版式标识，如 "vat_invoice"(增值税发票) / "id_card"(身份证) / "bank_card" / "business_license" / "receipt" / "generic"(其它)
- fields: 数组，每项 {key, label(中文), value(字符串), confidence(0-1), bbox}；尽量抽全关键字段。
  bbox 为该字段文字在图片中的像素坐标 [左, 上, 右, 下]（以图片左上角为原点、真实像素为单位）；无法定位时省略 bbox。
- line_items: 数组（仅票据类），每项 {name, amount(数字), tax(数字)}；无则给 []
- full_text: 图片中的完整文字（保留换行）
- summary: 一句话说明这张图是什么
- tags: 3-8 个中文标签数组
不要输出 JSON 以外的任何内容。`;

export async function cleanImage(file: UploadedFile): Promise<ImageResult> {
  if (config.mode === "mock") {
    await delay(600);
    return mockImageResult;
  }
  const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
  const out = await arkChat({
    model: config.ark.modelVision,
    jsonObject: true,
    disableThinking: true,
    messages: [
      { role: "system", content: IMAGE_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "请结构化这张图片。" },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  const parsed = parseJsonLoose<Partial<ImageResult>>(out);
  return {
    layout: parsed.layout ?? "generic",
    fields: parsed.fields ?? [],
    line_items: parsed.line_items ?? [],
    full_text: parsed.full_text ?? "",
    summary: parsed.summary ?? "",
    tags: parsed.tags ?? [],
  };
}

// ---------------- 音频 ----------------

const AUDIO_SUMMARY_PROMPT = `根据下面的会议/录音转写文本，只返回一个 JSON 对象：
{ "tldr": "一句话总结",
  "key_points": [{"text": "要点", "evidence_ms": 对应转写句的起始毫秒}],
  "todos": [{"text": "待办", "owner": "负责人或空字符串"}],
  "entities": {"persons": [], "dates": [], "amounts": []} }
不要输出 JSON 以外内容。`;

export async function cleanAudio(file: UploadedFile): Promise<AudioResult> {
  if (config.mode === "mock") {
    await delay(900);
    return mockAudioResult;
  }
  const ext = extname(file.originalname) || ".mp3";
  const format = ext.replace(".", "").toLowerCase() || "mp3";
  const { url } = await putAndSign(file.buffer, ext, file.mimetype || "audio/mpeg");

  const { text, lines } = await recognizeAudio({ audioUrl: url, format });

  const speakerIds = [...new Set(lines.map((l) => l.speaker))];
  const speakers = speakerIds.map((id, i) => ({ id, name: `说话人${i + 1}` }));

  const transcriptForLlm = lines
    .map((l) => `[${l.start_ms}ms][${l.speaker}] ${l.text}`)
    .join("\n");
  const sumRaw = await arkChat({
    model: config.ark.modelText,
    jsonObject: true,
    disableThinking: true,
    messages: [
      { role: "system", content: AUDIO_SUMMARY_PROMPT },
      { role: "user", content: transcriptForLlm || text },
    ],
  });
  const summary = parseJsonLoose<AudioResult["summary"]>(sumRaw);

  return {
    speakers: speakers.length ? speakers : [{ id: "S1", name: "说话人1" }],
    transcript: lines,
    summary: {
      tldr: summary.tldr ?? "",
      key_points: summary.key_points ?? [],
      todos: summary.todos ?? [],
      entities: summary.entities ?? { persons: [], dates: [], amounts: [] },
    },
  };
}

// ---------------- 视频（M3 前保持 mock / 桩） ----------------

export async function cleanVideo(file: UploadedFile): Promise<VideoResult> {
  if (config.mode === "mock") {
    await delay(1200);
    return mockVideoResult;
  }
  void file;
  throw Object.assign(new Error("视频整片非实时分析暂用流式接口，见 /api/video/stream"), { code: "NOT_IMPLEMENTED" });
}

const FRAME_PROMPT = `描述这一帧视频画面，只返回 JSON：
{ "caption": "一句话中文描述画面内容", "tags": ["3-6 个中文标签"] }
不要输出 JSON 以外内容。`;

async function captionFrame(jpeg: Buffer): Promise<{ caption: string; tags: string[] }> {
  const out = await arkChat({
    model: config.ark.modelVision,
    jsonObject: true,
    disableThinking: true,
    maxTokens: 512,
    messages: [
      { role: "system", content: FRAME_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "这一帧画面是什么？" },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpeg.toString("base64")}` } },
        ],
      },
    ],
  });
  const p = parseJsonLoose<{ caption?: string; tags?: string[] }>(out);
  return { caption: p.caption ?? "", tags: p.tags ?? [] };
}

const VIDEO_SUMMARY_PROMPT = `根据视频的字幕和逐帧画面描述，只返回一个 JSON 对象：
{ "chapters": [{"start_ms": 数字, "end_ms": 数字, "title": "章节标题", "summary": "章节概要"}],
  "summary": "整片一句话摘要",
  "tags": ["3-8 个中文标签"],
  "entities": {"objects": ["出现的物体"], "scenes": ["出现的场景"]} }
不要输出 JSON 以外内容。`;

/**
 * 视频"边播放边分析"：
 * 1) 后台抽音轨 + 录音识别（并行）
 * 2) 逐帧抽画面送视觉理解，实时吐 frame_event
 * 3) 字幕就绪后吐 subtitle
 * 4) 合并生成章节 / 摘要
 */
export async function* streamVideo(input: {
  buffer: Buffer;
  frameIntervalMs: number;
}): AsyncGenerator<VideoStreamMsg> {
  if (config.mode === "mock") {
    for (const msg of mockVideoStream()) {
      await delay(700);
      yield msg;
    }
    return;
  }

  const intervalSec = Math.max(2, input.frameIntervalMs / 1000);

  // 1. 音轨 → 录音识别（后台并行）
  const asrPromise = (async () => {
    const wav = await extractAudioWav(input.buffer);
    const { url } = await putAndSign(wav, ".wav", "audio/wav");
    return recognizeAudio({ audioUrl: url, format: "wav" });
  })().catch((e) => {
    console.warn("[video] ASR 失败:", e instanceof Error ? e.message : e);
    return { text: "", lines: [] as { speaker: string; start_ms: number; end_ms: number; text: string }[] };
  });

  // 2. 逐帧画面理解
  const frames = await extractFrames(input.buffer, intervalSec);
  const frameEvents: VideoResult["frame_events"] = [];
  for (const f of frames) {
    let cap = { caption: "", tags: [] as string[] };
    try {
      cap = await captionFrame(f.jpeg);
    } catch (e) {
      console.warn("[video] 帧分析失败 @", f.tMs, e instanceof Error ? e.message : e);
    }
    const ev = {
      t_ms: f.tMs,
      thumb_url: `data:image/jpeg;base64,${f.jpeg.toString("base64")}`,
      caption: cap.caption,
      tags: cap.tags,
      scene_change: false,
    };
    frameEvents.push(ev);
    yield { kind: "frame_event", data: ev };
  }

  // 3. 字幕
  const { lines } = await asrPromise;
  const subtitles = lines.map((l) => ({ start_ms: l.start_ms, end_ms: l.end_ms, text: l.text }));
  for (const s of subtitles) yield { kind: "subtitle", data: s };

  // 4. 章节 / 摘要
  try {
    const ctx = [
      "字幕：",
      subtitles.map((s) => `[${s.start_ms}ms] ${s.text}`).join("\n") || "（无）",
      "\n画面：",
      frameEvents.map((e) => `[${e.t_ms}ms] ${e.caption}`).join("\n") || "（无）",
    ].join("\n");
    const raw = await arkChat({
      model: config.ark.modelText,
      jsonObject: true,
      disableThinking: true,
      messages: [
        { role: "system", content: VIDEO_SUMMARY_PROMPT },
        { role: "user", content: ctx },
      ],
    });
    const s = parseJsonLoose<Pick<VideoResult, "chapters" | "summary" | "tags" | "entities">>(raw);
    yield {
      kind: "summary",
      data: {
        chapters: s.chapters ?? [],
        summary: s.summary ?? "",
        tags: s.tags ?? [],
        entities: s.entities ?? { objects: [], scenes: [] },
      },
    };
  } catch (e) {
    console.warn("[video] 摘要失败:", e instanceof Error ? e.message : e);
  }

  yield { kind: "done" };
}
