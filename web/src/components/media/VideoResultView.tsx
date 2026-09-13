import { useEffect, useRef, useState, type RefObject } from "react";
import { Download } from "lucide-react";
import type { FrameEvent, Subtitle, VideoResult } from "../../lib/media";
import { toSrt } from "../../lib/media";
import { download } from "../../lib/engine";
import { usePacedReveal } from "../../hooks/usePacedReveal";
import { Empty } from "../UI";

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function VideoResultView({
  previewUrl,
  videoRef,
  subtitles,
  events,
  summary,
  running,
  onSeek,
}: {
  previewUrl: string | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  subtitles: Subtitle[];
  events: FrameEvent[];
  summary: VideoResult | null;
  running: boolean;
  onSeek: (ms: number) => void;
}) {
  const [currentMs, setCurrentMs] = useState(0);
  const [ended, setEnded] = useState(false);
  const [followPlayback, setFollowPlayback] = useState(true);
  const subBoxRef = useRef<HTMLDivElement>(null);

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

  const syncing = Boolean(previewUrl) && followPlayback && !ended;
  const eligibleSubs = syncing ? subtitles.filter((s) => s.start_ms <= currentMs + 400) : subtitles;
  const eligibleEvents = syncing ? events.filter((e) => e.t_ms <= currentMs + 400) : events;
  const shownSubs = usePacedReveal(eligibleSubs, 380, syncing);
  const shownEvents = usePacedReveal(eligibleEvents, 450, syncing);

  useEffect(() => {
    if (syncing && subBoxRef.current) subBoxRef.current.scrollTop = subBoxRef.current.scrollHeight;
  }, [shownSubs.length, syncing]);

  const hasData = subtitles.length > 0 || events.length > 0 || summary != null;
  if (!previewUrl && !hasData) {
    return (
      <Empty
        title="尚无清洗结果"
        description="上传视频并提交清洗后：播放同时实时字幕、画面事件逐条出现，播放结束生成整片章节与摘要。"
      />
    );
  }

  const currentEnvelope = {
    subtitles,
    frame_events: events,
    chapters: summary?.chapters ?? [],
    summary: summary?.summary ?? "",
    tags: summary?.tags ?? [],
    entities: summary?.entities ?? { objects: [], scenes: [] },
  };

  return (
    <div className="media-result">
      {previewUrl ? (
        <div className="media-preview">
          <video ref={videoRef} src={previewUrl} controls />
        </div>
      ) : (
        <div className="media-muted media-note">历史任务 · 原视频未保存，时间轴跳转不可用</div>
      )}

      {running && (
        <div className="media-subhead">
          <span className="media-live-dot" />
          实时分析中…
        </div>
      )}

      {(subtitles.length > 0 || running) && (
        <>
          <div className="media-subhead">
            字幕
            {previewUrl && (
              <label className="media-follow-toggle">
                <input type="checkbox" checked={followPlayback} onChange={(e) => setFollowPlayback(e.target.checked)} />
                跟随播放
              </label>
            )}
          </div>
          <div className="media-transcript media-transcript-scroll" ref={subBoxRef}>
            {subtitles.length === 0 && running && <div className="media-muted">检测人声中…</div>}
            {subtitles.length > 0 && shownSubs.length === 0 && <div className="media-muted">字幕将随播放逐句出现…</div>}
            {shownSubs.map((s, i) => (
              <div
                key={i}
                className={`media-line${syncing && i === shownSubs.length - 1 ? " current" : ""}`}
                onClick={() => onSeek(s.start_ms)}
              >
                <div className="media-line-meta">
                  <span className="media-line-time">{mmss(s.start_ms)}</span>
                </div>
                <div>{s.text}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="media-subhead">画面事件 · 抽帧理解</div>
      {events.length === 0 && <div className="media-muted">等待画面事件…</div>}
      {shownEvents.map((e, i) => (
        <div key={i} className="media-event" onClick={() => onSeek(e.t_ms)}>
          <div className="media-event-time">
            {mmss(e.t_ms)}
            {e.scene_change ? " · 镜头切换" : ""}
          </div>
          <div className="media-event-body">
            {e.thumb_url && <img className="media-event-thumb" src={e.thumb_url} alt={`帧 ${mmss(e.t_ms)}`} />}
            <div>
              <div className="media-event-caption">{e.caption}</div>
              <div className="media-tags">
                {e.tags.map((t) => (
                  <span key={t} className="media-tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}

      {summary && (
        <>
          <div className="media-subhead">整片摘要</div>
          <p className="media-summary">{summary.summary}</p>
          <div className="media-tags">
            {summary.tags.map((t) => (
              <span key={t} className="media-tag">
                {t}
              </span>
            ))}
          </div>
          <div className="media-subhead">章节</div>
          <div className="media-fields">
            {summary.chapters.map((c, i) => (
              <div key={i} className="media-field-row media-clickable" onClick={() => onSeek(c.start_ms)}>
                <span className="k">{mmss(c.start_ms)}</span>
                <span className="v">
                  {c.title} — {c.summary}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="media-export-bar">
        <button className="button" onClick={() => download("video-result.json", JSON.stringify(currentEnvelope, null, 2), "application/json")}>
          <Download size={15} />
          下载 JSON
        </button>
        <button
          className="button"
          disabled={subtitles.length === 0}
          onClick={() => download("subtitles.srt", toSrt(subtitles), "text/plain")}
        >
          <Download size={15} />
          下载字幕 SRT
        </button>
      </div>
    </div>
  );
}
