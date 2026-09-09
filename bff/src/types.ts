// 结果数据结构 —— 与 PRD 第 07 节一致。前端 web/src/types.ts 保持同步。

export type TaskType = "image" | "audio" | "video";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface TaskEnvelope<R = unknown> {
  task_id: string;
  type: TaskType;
  source: { filename: string; tos_url: string; duration_ms: number; media_url?: string };
  provider: { vendor: "volcengine"; apis: string[] };
  status: TaskStatus;
  cost_estimate_cny: number;
  cost_calls?: { api: string; cny: number }[];
  created_at: string;
  human_edited: boolean;
  error?: { code: string; message: string };
  result: R;
}

// ---- 图片 ----
export interface ImageField {
  key: string;
  label: string;
  value: string;
  confidence: number;
  bbox?: [number, number, number, number];
}
export interface ImageResult {
  layout: string; // "vat_invoice" | "id_card" | ... | "generic"
  fields: ImageField[];
  line_items?: { name: string; amount: number; tax: number }[];
  full_text: string;
  summary: string;
  tags: string[];
}

// ---- 音频 ----
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

// ---- 视频 ----
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

// ---- 上传 ----
export interface UploadResult {
  tos_url: string;
  filename: string;
  size: number;
  content_type: string;
  duration_ms: number;
}

// ---- 视频实时流（WebSocket 消息）----
// ---- 后台任务槽（每类型最多一个在跑，与浏览器连接生命周期解耦）----
export type JobStatus = "running" | "done" | "error";

export type TaskStreamMsg =
  // 接上任务流时的握手：先告诉你有没有任务、目前什么状态，再回放历史消息
  | { kind: "status"; data: { status: JobStatus; filename: string; media_url: string } }
  | { kind: "no_job" }
  // 图片 / 音频是一次性出全量结果，包一层 result 消息，格式上与视频的增量消息统一
  | { kind: "result"; data: TaskEnvelope }
  | { kind: "subtitle"; data: Subtitle }
  | { kind: "frame_event"; data: FrameEvent }
  | { kind: "summary"; data: Pick<VideoResult, "chapters" | "summary" | "tags" | "entities"> }
  | { kind: "cost"; data: { cny: number; calls: { api: string; cny: number }[] } }
  | { kind: "error"; data: { code: string; message: string } }
  | { kind: "done" };
