import { useEffect, useRef, useState, type RefObject } from "react";
import type { FrameEvent, Subtitle, VideoResult } from "../../types";
import { track } from "../../telemetry";
import { copyJson, downloadJson, downloadText, toSrt } from "../export";

type Phase = "idle" | "uploading" | "cleaning" | "done" | "error";

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function VideoResultView({
  previewUrl,
  videoRef,
  subtitles,
  events,
  summary,
  phase,
  onSeek,
  onWarehouse,
}: {
  previewUrl: string | null;
  videoRef: RefObject<HTMLVideoElement>;
  subtitles: Subtitle[];
  events: FrameEvent[];
  summary: VideoResult | null;
  phase: Phase;
  onSeek: (ms: number) => void;
  onWarehouse: (envelope: unknown) => void;
}) {
  const [currentMs, setCurrentMs] = useState(0);
  const [ended, setEnded] = useState(false);
  const [followPlayback, setFollowPlayback] = useState(true);
  const subBoxRef = useRef<HTMLDivElement>(null);

  // 跟随播放进度
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentMs(v.currentTime * 1000);
    const onEnd = () => setEnded(true);
    const onPlay = () => setEnded(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnd);
    v.addEventListener("play", onPlay);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onEnd);
      v.removeEventListener("play", onPlay);
    };
  }, [videoRef, previewUrl]);

  // 跟随播放：只显示已播到的字幕（预留 0.4s 提前量）；无视频 / 关闭跟随 / 已播完 → 全部
  const syncing = Boolean(previewUrl) && followPlayback && !ended;
  const shownSubs = syncing ? subtitles.filter((s) => s.start_ms <= currentMs + 400) : subtitles;
  const shownEvents = syncing ? events.filter((e) => e.t_ms <= currentMs + 400) : events;

  useEffect(() => {
    if (syncing && subBoxRef.current) subBoxRef.current.scrollTop = subBoxRef.current.scrollHeight;
  }, [shownSubs.length, syncing]);

  const hasData = subtitles.length > 0 || events.length > 0 || summary != null;
  if (!previewUrl && !hasData) {
    return <div className="empty">上传视频并点击「确认清洗 · 开始播放」。<br />播放的同时：左侧实时字幕，右侧实时画面事件；播放结束生成整片章节与摘要。</div>;
  }

  const streaming = phase === "cleaning";
  const currentEnvelope = {
    subtitles,
    frame_events: events,
    chapters: summary?.chapters ?? [],
    summary: summary?.summary ?? "",
    tags: summary?.tags ?? [],
    entities: summary?.entities ?? { objects: [], scenes: [] },
  };

  return (
    <div>
      {previewUrl ? (
        <div className="preview">
          <video ref={videoRef} src={previewUrl} controls />
        </div>
      ) : (
        <div className="cf" style={{ marginBottom: 12 }}>历史回看 · 原视频未保存，可跳转的时间轴不可用</div>
      )}

      {streaming && (
        <div className="subhead"><span className="live-dot" />实时分析中…</div>
      )}

      <div className="subhead">
        字幕
        {previewUrl && (
          <label className="follow-toggle">
            <input type="checkbox" checked={followPlayback} onChange={(e) => setFollowPlayback(e.target.checked)} />
            跟随播放
          </label>
        )}
      </div>
      <div className="transcript" ref={subBoxRef} style={{ maxHeight: 200, overflowY: "auto" }}>
        {subtitles.length === 0 && <div className="cf">等待字幕…</div>}
        {subtitles.length > 0 && shownSubs.length === 0 && <div className="cf">字幕将随播放逐句出现…</div>}
        {shownSubs.map((s, i) => (
          <div
            key={i}
            className={`line${syncing && i === shownSubs.length - 1 ? " line-current" : ""}`}
            onClick={() => onSeek(s.start_ms)}
          >
            <div className="t">{mmss(s.start_ms)}</div>
            <div>{s.text}</div>
          </div>
        ))}
      </div>

      <div className="subhead">画面事件 · 抽帧理解</div>
      {events.length === 0 && <div className="cf">等待画面事件…</div>}
      {shownEvents.map((e, i) => (
        <div key={i} className="event-card" onClick={() => onSeek(e.t_ms)}>
          <div className="et">{mmss(e.t_ms)}{e.scene_change ? " · 镜头切换" : ""}</div>
          <div className="event-body">
            {e.thumb_url && <img className="event-thumb" src={e.thumb_url} alt={`帧 ${mmss(e.t_ms)}`} />}
            <div>
              <div className="ec">{e.caption}</div>
              <div className="tags">{e.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
            </div>
          </div>
        </div>
      ))}

      {summary && (
        <>
          <div className="subhead">整片摘要</div>
          <p style={{ margin: "0 0 8px" }}>{summary.summary}</p>
          <div className="tags">{summary.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
          <div className="subhead">章节</div>
          <div className="fields">
            {summary.chapters.map((c, i) => (
              <div key={i} className="field-row" style={{ cursor: "pointer" }} onClick={() => onSeek(c.start_ms)}>
                <span className="k">{mmss(c.start_ms)}</span>
                <span className="v">{c.title} — {c.summary}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="export-bar">
        <button onClick={() => { copyJson(currentEnvelope); track("export", { via: "copy", type: "video" }); }}>复制 JSON</button>
        <button onClick={() => { downloadJson("video-result.json", currentEnvelope); track("export", { via: "download", type: "video" }); }}>下载 JSON</button>
        <button
          disabled={subtitles.length === 0}
          onClick={() => downloadText("subtitles.srt", toSrt(subtitles))}
        >
          下载字幕 SRT
        </button>
        <button disabled={!summary} onClick={() => onWarehouse(currentEnvelope)}>回传数仓</button>
      </div>
    </div>
  );
}
