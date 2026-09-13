import { useRef } from "react";
import { Download } from "lucide-react";
import type { AudioResult, TaskEnvelope } from "../../lib/media";
import { toSrt } from "../../lib/media";
import { download } from "../../lib/engine";
import { Empty } from "../UI";

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function AudioResultView({
  env,
  running,
  previewUrl,
  onEditTldr,
}: {
  env: TaskEnvelope<AudioResult> | null;
  running: boolean;
  previewUrl: string | null;
  onEditTldr: (tldr: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seek = (ms: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = ms / 1000;
      audioRef.current.play().catch(() => {});
    }
  };

  if (running) {
    return (
      <div className="media-result">
        {previewUrl && (
          <div className="media-preview">
            <audio ref={audioRef} src={previewUrl} controls />
          </div>
        )}
        <div className="media-skeleton" style={{ width: "50%" }} />
        <div className="media-skeleton" />
        <div className="media-skeleton" style={{ width: "70%" }} />
      </div>
    );
  }

  if (!env) {
    return (
      <Empty
        title="尚无清洗结果"
        description="上传音频并提交清洗后，分说话人、带时间戳的全文与结构化摘要会展示在这里。"
      />
    );
  }

  const r = env.result;
  const nameOf = (id: string) => r.speakers.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="media-result">
      {previewUrl && (
        <div className="media-preview">
          <audio ref={audioRef} src={previewUrl} controls />
        </div>
      )}

      <div className="media-subhead">
        摘要（可编辑）
        {env.human_edited && <span className="media-edited-flag">已人工修正</span>}
      </div>
      <textarea
        className="media-tldr-input"
        value={r.summary.tldr}
        aria-label="摘要"
        rows={2}
        onChange={(e) => onEditTldr(e.target.value)}
      />

      <div className="media-subhead">要点（点击跳转音频）</div>
      <ul className="media-list">
        {r.summary.key_points.map((k, i) => (
          <li key={i} onClick={() => seek(k.evidence_ms)}>
            {k.text} <span className="media-muted">· {mmss(k.evidence_ms)}</span>
          </li>
        ))}
      </ul>

      {r.summary.todos.length > 0 && (
        <>
          <div className="media-subhead">待办</div>
          <ul className="media-list media-list-plain">
            {r.summary.todos.map((t, i) => (
              <li key={i}>
                {t.text}
                {t.owner ? `（${t.owner}）` : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="media-subhead">全文（分说话人 · 带时间戳）</div>
      <div className="media-transcript">
        {r.transcript.map((l, i) => (
          <div key={i} className="media-line" onClick={() => seek(l.start_ms)}>
            <div className="media-line-meta">
              <span className="media-line-time">{mmss(l.start_ms)}</span>
              <span className="media-line-speaker">{nameOf(l.speaker)}</span>
            </div>
            <div>{l.text}</div>
          </div>
        ))}
      </div>

      <div className="media-export-bar">
        <button className="button" onClick={() => download(`${env.task_id}.json`, JSON.stringify(env, null, 2), "application/json")}>
          <Download size={15} />
          下载 JSON
        </button>
        <button
          className="button"
          onClick={() =>
            download(
              `${env.task_id}.srt`,
              toSrt(r.transcript.map((l) => ({ start_ms: l.start_ms, end_ms: l.end_ms, text: l.text }))),
              "text/plain",
            )
          }
        >
          <Download size={15} />
          下载 SRT
        </button>
        <button
          className="button"
          onClick={() =>
            download(
              `${env.task_id}.txt`,
              r.transcript.map((l) => `${nameOf(l.speaker)}: ${l.text}`).join("\n"),
              "text/plain",
            )
          }
        >
          <Download size={15} />
          下载全文
        </button>
      </div>
    </div>
  );
}
