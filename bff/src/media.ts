// 原始素材落盘：历史回看需要真正的图片/音频/视频文件，不能只留结果 JSON。
// 落到仓库根 uploads/（已 gitignore，compose 挂 volume 持久化），经 /api/media/:file 静态回取。

import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = join(ROOT, "uploads");

/** 总容量上限：超出按最旧优先淘汰（FIFO），避免演示机磁盘被灌爆 */
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mp4": ".m4a",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

function pickExt(mimetype: string, originalname: string): string {
  return extname(originalname) || EXT_BY_MIME[mimetype] || "";
}

/**
 * 落盘原始素材。返回：
 * - url：可直接当 <img>/<audio>/<video> src 用的相对地址（暴露给前端）
 * - path：磁盘绝对路径（只给后端自己用——任务槽做重启续跑时要重新读回这份原始文件）
 */
export async function saveMedia(file: {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}): Promise<{ url: string; path: string }> {
  await mkdir(DIR, { recursive: true });
  const name = `${randomUUID()}${pickExt(file.mimetype, file.originalname)}`;
  const path = join(DIR, name);
  await writeFile(path, file.buffer);
  void enforceQuota();
  return { url: `/api/media/${name}`, path };
}

async function enforceQuota(): Promise<void> {
  try {
    const files = await readdir(DIR);
    const withStats = await Promise.all(files.map(async (f) => ({ f, s: await stat(join(DIR, f)) })));
    withStats.sort((a, b) => a.s.mtimeMs - b.s.mtimeMs);
    let total = withStats.reduce((sum, x) => sum + x.s.size, 0);
    for (const { f, s } of withStats) {
      if (total <= MAX_TOTAL_BYTES) break;
      await rm(join(DIR, f)).catch(() => {});
      total -= s.size;
    }
  } catch {
    /* 目录不存在等异常场景，静默跳过，不影响主流程 */
  }
}

/** 静态回取：express.static 内建 Range 支持，视频历史回看可正常拖动进度 */
export function mountMediaRoute(app: Express): void {
  app.use("/api/media", express.static(DIR, { maxAge: "1h" }));
}
