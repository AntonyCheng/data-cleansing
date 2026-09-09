// 编排层：mock 返回样例；live 调用真实火山服务。

import { extname } from "node:path";
import { config } from "../config.js";
import { mockAudioResult, mockImageResult, mockVideoStream } from "../mock.js";
import type { AudioResult, ImageResult, TaskStreamMsg, VideoResult } from "../types.js";
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
- fields: 数组，每项 {key, label(中文), value(字符串), confidence(0-1)}；尽量抽全关键字段。
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
    model: config.ark.modelImage,
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

// ---------------- 视频（统一走后台任务槽的流式分析，见 jobs.ts） ----------------

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

/** 批量：一次视觉调用理解多帧，减少 API 往返 */
const BATCH_FRAME_PROMPT = (n: number) => `这是一段视频按时间先后等间隔抽取的 ${n} 帧画面。请按顺序逐帧理解，只返回一个 JSON 对象：
{ "frames": [{ "caption": "一句话中文描述该帧画面", "tags": ["3-6 个中文标签"] }, ...] }
frames 数组长度必须恰好为 ${n}，与图片顺序一一对应。
caption 只描述画面内容本身，不要携带"第N帧"、时间码等任何前缀。不要输出 JSON 以外内容。`;

async function captionFrames(jpegs: Buffer[]): Promise<{ caption: string; tags: string[] }[]> {
  const out = await arkChat({
    model: config.ark.modelVision,
    jsonObject: true,
    disableThinking: true,
    maxTokens: 256 * jpegs.length + 256,
    messages: [
      { role: "system", content: BATCH_FRAME_PROMPT(jpegs.length) },
      {
        role: "user",
        content: [
          { type: "text", text: `按顺序描述这 ${jpegs.length} 帧。` },
          ...jpegs.map(
            (j): { type: "image_url"; image_url: { url: string } } => ({
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${j.toString("base64")}` },
            }),
          ),
        ],
      },
    ],
  });
  const p = parseJsonLoose<{ frames?: { caption?: string; tags?: string[] }[] }>(out);
  if (!p.frames || p.frames.length !== jpegs.length) {
    throw new Error(`批量帧描述数量不匹配（期望 ${jpegs.length}，得到 ${p.frames?.length ?? 0}）`);
  }
  return p.frames.map((f) => ({ caption: f.caption ?? "", tags: f.tags ?? [] }));
}

/** 多个异步生成器交错合并：谁先产出谁先出（字幕与画面事件实时穿插下发） */
async function* interleave<T>(gens: AsyncGenerator<T>[]): AsyncGenerator<T> {
  type Task = { i: number; r: IteratorResult<T> };
  const tasks = new Map(gens.map((g, i) => [i, g.next().then((r): Task => ({ i, r }))]));
  while (tasks.size) {
    const { i, r } = await Promise.race(tasks.values());
    tasks.delete(i);
    if (!r.done) {
      yield r.value;
      tasks.set(i, gens[i].next().then((r): Task => ({ i, r })));
    }
  }
}

const VIDEO_SUMMARY_PROMPT = `根据视频的字幕和逐帧画面描述，只返回一个 JSON 对象：
{ "chapters": [{"start_ms": 数字, "end_ms": 数字, "title": "章节标题", "summary": "章节概要"}],
  "summary": "整片一句话摘要",
  "tags": ["3-8 个中文标签"],
  "entities": {"objects": ["出现的物体"], "scenes": ["出现的场景"]} }
不要输出 JSON 以外内容。`;

/**
 * 视频"边播放边分析"：
 * 1) 音轨识别与画面理解两条流水线并行，各自就绪即推送（字幕不再等帧分析跑完）
 * 2) 画面：首帧快车道（单帧先出）+ 其余按批合并调用 / 双路并发，仍按时间序推送
 * 3) 两边都结束后合并生成章节 / 摘要
 */
export async function* streamVideo(input: {
  buffer: Buffer;
  frameIntervalMs: number;
}): AsyncGenerator<TaskStreamMsg> {
  if (config.mode === "mock") {
    for (const msg of mockVideoStream()) {
      await delay(700);
      yield msg;
    }
    return;
  }

  const intervalSec = Math.max(2, input.frameIntervalMs / 1000);

  // ---- 流水线 A：音轨 → 录音识别（先到先推）----
  const subtitles: { start_ms: number; end_ms: number; text: string }[] = [];
  const asrPromise = (async () => {
    const wav = await extractAudioWav(input.buffer);
    const { url } = await putAndSign(wav, ".wav", "audio/wav");
    return recognizeAudio({ audioUrl: url, format: "wav" });
  })().catch((e) => {
    console.warn("[video] ASR 失败:", e instanceof Error ? e.message : e);
    return { text: "", lines: [] as { speaker: string; start_ms: number; end_ms: number; text: string }[] };
  });

  const subtitleStream = async function* (): AsyncGenerator<TaskStreamMsg> {
    const { lines } = await asrPromise;
    for (const l of lines) {
      const s = { start_ms: l.start_ms, end_ms: l.end_ms, text: l.text };
      subtitles.push(s);
      yield { kind: "subtitle", data: s };
    }
  };

  // ---- 流水线 B：逐帧画面理解 ----
  const BATCH_SIZE = 5;
  const BATCH_CONCURRENCY = 2;
  const frameEvents: VideoResult["frame_events"] = [];

  const toEvent = (f: { tMs: number; jpeg: Buffer }, cap: { caption: string; tags: string[] }) => ({
    t_ms: f.tMs,
    thumb_url: `data:image/jpeg;base64,${f.jpeg.toString("base64")}`,
    caption: cap.caption,
    tags: cap.tags,
    scene_change: false,
  });

  const frameStream = async function* (): AsyncGenerator<TaskStreamMsg> {
    const frames = await extractFrames(input.buffer, intervalSec);
    if (frames.length === 0) return;

    // 快车道：第 0 帧单独先出，观众几秒内就能看到第一条画面事件
    {
      const first = frames[0];
      let cap = { caption: "", tags: [] as string[] };
      try {
        cap = await captionFrame(first.jpeg);
      } catch (e) {
        console.warn("[video] 首帧分析失败:", e instanceof Error ? e.message : e);
      }
      const ev = toEvent(first, cap);
      frameEvents.push(ev);
      yield { kind: "frame_event", data: ev };
    }

    // 其余帧：5 帧/调用、2 路并发，完成一批推一批（保持时间顺序）
    const rest = frames.slice(1);
    const batches: { tMs: number; jpeg: Buffer }[][] = [];
    for (let i = 0; i < rest.length; i += BATCH_SIZE) batches.push(rest.slice(i, i + BATCH_SIZE));
    if (batches.length === 0) return;

    const results: (VideoResult["frame_events"] | null)[] = new Array(batches.length).fill(null);
    let nextBatch = 0;
    const worker = async () => {
      while (true) {
        const i = nextBatch++;
        if (i >= batches.length) return;
        try {
          const caps = await captionFrames(batches[i].map((f) => f.jpeg));
          results[i] = batches[i].map((f, j) => toEvent(f, caps[j]));
        } catch (e) {
          // 批量失败（数量不匹配 / 接口报错）→ 该批回退逐帧
          console.warn("[video] 批量帧分析失败，回退单帧:", e instanceof Error ? e.message : e);
          const evs: VideoResult["frame_events"] = [];
          for (const f of batches[i]) {
            let cap = { caption: "", tags: [] as string[] };
            try {
              cap = await captionFrame(f.jpeg);
            } catch { /* 单帧失败保留空描述 */ }
            evs.push(toEvent(f, cap));
          }
          results[i] = evs;
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, () => worker()));

    // 批完成频率远低于轮询间隔，50ms 轮询足够且无丢唤醒问题
    for (let nextYield = 0; nextYield < batches.length; nextYield++) {
      while (results[nextYield] === null) await delay(50);
      for (const ev of results[nextYield]!) {
        frameEvents.push(ev);
        yield { kind: "frame_event", data: ev };
      }
    }
  };

  // ---- 两条流水线交错推送 ----
  for await (const msg of interleave([frameStream(), subtitleStream()])) yield msg;

  // ---- 章节 / 摘要 ----
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
