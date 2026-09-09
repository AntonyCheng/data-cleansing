import type { JobStatus, TaskType } from "./types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { message?: string } }).error;
    throw new Error(err?.message ?? `请求失败 (${res.status})`);
  }
  return body as T;
}

export async function getHealth(): Promise<{ ok: boolean; mode: string; missing_live_config: string[] }> {
  return jsonOrThrow(await fetch("/api/health"));
}

/** 提交任务：立即返回 taskId，真正的处理在服务端后台任务槽里跑，跟这次请求的连接无关。
 *  同类型已有任务在跑会被拒绝（409），message 里带了原因，直接抛出即可。 */
export function startTask(type: TaskType, file: File, opts?: { frameIntervalMs?: number }): Promise<{ taskId: string }> {
  const fd = new FormData();
  fd.append("file", file);
  if (opts?.frameIntervalMs) fd.append("frame_interval_ms", String(opts.frameIntervalMs));
  return fetch(`/api/task/${type}/start`, { method: "POST", body: fd }).then(jsonOrThrow<{ taskId: string }>);
}

/** 轻量轮询：某类型后台是否有任务在跑，给左侧菜单的小标识用 */
export async function peekTask(type: TaskType): Promise<{ hasJob: boolean; status?: JobStatus; filename?: string }> {
  return jsonOrThrow(await fetch(`/api/task/${type}/peek`));
}

/** 接上某类型的任务流：连上先回放历史消息（含「没有任务」/「已完成」这类终态），
 *  还在跑的话继续实时收新消息——跟这条连接是不是刚建立、之前跑了多久完全无关 */
export function openTaskStream(type: TaskType): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/api/task/stream?type=${type}`);
}
