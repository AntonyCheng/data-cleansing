import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const run = promisify(execFile);
const FFMPEG = ffmpegInstaller.path;

/** 上限：避免超长视频把成本 / 时间打爆（PRD VID-4 护栏的 MVP 版） */
export const MAX_FRAMES = 30;

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "dc-video-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 抽音轨为 16k 单声道 wav */
export async function extractAudioWav(input: Buffer): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, "in");
    const outPath = join(dir, "audio.wav");
    await writeFile(inPath, input);
    await run(FFMPEG, ["-y", "-i", inPath, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", outPath]);
    return readFile(outPath);
  });
}

/** 按间隔抽关键帧，返回 [{tMs, jpeg}]，最多 MAX_FRAMES 帧 */
export async function extractFrames(
  input: Buffer,
  intervalSec: number,
): Promise<{ tMs: number; jpeg: Buffer }[]> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, "in");
    await writeFile(inPath, input);
    await run(FFMPEG, [
      "-y",
      "-i",
      inPath,
      "-vf",
      `fps=1/${intervalSec},scale=768:-2`,
      "-frames:v",
      String(MAX_FRAMES),
      "-q:v",
      "4",
      join(dir, "f_%04d.jpg"),
    ]);
    const files = (await readdir(dir)).filter((f) => f.startsWith("f_")).sort();
    return Promise.all(
      files.map(async (f, i) => ({
        tMs: Math.round(i * intervalSec * 1000),
        jpeg: await readFile(join(dir, f)),
      })),
    );
  });
}

/** 探测时长（毫秒） */
export async function probeDurationMs(input: Buffer): Promise<number> {
  return withTempDir(async (dir) => {
    const inPath = join(dir, "in");
    await writeFile(inPath, input);
    try {
      const { stderr } = await run(FFMPEG, ["-i", inPath], {}).catch((e: unknown) => e as { stderr: string });
      const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr ?? "");
      if (!m) return 0;
      return Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000);
    } catch {
      return 0;
    }
  });
}
