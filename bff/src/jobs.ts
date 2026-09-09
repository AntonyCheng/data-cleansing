// 后台任务槽：每种类型（image/audio/video）最多一个任务在跑，与浏览器连接的生命周期完全解耦——
// 关浏览器、切类型都不会打断它；进度落盘心跳，BFF 进程重启/容器重建后能重新跑起来，不会真把进行中的任务弄丢。

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { newCostAcc, runWithAcc, withCost } from "./cost.js";
import { cleanAudio, cleanImage, streamVideo, type UploadedFile } from "./providers/volc.js";
import type { JobStatus, TaskEnvelope, TaskStreamMsg, TaskType, VideoResult } from "./types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const JOBS_DIR = join(ROOT, "jobs");

const TYPE_LABEL: Record<TaskType, string> = { image: "图片", audio: "音频", video: "视频" };
const TYPE_APIS: Record<TaskType, string[]> = {
  image: ["ark.doubao-vision"],
  audio: ["tos", "speech.seedasr.auc", "ark.doubao-text"],
  video: ["ark.doubao-vision", "speech.seedasr.auc"],
};

interface JobSnapshot {
  id: string;
  type: TaskType;
  status: JobStatus;
  filename: string;
  mediaUrl: string; // 暴露给前端当 <img>/<video> src
  mediaPath: string; // 磁盘绝对路径，重启续跑用
  mimetype: string;
  frameIntervalMs?: number;
  startedAt: number;
  finishedAt?: number;
  log: TaskStreamMsg[];
}

interface Job extends JobSnapshot {
  listeners: Set<(msg: TaskStreamMsg) => void>;
}

const jobs = new Map<TaskType, Job>();

export class JobBusyError extends Error {
  code = "BUSY";
  status = 409;
}

function snapshotPath(type: TaskType): string {
  return join(JOBS_DIR, `${type}.json`);
}

async function persistNow(job: Job): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
  const { listeners: _listeners, ...snapshot } = job;
  const target = snapshotPath(job.type);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(snapshot));
  await rename(tmp, target); // 先写临时文件再原子改名，进程中途挂掉不会留半截 JSON
}

// appendMsg 在一个任务处理期间会被密集调用（视频一次批处理就是好几条），每条都触发落盘。
// 必须按类型串行化，否则多个并发的 writeFile+rename 抢同一个 .tmp 文件，输的那个 rename 时
// 源文件已经被赢的那个移走，报 ENOENT——这是未捕获的 rejection，会直接崩掉整个进程。
const persistChains = new Map<TaskType, Promise<void>>();

function persist(job: Job): void {
  const prev = persistChains.get(job.type) ?? Promise.resolve();
  const next = prev
    .then(() => persistNow(job))
    .catch((e: unknown) => {
      console.warn(`[jobs] 落盘失败 ${job.type}:`, e instanceof Error ? e.message : e);
    });
  persistChains.set(job.type, next);
}

function envelope<R>(
  type: TaskType,
  filename: string,
  mediaUrl: string,
  result: R,
  costCny: number,
  costCalls?: { api: string; cny: number }[],
): TaskEnvelope<R> {
  return {
    task_id: `tsk_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${randomUUID().slice(0, 8)}`,
    type,
    source: { filename, tos_url: "", duration_ms: 0, media_url: mediaUrl },
    provider: { vendor: "volcengine", apis: TYPE_APIS[type] },
    status: "succeeded",
    cost_estimate_cny: Number(costCny.toFixed(4)),
    cost_calls: costCalls,
    created_at: new Date().toISOString(),
    human_edited: false,
    result,
  };
}

// ---- 三种类型各自的执行体：跑完/出错都要落到 appendMsg，绝不直接往某个 WS 写 ----

async function runImageJob(file: UploadedFile, mediaUrl: string, appendMsg: (m: TaskStreamMsg) => void): Promise<void> {
  const { result, cost } = await withCost(() => cleanImage(file));
  appendMsg({ kind: "result", data: envelope("image", file.originalname, mediaUrl, result, cost.cny, cost.calls) });
  appendMsg({ kind: "done" });
}

async function runAudioJob(file: UploadedFile, mediaUrl: string, appendMsg: (m: TaskStreamMsg) => void): Promise<void> {
  const { result, cost } = await withCost(() => cleanAudio(file));
  appendMsg({ kind: "result", data: envelope("audio", file.originalname, mediaUrl, result, cost.cny, cost.calls) });
  appendMsg({ kind: "done" });
}

