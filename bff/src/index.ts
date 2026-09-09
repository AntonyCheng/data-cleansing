import { appendFile, mkdir } from "node:fs/promises";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import { WebSocket, WebSocketServer } from "ws";
import { assertLiveConfig, config } from "./config.js";
import { attach, createJob, loadJobsFromDisk, peek } from "./jobs.js";
import { mountMediaRoute, saveMedia } from "./media.js";
import type { TaskStreamMsg, TaskType } from "./types.js";

// 兜底：任何位置漏掉的未捕获 rejection 只记日志，不崩进程——后台任务槽的核心价值就是
// "浏览器怎么折腾都不影响服务端"，如果一个偶发错误就能把整个进程干崩、被 Docker 拉起来
// 重启，所有正在跑的任务全部丢失，这个承诺就是假的。
process.on("unhandledRejection", (reason) => {
  console.error("[bff] 未捕获的 Promise rejection（已拦截，进程继续跑）:", reason);
});

const app = express();
app.use(cors({ origin: config.webOrigin }));
app.use(express.json({ limit: "25mb" }));
mountMediaRoute(app);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const TASK_TYPES: TaskType[] = ["image", "audio", "video"];
function isTaskType(v: string): v is TaskType {
  return (TASK_TYPES as string[]).includes(v);
}

function requireFile(req: express.Request): { buffer: Buffer; originalname: string; mimetype: string; size: number } {
  if (!req.file) throw Object.assign(new Error("未收到文件"), { code: "NO_FILE", status: 400 });
  return {
    buffer: req.file.buffer,
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  };
}

// 落盘目录（仓库根，已 gitignore）
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
async function appendJsonl(sub: string, obj: unknown): Promise<string> {
  const dir = join(ROOT, sub);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  await appendFile(path, `${JSON.stringify(obj)}\n`);
  return path;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: config.mode,
    missing_live_config: config.mode === "live" ? assertLiveConfig() : [],
  });
});

// ---- 后台任务槽：每类型最多一个在跑，与浏览器连接生命周期解耦 ----

app.post("/api/task/:type/start", upload.single("file"), async (req, res, next) => {
  try {
    const { type } = req.params;
    if (!isTaskType(type)) throw Object.assign(new Error("未知任务类型"), { code: "BAD_TYPE", status: 400 });
    const file = requireFile(req);
    const media = await saveMedia(file);
    const frameIntervalMs =
      type === "video"
        ? Math.min(10000, Math.max(2000, Number(req.body?.frame_interval_ms ?? "3000")))
        : undefined;
    const job = createJob(type, file, media.url, media.path, frameIntervalMs);
    res.status(202).json({ taskId: job.id });
  } catch (e) {
    next(e);
  }
});

// 轻量状态：左侧菜单「后台还在跑」小标识轮询用
app.get("/api/task/:type/peek", (req, res, next) => {
  const { type } = req.params;
  if (!isTaskType(type)) return next(Object.assign(new Error("未知任务类型"), { code: "BAD_TYPE", status: 400 }));
  res.json(peek(type));
});

// 数仓回传（本期落 exports/*.jsonl，占位真实数仓对接）
app.post("/api/export/warehouse", async (req, res, next) => {
  try {
    const env = req.body as { task_id?: string };
    if (!env || !env.task_id) throw Object.assign(new Error("缺少任务数据"), { code: "BAD_REQUEST", status: 400 });
    const path = await appendJsonl("exports", { ...env, _exported_at: new Date().toISOString() });
    res.json({ ok: true, path });
  } catch (e) {
    next(e);
  }
});

// 埋点上报
app.post("/api/telemetry", async (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];
  await Promise.all(
    events.map((ev) => appendJsonl("telemetry", { ...ev, _at: new Date().toISOString() }).catch(() => {})),
  );
  res.status(204).end();
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const e = err as { code?: string; message?: string; status?: number };
  const code = e.code ?? "INTERNAL";
  const status = e.status ?? (code === "NOT_IMPLEMENTED" ? 501 : 500);
  console.error("[bff] error:", e.message ?? e);
  res.status(status).json({ error: { code, message: e.message ?? "服务器错误" } });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/api/task/stream" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  const type = url.searchParams.get("type") ?? "";
  if (!isTaskType(type)) {
    ws.send(JSON.stringify({ kind: "error", data: { code: "BAD_TYPE", message: "未知任务类型" } }));
    ws.close();
    return;
  }

  // done/error 在这套模型里永远是任务的最后一条消息（见 jobs.ts），发完就可以关连接了——
  // 不管是刚连上时回放到的，还是正连着时任务才跑完的，都走这一条路径
  const send = (msg: TaskStreamMsg) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
    if (msg.kind === "done" || msg.kind === "error") ws.close();
  };

  const { replay, status, filename, mediaUrl, unsubscribe } = attach(type, send);
  ws.on("close", unsubscribe);

  if (!status) {
    send({ kind: "no_job" });
    ws.close();
    return;
  }
  send({ kind: "status", data: { status, filename: filename ?? "", media_url: mediaUrl ?? "" } });
  for (const msg of replay) send(msg);
});

// 任务槽必须在开始接请求之前恢复完，否则重启瞬间 peek/attach 会看到一个假的「没有任务」
await loadJobsFromDisk();

server.listen(config.port, () => {
  console.log(`[bff] listening on http://localhost:${config.port}  mode=${config.mode}`);
  if (config.mode === "live") {
    const missing = assertLiveConfig();
    if (missing.length) console.warn(`[bff] live 模式缺少配置: ${missing.join(", ")}`);
  }
});
