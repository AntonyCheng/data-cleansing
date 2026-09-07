import type { TaskEnvelope, VideoResult } from "./types";

const KEY = "dc:history:v1";
const MAX = 40;

export interface HistoryItem {
  task_id: string;
  type: TaskEnvelope["type"];
  filename: string;
  created_at: string;
  summary: string;
  cost_estimate_cny: number;
  envelope: TaskEnvelope;
}

/** 去掉体积大的 data URI（视频缩略帧），让 localStorage 存得下 */
function trim(env: TaskEnvelope): TaskEnvelope {
  const clone = JSON.parse(JSON.stringify(env)) as TaskEnvelope;
  if (clone.type === "video") {
    const r = clone.result as VideoResult;
    if (Array.isArray(r?.frame_events)) {
      r.frame_events = r.frame_events.map((f) => ({ ...f, thumb_url: "" }));
    }
  }
  return clone;
}

function load(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
  } catch {
    return [];
  }
}

function persist(items: HistoryItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    /* 隐私模式 / 配额满：静默降级 */
  }
}

export function listHistory(): HistoryItem[] {
  return load();
}

export function addHistory(env: TaskEnvelope, filename: string, summary: string): HistoryItem[] {
  const item: HistoryItem = {
    task_id: env.task_id,
    type: env.type,
    filename,
    created_at: env.created_at,
    summary,
    cost_estimate_cny: env.cost_estimate_cny,
    envelope: trim(env),
  };
  const items = [item, ...load().filter((i) => i.task_id !== env.task_id)];
  persist(items);
  return items.slice(0, MAX);
}

export function clearHistory(): HistoryItem[] {
  persist([]);
  return [];
}
