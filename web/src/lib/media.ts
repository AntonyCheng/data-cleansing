// 图片 / 音频 / 视频清洗的数据契约与 bff 客户端。
// 与 bff/src/types.ts 保持同步；移植自 web/src/types.ts + web/src/api.ts。

import { apiFetch, authHeaders, getToken, jsonOrThrow, notifyUnauthorized } from "./api";

export type MediaKind = "image" | "audio" | "video";
export type JobStatus = "running" | "done" | "error";

export interface TaskEnvelope<R = unknown> {
  task_id: string;
  type: MediaKind;
  source: { filename: string; tos_url: string; duration_ms: number; media_url?: string };
  provider: { vendor: "volcengine"; apis: string[] };
  status: "queued" | "running" | "succeeded" | "failed";
  cost_estimate_cny: number;
  cost_calls?: { api: string; cny: number }[];
  created_at: string;
  human_edited: boolean;
  error?: { code: string; message: string };
  result: R;
}

export interface ImageField {
  key: string;
  label: string;
  value: string;
  confidence: number;
  bbox?: [number, number, number, number];
}
export interface ImageResult {
  layout: string;
  fields: ImageField[];
  line_items?: { name: string; amount: number; tax: number }[];
  full_text: string;
  summary: string;
  tags: string[];
}

export interface TranscriptLine {
  speaker: string;
  start_ms: number;
  end_ms: number;
  text: string;
}
export interface AudioResult {
  speakers: { id: string; name: string }[];
  transcript: TranscriptLine[];
  summary: {
    tldr: string;
    key_points: { text: string; evidence_ms: number }[];
    todos: { text: string; owner: string }[];
    entities: { persons: string[]; dates: string[]; amounts: string[] };
  };
}

export interface Subtitle {
  start_ms: number;
  end_ms: number;
  text: string;
}
export interface FrameEvent {
  t_ms: number;
  thumb_url: string;
  caption: string;
  tags: string[];
  scene_change: boolean;
}
export interface VideoChapter {
  start_ms: number;
  end_ms: number;
  title: string;
  summary: string;
}
export interface VideoResult {
  subtitles: Subtitle[];
  frame_events: FrameEvent[];
  chapters: VideoChapter[];
  summary: string;
  tags: string[];
  entities: { objects: string[]; scenes: string[] };
}

export type TaskStreamMsg =
  | { kind: "status"; data: { status: JobStatus; filename: string; media_url: string } }
  | { kind: "no_job" }
  | { kind: "result"; data: TaskEnvelope }
  | { kind: "subtitle"; data: Subtitle }
  | { kind: "frame_event"; data: FrameEvent }
  | { kind: "summary"; data: Pick<VideoResult, "chapters" | "summary" | "tags" | "entities"> }
  | { kind: "cost"; data: { cny: number; calls: { api: string; cny: number }[] } }
  | { kind: "error"; data: { code: string; message: string } }
  | { kind: "done" };

export async function getMediaHealth(): Promise<{ ok: boolean; mode: string; missing_live_config: string[] }> {
  // 用原生 fetch：/api/health 是公开接口、不带登录态，没有"身份失效"可言
  return jsonOrThrow(await fetch("/api/health"));
}

/** 提交任务：立即返回 taskId，真正的处理在服务端后台任务槽里跑。
 *  同类型已有任务在跑会被拒绝（409），把 message 原样抛出即可。 */
export function startMediaTask(
  kind: MediaKind,
  file: File,
  opts?: { frameIntervalMs?: number },
): Promise<{ taskId: string }> {
  const fd = new FormData();
  fd.append("file", file);
  if (opts?.frameIntervalMs) fd.append("frame_interval_ms", String(opts.frameIntervalMs));
  return apiFetch(`/api/task/${kind}/start`, { method: "POST", headers: authHeaders(), body: fd }).then(
    jsonOrThrow<{ taskId: string }>,
  );
}

/** 轻量轮询：某类型后台是否有任务在跑 */
export async function peekMediaTask(
  kind: MediaKind,
): Promise<{ hasJob: boolean; status?: JobStatus; filename?: string }> {
  return jsonOrThrow(await apiFetch(`/api/task/${kind}/peek`, { headers: authHeaders() }));
}

/** 接上某类型的任务流：连上先回放历史消息，还在跑的话继续实时收新消息。
 *  浏览器原生 WebSocket 不能自定义请求头，鉴权 token 跟 type 一样走查询串。 */
export function openMediaTaskStream(kind: MediaKind): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const token = encodeURIComponent(getToken() ?? "");
  const ws = new WebSocket(`${proto}://${location.host}/api/task/stream?type=${kind}&token=${token}`);
  // token 失效时服务端发一帧 {kind:"error",data:{code:"UNAUTHORIZED"}} 就关连接。
  // 调用方（MediaWorkbench）会用 ws.onmessage 接管消息、把处理器整体覆盖掉，
  // 所以这里用 addEventListener 旁听（两者共存），把 WebSocket 这一路也接进统一的自动登出——
  // 否则用户只会看到"实时连接异常"，而不知道要重新登录。
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as { kind?: string; data?: { code?: string } };
      if (msg.kind === "error" && msg.data?.code === "UNAUTHORIZED") notifyUnauthorized();
    } catch {
      /* 非 JSON 帧忽略 */
    }
  });
  return ws;
}

export function toSrt(lines: { start_ms: number; end_ms: number; text: string }[]): string {
  const ts = (ms: number) => {
    const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    const x = String(ms % 1000).padStart(3, "0");
    return `${h}:${m}:${s},${x}`;
  };
  return lines.map((l, i) => `${i + 1}\n${ts(l.start_ms)} --> ${ts(l.end_ms)}\n${l.text}\n`).join("\n");
}

/** 从任意类型的完整 envelope 里抠出一句话摘要，给任务列表用 */
export function summaryTextOf(env: TaskEnvelope): string {
  if (env.type === "image") return (env.result as ImageResult).summary;
  if (env.type === "audio") return (env.result as AudioResult).summary.tldr;
  return (env.result as VideoResult).summary;
}

/** 去掉体积大的 data URI（视频缩略帧），让 localStorage 存得下 */
export function trimEnvelopeForStorage(env: TaskEnvelope): TaskEnvelope {
  const clone = JSON.parse(JSON.stringify(env)) as TaskEnvelope;
  if (clone.type === "video") {
    const r = clone.result as VideoResult;
    if (Array.isArray(r?.frame_events)) {
      r.frame_events = r.frame_events.map((f) => ({ ...f, thumb_url: "" }));
    }
  }
  return clone;
}

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = {
  image: "图片",
  audio: "音频",
  video: "视频",
};
