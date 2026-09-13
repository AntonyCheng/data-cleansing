import { useEffect, useRef, useState } from "react";
import { AudioLines, Film, Image as ImageIcon, Menu, ArrowLeft } from "lucide-react";
import type { MediaTask } from "../lib/types";
import {
  openMediaTaskStream,
  trimEnvelopeForStorage,
  MEDIA_KIND_LABEL,
  type AudioResult,
  type FrameEvent,
  type ImageField,
  type ImageResult,
  type Subtitle,
  type TaskEnvelope,
  type TaskStreamMsg,
  type VideoResult,
} from "../lib/media";
import { Badge, Notice, formatTime } from "../components/UI";
import ImageResultView from "../components/media/ImageResultView";
import AudioResultView from "../components/media/AudioResultView";
import VideoResultView from "../components/media/VideoResultView";

const KIND_ICON = { image: ImageIcon, audio: AudioLines, video: Film } as const;

function initialPhase(task: MediaTask): "running" | "done" | "error" {
  if (task.status === "running") return "running";
  if (task.status === "failed") return "error";
  return "done";
}

export default function MediaWorkbench({
  task,
  onUpdate,
  onBack,
  onOpenNav,
}: {
  task: MediaTask;
  onUpdate: (task: MediaTask) => void;
  onBack: () => void;
  onOpenNav: () => void;
}) {
  const [phase, setPhase] = useState<"running" | "done" | "error">(initialPhase(task));
  const [error, setError] = useState<string | null>(task.error ?? null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(task.mediaUrl ?? task.envelope?.source.media_url ?? null);

  const [imgEnv, setImgEnv] = useState<TaskEnvelope<ImageResult> | null>(
    task.kind === "image" && task.envelope ? (task.envelope as TaskEnvelope<ImageResult>) : null,
  );
  const [audEnv, setAudEnv] = useState<TaskEnvelope<AudioResult> | null>(
    task.kind === "audio" && task.envelope ? (task.envelope as TaskEnvelope<AudioResult>) : null,
  );
  const videoResult = task.kind === "video" ? (task.envelope?.result as VideoResult | undefined) : undefined;
  const [subs, setSubs] = useState<Subtitle[]>(videoResult?.subtitles ?? []);
  const [events, setEvents] = useState<FrameEvent[]>(videoResult?.frame_events ?? []);
  const [vSummary, setVSummary] = useState<VideoResult | null>(
    task.kind === "video" && videoResult ? videoResult : null,
  );
  const videoElRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (task.status !== "running") return;
    const ws = openMediaTaskStream(task.kind);
    let pendingEnvelope: TaskEnvelope | null = null;

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as TaskStreamMsg;
      if (msg.kind === "no_job") {
        setError("任务已不在服务端队列中，可能服务重启后丢失，请重新提交。");
        setPhase("error");
        onUpdate({ ...task, status: "failed", error: "任务已丢失", updatedAt: new Date().toISOString() });
      } else if (msg.kind === "status") {
        if (msg.data.media_url) setMediaUrl(msg.data.media_url);
      } else if (msg.kind === "result") {
        pendingEnvelope = msg.data;
        if (msg.data.source.media_url) setMediaUrl(msg.data.source.media_url);
        if (task.kind === "image") setImgEnv(msg.data as TaskEnvelope<ImageResult>);
        else if (task.kind === "audio") setAudEnv(msg.data as TaskEnvelope<AudioResult>);
      } else if (msg.kind === "subtitle") {
        setSubs((s) => [...s, msg.data]);
      } else if (msg.kind === "frame_event") {
        setEvents((e) => [...e, msg.data]);
      } else if (msg.kind === "summary") {
        setVSummary((v) => ({ subtitles: v?.subtitles ?? [], frame_events: v?.frame_events ?? [], ...msg.data }));
      } else if (msg.kind === "error") {
        setError(msg.data.message);
        setPhase("error");
        onUpdate({ ...task, status: "failed", error: msg.data.message, updatedAt: new Date().toISOString() });
      } else if (msg.kind === "done") {
        setPhase("done");
        if (pendingEnvelope) {
          onUpdate({
            ...task,
            status: "succeeded",
            mediaUrl: pendingEnvelope.source.media_url ?? task.mediaUrl,
            envelope: trimEnvelopeForStorage(pendingEnvelope),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    };
    ws.onerror = () => setError("与服务端的实时连接异常");
    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  function seekVideo(ms: number) {
    if (videoElRef.current) videoElRef.current.currentTime = ms / 1000;
  }
  function editImageFields(fields: ImageField[]) {
    setImgEnv((e) => {
      if (!e) return e;
      const next = { ...e, human_edited: true, result: { ...e.result, fields } };
      onUpdate({ ...task, status: "succeeded", envelope: trimEnvelopeForStorage(next), updatedAt: new Date().toISOString() });
      return next;
    });
  }
  function editAudioSummary(tldr: string) {
    setAudEnv((e) => {
      if (!e) return e;
      const next = { ...e, human_edited: true, result: { ...e.result, summary: { ...e.result.summary, tldr } } };
      onUpdate({ ...task, status: "succeeded", envelope: trimEnvelopeForStorage(next), updatedAt: new Date().toISOString() });
      return next;
    });
  }

  const Icon = KIND_ICON[task.kind];

  return (
    <div className="workbench-page media-workbench">
      <div className="workbench-heading">
        <div className="workbench-heading-title">
          <button className="icon-button workbench-nav-toggle" aria-label="打开导航" onClick={onOpenNav}>
            <Menu size={20} />
          </button>
          <button className="icon-button" aria-label="返回数据任务" onClick={onBack}>
            <ArrowLeft size={19} />
          </button>
          <span className="document-icon">
            <Icon size={23} />
          </span>
          <div>
            <div>
              <h1 title={task.name}>{task.name}</h1>
              <Badge tone={phase === "done" ? "green" : phase === "error" ? "red" : "blue"}>
                {phase === "running" ? "处理中" : phase === "error" ? "处理失败" : "已完成"}
              </Badge>
            </div>
            <p className="workbench-meta">
              <span className="task-source" title={task.filename}>
                {MEDIA_KIND_LABEL[task.kind]} · {task.filename}
              </span>
              <span>·</span>
              <span>最近更新 {formatTime(task.updatedAt)}</span>
            </p>
          </div>
        </div>
      </div>

      <section className="card media-workbench-body">
        {error && phase === "error" && (
          <Notice warning>
            {error}
            <div className="media-error-actions">
              <button className="button" onClick={onBack}>
                返回数据任务重新提交
              </button>
            </div>
          </Notice>
        )}
        {task.kind === "image" && (
          <ImageResultView env={imgEnv} running={phase === "running" && !imgEnv} previewUrl={mediaUrl} onEditFields={editImageFields} />
        )}
        {task.kind === "audio" && (
          <AudioResultView env={audEnv} running={phase === "running" && !audEnv} previewUrl={mediaUrl} onEditTldr={editAudioSummary} />
        )}
        {task.kind === "video" && (
          <VideoResultView
            previewUrl={mediaUrl}
            videoRef={videoElRef}
            subtitles={subs}
            events={events}
            summary={vSummary}
            running={phase === "running"}
            onSeek={seekVideo}
          />
        )}
      </section>
    </div>
  );
}