async function runVideoJob(
  file: UploadedFile,
  mediaUrl: string,
  frameIntervalMs: number,
  appendMsg: (m: TaskStreamMsg) => void,
): Promise<void> {
  const subtitles: VideoResult["subtitles"] = [];
  const frameEvents: VideoResult["frame_events"] = [];
  let summaryData: Pick<VideoResult, "chapters" | "summary" | "tags" | "entities"> | null = null;
  const acc = newCostAcc();

  await runWithAcc(acc, async () => {
    for await (const msg of streamVideo({ buffer: file.buffer, frameIntervalMs })) {
      if (msg.kind === "subtitle") subtitles.push(msg.data);
      else if (msg.kind === "frame_event") frameEvents.push(msg.data);
      else if (msg.kind === "summary") summaryData = msg.data;
      if (msg.kind === "done") {
        if (summaryData) {
          const result: VideoResult = { subtitles, frame_events: frameEvents, ...summaryData };
          appendMsg({ kind: "result", data: envelope("video", file.originalname, mediaUrl, result, acc.cny, acc.calls) });
        }
        appendMsg({ kind: "cost", data: { cny: Number(acc.cny.toFixed(4)), calls: acc.calls } });
      }
      appendMsg(msg);
    }
  });
}

function startExecution(job: Job, file: UploadedFile): void {
  const appendMsg = (msg: TaskStreamMsg) => {
    job.log.push(msg);
    for (const cb of job.listeners) cb(msg);
    persist(job);
  };
  const run =
    job.type === "image"
      ? runImageJob(file, job.mediaUrl, appendMsg)
      : job.type === "audio"
        ? runAudioJob(file, job.mediaUrl, appendMsg)
        : runVideoJob(file, job.mediaUrl, job.frameIntervalMs ?? 3000, appendMsg);

  run
    .then(() => {
      job.status = "done";
      job.finishedAt = Date.now();
      persist(job);
    })
    .catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      appendMsg({ kind: "error", data: { code: "JOB_FAILED", message } });
      job.status = "error";
      job.finishedAt = Date.now();
      persist(job);
    });
}

/** 新建任务：同类型已有任务在跑则拒绝——同类型仅单并发，跨类型互不影响 */
export function createJob(
  type: TaskType,
  file: UploadedFile,
  mediaUrl: string,
  mediaPath: string,
  frameIntervalMs?: number,
): Job {
  const existing = jobs.get(type);
  if (existing && existing.status === "running") {
    throw new JobBusyError(`「${TYPE_LABEL[type]}」有任务正在处理中，请稍候或先切换查看进度`);
  }
  const job: Job = {
    id: randomUUID(),
    type,
    status: "running",
    filename: file.originalname,
    mediaUrl,
    mediaPath,
    mimetype: file.mimetype,
    frameIntervalMs,
    startedAt: Date.now(),
    log: [],
    listeners: new Set(),
  };
  jobs.set(type, job);
  persist(job);
  startExecution(job, file);
  return job;
}

/** 挂到某类型的任务流：先回放已有的历史消息，任务还在跑的话继续实时转发新消息 */
export function attach(
  type: TaskType,
  onMsg: (msg: TaskStreamMsg) => void,
): { replay: TaskStreamMsg[]; status?: JobStatus; filename?: string; mediaUrl?: string; unsubscribe: () => void } {
  const job = jobs.get(type);
  if (!job) return { replay: [], unsubscribe: () => {} };
  job.listeners.add(onMsg);
  return {
    replay: [...job.log],
    status: job.status,
    filename: job.filename,
    mediaUrl: job.mediaUrl,
    unsubscribe: () => job.listeners.delete(onMsg),
  };
}

/** 轻量状态：给左侧菜单「后台还在跑」的小标识轮询用，不带 log，省流量 */
export function peek(type: TaskType): { hasJob: boolean; status?: JobStatus; filename?: string } {
  const job = jobs.get(type);
  if (!job) return { hasJob: false };
  return { hasJob: true, status: job.status, filename: job.filename };
}

/**
 * 启动时从磁盘恢复：已完结的任务原样恢复只读展示；还在跑的说明进程是被中途重启打断的，
 * 用落盘的原始素材重新跑一遍（旧的半截日志作废，日志从头记，但对前端来说体验上就是"接着跑完了"）。
 */
export async function loadJobsFromDisk(): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
  const files = await readdir(JOBS_DIR).catch(() => [] as string[]);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const snapshot = JSON.parse(await readFile(join(JOBS_DIR, f), "utf8")) as JobSnapshot;
      const job: Job = { ...snapshot, listeners: new Set() };
      jobs.set(job.type, job);
      if (job.status !== "running") continue;

      console.warn(`[jobs] 恢复中断任务 ${job.type}/${job.id}，用落盘素材重新跑一遍`);
      const buffer = await readFile(job.mediaPath).catch(() => null);
      if (!buffer) {
        job.status = "error";
        job.log = [{ kind: "error", data: { code: "RESUME_FAILED", message: "服务重启后找不到原始素材，无法续跑，请重新上传" } }];
        job.finishedAt = Date.now();
        persist(job);
        continue;
      }
      job.log = [];
      job.startedAt = Date.now();
      persist(job);
      startExecution(job, { buffer, originalname: job.filename, mimetype: job.mimetype, size: buffer.length });
    } catch (e) {
      console.warn(`[jobs] 恢复 ${f} 失败:`, e instanceof Error ? e.message : e);
    }
  }
}
