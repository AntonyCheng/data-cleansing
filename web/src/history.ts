import type { TaskEnvelope, VideoResult } from "./types";

const KEY = "dc:history:v1";
// 之前限死 40 条太抠——放宽上限，真撞到 localStorage 配额时 persist() 会自动砍最旧的，不会一言不合整批丢光
const MAX = 300;

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

/** 写入失败（配额满）时不再整批放弃——砍掉最旧的一半重试，直到写得进去或彻底清空 */
function persist(items: HistoryItem[]): HistoryItem[] {
  let arr = items.slice(0, MAX);
  while (arr.length > 0) {
    try {
      localStorage.setItem(KEY, JSON.stringify(arr));
      return arr;
    } catch {
      arr = arr.slice(0, Math.floor(arr.length / 2));
    }
  }
  try { localStorage.removeItem(KEY); } catch { /* 隐私模式等异常场景，静默降级 */ }
  return [];
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
  return persist(items);
}

/** 删除单条记录 */
export function deleteHistory(taskId: string): HistoryItem[] {
  const items = load().filter((i) => i.task_id !== taskId);
  persist(items);
  return items;
}

export function clearHistory(): HistoryItem[] {
  persist([]);
  return [];
}
