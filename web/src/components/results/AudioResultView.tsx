import { useRef } from "react";
import type { AudioResult, TaskEnvelope } from "../../types";
import { track } from "../../telemetry";
import { copyJson, downloadJson, downloadText, toSrt } from "../export";

type Phase = "idle" | "uploading" | "cleaning" | "done" | "error";

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function AudioResultView({
  env,
  phase,
  previewUrl,
  onEditTldr,
  onWarehouse,
}: {
  env: TaskEnvelope<AudioResult> | null;
  phase: Phase;
  previewUrl: string | null;
  onEditTldr: (tldr: string) => void;
  onWarehouse: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seek = (ms: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = ms / 1000;
      audioRef.current.play().catch(() => {});
    }
  };

  if (phase === "uploading" || phase === "cleaning") {
    return (
      <div>
        {previewUrl && <div className="preview"><audio ref={audioRef} src={previewUrl} controls /></div>}
        <div className="skeleton" style={{ width: "50%" }} />
        <div className="skeleton" />
        <div className="skeleton" style={{ width: "70%" }} />
      </div>
    );
  }

  if (!env) {
    return <div className="empty">上传音频并点击「确认清洗」。<br />输出分说话人、带时间戳的全文 + 结构化摘要。</div>;
  }

  const r = env.result;
  const nameOf = (id: string) => r.speakers.find((s) => s.id === id)?.name ?? id;

  return (
    <div>
      {previewUrl && <div className="preview"><audio ref={audioRef} src={previewUrl} controls /></div>}

      <div className="subhead">
        摘要（可编辑）
        {env.human_edited && <span className="edited-flag">已人工修正</span>}
      </div>
      <textarea
        className="tldr-input"
        value={r.summary.tldr}
        aria-label="摘要"
        rows={2}
        onChange={(e) => onEditTldr(e.target.value)}
      />

      <div className="subhead">要点（点击跳转音频）</div>
      <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
        {r.summary.key_points.map((k, i) => (
          <li key={i} style={{ cursor: "pointer" }} onClick={() => seek(k.evidence_ms)}>
            {k.text} <span className="cf">· {mmss(k.evidence_ms)}</span>
          </li>
        ))}
      </ul>

      {r.summary.todos.length > 0 && (
        <>
          <div className="subhead">待办</div>
          <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
            {r.summary.todos.map((t, i) => <li key={i}>{t.text}{t.owner ? `（${t.owner}）` : ""}</li>)}
          </ul>
        </>
      )}

      <div className="subhead">全文（分说话人 · 带时间戳）</div>
      <div className="transcript">
        {r.transcript.map((l, i) => (
          <div key={i} className="line" onClick={() => seek(l.start_ms)}>
            <div>
              <div className="t">{mmss(l.start_ms)}</div>
              <div className="sp">{nameOf(l.speaker)}</div>
            </div>
            <div>{l.text}</div>
          </div>
        ))}
      </div>

      <div className="export-bar">
        <button onClick={() => { copyJson(env); track("export", { via: "copy", type: "audio" }); }}>复制 JSON</button>
        <button onClick={() => { downloadJson(`${env.task_id}.json`, env); track("export", { via: "download", type: "audio" }); }}>下载 JSON</button>
        <button
          onClick={() =>
            downloadText(
              `${env.task_id}.srt`,
              toSrt(r.transcript.map((l) => ({ start_ms: l.start_ms, end_ms: l.end_ms, text: l.text }))),
            )
          }
        >
          下载 SRT
        </button>
        <button
          onClick={() => downloadText(`${env.task_id}.txt`, r.transcript.map((l) => `${nameOf(l.speaker)}: ${l.text}`).join("\n"))}
        >
          下载全文
        </button>
        <button onClick={() => { onWarehouse(); }}>回传数仓</button>
      </div>
    </div>
  );
}
