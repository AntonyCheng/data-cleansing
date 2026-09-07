import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import multer from "multer";
import { WebSocketServer } from "ws";
import { assertLiveConfig, config } from "./config.js";
import { type CostAcc, newCostAcc, runWithAcc, withCost } from "./cost.js";
import {
  cleanAudio,
  cleanImage,
  cleanVideo,
  streamVideo,
  type UploadedFile,
} from "./providers/volc.js";
import type { TaskEnvelope, TaskType } from "./types.js";

const app = express();
app.use(cors({ origin: config.webOrigin }));
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

function envelope<R>(
  type: TaskType,
  file: UploadedFile,
  apis: string[],
  result: R,
  cost?: CostAcc,
): TaskEnvelope<R> {
  return {
    task_id: `tsk_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${randomUUID().slice(0, 8)}`,
    type,
    source: { filename: file.originalname, tos_url: "", duration_ms: 0 },
    provider: { vendor: "volcengine", apis },
    status: "succeeded",
    cost_estimate_cny: Number((cost?.cny ?? 0).toFixed(4)),
    cost_calls: cost?.calls,
    created_at: new Date().toISOString(),
    human_edited: false,
    result,
  };
}

function requireFile(req: express.Request): UploadedFile {
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

app.post("/api/image/clean", upload.single("file"), async (req, res, next) => {
  try {
    const file = requireFile(req);
    const { result, cost } = await withCost(() => cleanImage(file));
    res.json(envelope("image", file, ["ark.doubao-vision"], result, cost));
  } catch (e) {
    next(e);
  }
});

app.post("/api/audio/clean", upload.single("file"), async (req, res, next) => {
  try {
    const file = requireFile(req);
    const { result, cost } = await withCost(() => cleanAudio(file));
    res.json(envelope("audio", file, ["tos", "speech.seedasr.auc", "ark.doubao-text"], result, cost));
  } catch (e) {
    next(e);
  }
});

app.post("/api/video/clean", upload.single("file"), async (req, res, next) => {
  try {
    const file = requireFile(req);
    const result = await cleanVideo(file);
    res.json(envelope("video", file, ["ark.doubao-video"], result));
  } catch (e) {
    next(e);
  }
});

// 视频"边播边析"：先上传拿 id，再用 WebSocket 拉流式结果
const videoStore = new Map<string, { buffer: Buffer; name: string; ts: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of videoStore) if (now - v.ts > 15 * 60_000) videoStore.delete(k);
}, 60_000).unref();

app.post("/api/video/upload", upload.single("file"), (req, res, next) => {
  try {
    const file = requireFile(req);
    const id = randomUUID();
    videoStore.set(id, { buffer: file.buffer, name: file.originalname, ts: Date.now() });
    res.json({ id, filename: file.originalname });
  } catch (e) {
    next(e);
  }
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
const wss = new WebSocketServer({ server, path: "/api/video/stream" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  const id = url.searchParams.get("id") ?? "";
  const frameIntervalMs = Math.min(
    10000,
    Math.max(2000, Number(url.searchParams.get("frame_interval_ms") ?? "3000")),
  );

  let closed = false;
  ws.on("close", () => { closed = true; });

  const entry = videoStore.get(id);
  if (config.mode === "live" && !entry) {
    ws.send(JSON.stringify({ kind: "error", data: { code: "NO_VIDEO", message: "视频未找到或已过期，请重新上传" } }));
    ws.close();
    return;
  }

  const acc = newCostAcc();
  runWithAcc(acc, () => {
    void (async () => {
      try {
        for await (const msg of streamVideo({ buffer: entry?.buffer ?? Buffer.alloc(0), frameIntervalMs })) {
          if (closed) return;
          if (msg.kind === "done") {
            ws.send(JSON.stringify({ kind: "cost", data: { cny: Number(acc.cny.toFixed(4)), calls: acc.calls } }));
          }
          ws.send(JSON.stringify(msg));
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!closed) ws.send(JSON.stringify({ kind: "error", data: { code: "STREAM_FAIL", message } }));
      } finally {
        if (id) videoStore.delete(id);
        if (!closed) ws.close();
      }
    })();
  });
});

server.listen(config.port, () => {
  console.log(`[bff] listening on http://localhost:${config.port}  mode=${config.mode}`);
  if (config.mode === "live") {
    const missing = assertLiveConfig();
    if (missing.length) console.warn(`[bff] live 模式缺少配置: ${missing.join(", ")}`);
  }
});
