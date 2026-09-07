import { useRef, useState } from "react";
import type { TaskType } from "../types";

const ACCEPT: Record<TaskType, string> = {
  image: "image/*,.pdf",
  audio: "audio/*",
  video: "video/mp4,video/quicktime",
};
const LIMITS: Record<TaskType, string> = {
  image: "JPG / PNG / WEBP / 单页 PDF · ≤ 10MB",
  audio: "WAV / MP3 / M4A / AAC · ≤ 200MB · ≤ 5h",
  video: "MP4 / MOV · ≤ 500MB · ≤ 30min · 仅本地上传",
};

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

type Phase = "idle" | "uploading" | "cleaning" | "done" | "error";

export function UploadPanel({
  type,
  file,
  phase,
  error,
  frameIntervalMs,
  onFrameIntervalChange,
  onPick,
  onClear,
  onClean,
}: {
  type: TaskType;
  file: File | null;
  phase: Phase;
  error: string | null;
  frameIntervalMs: number;
  onFrameIntervalChange: (ms: number) => void;
  onPick: (f: File) => void;
  onClear: () => void;
  onClean: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const busy = phase === "uploading" || phase === "cleaning";

  const cleanLabel =
    type === "video" ? "确认清洗 · 开始播放 ▷" : "确认清洗 ▸";
  const phaseText =
    phase === "uploading" ? "上传中…" : phase === "cleaning" ? "清洗中…" : "";

  return (
    <div>
      <div
        className={`dropzone${drag ? " drag" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onPick(f);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter") inputRef.current?.click(); }}
      >
        <div className="big">拖拽文件到此，或点击选择</div>
        <div className="hint">{LIMITS[type]}</div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT[type]}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(f);
            e.target.value = "";
          }}
        />
      </div>

      {file && (
        <div className="filecard">
          <div style={{ flex: 1 }}>
            <div className="f-name">{file.name}</div>
            <div className="f-meta">{humanSize(file.size)} · {file.type || "未知类型"}</div>
          </div>
          {!busy && <button className="link" onClick={onClear}>移除</button>}
        </div>
      )}

      {file && (
        <div className="precheck">
          <span>· 预检：格式与大小校验通过（前端）</span>
          {type === "image" && <span>· 版式：上传后由服务端路由（卡证/票据/通用）</span>}
          {type === "audio" && <span>· 预计：录音转写 + 说话人分离 + 大模型摘要</span>}
          {type === "video" && <span>· 预计：流式字幕 + 每 {(frameIntervalMs / 1000).toFixed(0)}s 抽帧画面理解</span>}
        </div>
      )}

      {type === "video" && (
        <div className="slider-row">
          <span>抽帧间隔</span>
          <input
            type="range"
            min={2000}
            max={10000}
            step={1000}
            value={frameIntervalMs}
            disabled={busy}
            onChange={(e) => onFrameIntervalChange(Number(e.target.value))}
          />
          <span>{(frameIntervalMs / 1000).toFixed(0)}s</span>
        </div>
      )}

      <button className="btn-primary" disabled={!file || busy} onClick={onClean}>
        {busy ? phaseText : cleanLabel}
      </button>

      {error && <div className="error-box">✕ {error}</div>}
    </div>
  );
}
