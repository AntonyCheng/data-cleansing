import type { AudioResult, ImageResult, TaskEnvelope, VideoResult } from "./types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { message?: string } }).error;
    throw new Error(err?.message ?? `请求失败 (${res.status})`);
  }
  return body as T;
}

function postFile<T>(path: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append("file", file);
  return fetch(path, { method: "POST", body: fd }).then(jsonOrThrow<T>);
}

export async function getHealth(): Promise<{ ok: boolean; mode: string; missing_live_config: string[] }> {
  return jsonOrThrow(await fetch("/api/health"));
}

export function cleanImage(file: File): Promise<TaskEnvelope<ImageResult>> {
  return postFile("/api/image/clean", file);
}

export function cleanAudio(file: File): Promise<TaskEnvelope<AudioResult>> {
  return postFile("/api/audio/clean", file);
}

export function cleanVideo(file: File): Promise<TaskEnvelope<VideoResult>> {
  return postFile("/api/video/clean", file);
}

export function uploadVideo(file: File): Promise<{ id: string; filename: string }> {
  return postFile("/api/video/upload", file);
}

export function openVideoStream(id: string, frameIntervalMs: number): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const qs = new URLSearchParams({ id, frame_interval_ms: String(frameIntervalMs) });
  return new WebSocket(`${proto}://${location.host}/api/video/stream?${qs}`);
}

export async function exportToWarehouse(envelope: unknown): Promise<{ ok: boolean; path: string }> {
  return jsonOrThrow(
    await fetch("/api/export/warehouse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelope),
    }),
  );
}
