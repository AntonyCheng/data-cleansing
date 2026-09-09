import { useEffect, useMemo, useRef, useState } from "react";
import { openTaskStream, peekTask, startTask } from "./api";
import { track } from "./telemetry";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { TypeMenu } from "./components/TypeMenu";
import { UploadPanel } from "./components/UploadPanel";
import { AudioResultView } from "./components/results/AudioResultView";
import { ImageResultView } from "./components/results/ImageResultView";
import { VideoResultView } from "./components/results/VideoResultView";
import { addHistory, type HistoryItem, listHistory } from "./history";
import type {
  AudioResult,
  FrameEvent,
  ImageField,
  ImageResult,
  JobStatus,
  Subtitle,
  TaskEnvelope,
  TaskStreamMsg,
  TaskType,
  VideoResult,
} from "./types";

type ImgEnv = TaskEnvelope<ImageResult>;
type AudEnv = TaskEnvelope<AudioResult>;
type Phase = "idle" | "uploading" | "cleaning" | "done" | "error";

const ALL_TYPES: TaskType[] = ["image", "audio", "video"];

/** 从任意类型的完整 envelope 里抠出一句话摘要，给历史列表用 */
function summaryTextOf(env: TaskEnvelope): string {
  if (env.type === "image") return (env.result as ImageResult).summary;
  if (env.type === "audio") return (env.result as AudioResult).summary.tldr;
  return (env.result as VideoResult).summary;
}

export function App() {
  const [type, setType] = useState<TaskType>("image");

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [viewingHistory, setViewingHistory] = useState(false);

  const [imgEnv, setImgEnv] = useState<ImgEnv | null>(null);
  const [audEnv, setAudEnv] = useState<AudEnv | null>(null);
  // 当前接上的任务（不管是历史回看还是后台任务槽）对应的原始素材地址，与本地刚选的 objectUrl 互斥
  const [attachedMediaUrl, setAttachedMediaUrl] = useState<string | null>(null);

  // 视频"边播边析"实时状态（回放历史消息 / 实时推送用的是同一套 apply 逻辑）
  const [subs, setSubs] = useState<Subtitle[]>([]);
  const [events, setEvents] = useState<FrameEvent[]>([]);
  const [vSummary, setVSummary] = useState<VideoResult | null>(null);
  const [frameIntervalMs, setFrameIntervalMs] = useState(3000);
  const wsRef = useRef<WebSocket | null>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const lastFilename = useRef<string>("");
  // 当前任务流里最新一条 result 消息（完整 envelope），done 到达时拿它存历史
  const pendingEnvelope = useRef<TaskEnvelope | null>(null);

  // 哪些类型后台还有任务在跑（不含当前正在看的那个），驱动左侧菜单的小红点
  const [runningTypes, setRunningTypes] = useState<Set<TaskType>>(new Set());

  // 会话历史
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);
  // 当前上传的临时预览优先；否则用任务槽/历史记录里落盘的原始素材
  const previewUrl = objectUrl ?? attachedMediaUrl;

  function saveToHistory(env: TaskEnvelope, filename: string, summary: string) {
    lastFilename.current = filename;
    setHistory(addHistory(env, filename, summary));
  }

  /** 清空当前展示态（不影响服务端任务槽本身——它该怎么跑还怎么跑） */
  function clearView() {
    wsRef.current?.close();
    wsRef.current = null;
    pendingEnvelope.current = null;
    setImgEnv(null);
    setAudEnv(null);
    setAttachedMediaUrl(null);
    setSubs([]);
    setEvents([]);
    setVSummary(null);
    setError(null);
    setViewingHistory(false);
  }

  /** 接上某类型的任务流：先回放它已有的进度，任务还在跑的话继续实时收新消息。
   *  首次挂载、切换类型、刚提交完任务，都走这一条路——效果上就是"随时查看当前进度"。 */
  function attachToType(t: TaskType) {
    clearView();
    setPhase("idle");
    const ws = openTaskStream(t);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as TaskStreamMsg;
      if (msg.kind === "no_job") {
        setPhase("idle");
      } else if (msg.kind === "status") {
        lastFilename.current = msg.data.filename;
        if (msg.data.media_url) setAttachedMediaUrl(msg.data.media_url);
        setPhase(msg.data.status === "running" ? "cleaning" : msg.data.status === "error" ? "error" : "done");
      } else if (msg.kind === "result") {
        pendingEnvelope.current = msg.data;
        setAttachedMediaUrl(msg.data.source.media_url ?? null);
        if (t === "image") setImgEnv(msg.data as ImgEnv);
        else if (t === "audio") setAudEnv(msg.data as AudEnv);
      } else if (msg.kind === "subtitle") {
        setSubs((s) => [...s, msg.data]);
      } else if (msg.kind === "frame_event") {
        setEvents((e) => [...e, msg.data]);
      } else if (msg.kind === "summary") {
        setVSummary((v) => ({ subtitles: v?.subtitles ?? [], frame_events: v?.frame_events ?? [], ...msg.data }));
      } else if (msg.kind === "error") {
        setError(msg.data.message);
        setPhase("error");
      } else if (msg.kind === "done") {
        setPhase("done");
        track("task_success", { type: t });
        if (pendingEnvelope.current) {
          saveToHistory(pendingEnvelope.current, pendingEnvelope.current.source.filename, summaryTextOf(pendingEnvelope.current));
        }
      }
      // kind === "cost"：界面不展示调用成本，忽略
    };
    ws.onerror = () => setError("与服务端的实时连接异常");
    ws.onclose = () => { wsRef.current = null; };
  }

  useEffect(() => {
    setHistory(listHistory());
    attachToType(type); // 页面一打开就接上默认类型，重开浏览器也能看到上次留下的进度/结果
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 左侧菜单小红点：轻量轮询三个类型的后台状态，不影响当前正在看的那个类型
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const results = await Promise.all(
        ALL_TYPES.map((t) => peekTask(t).catch((): { hasJob: boolean; status?: JobStatus } => ({ hasJob: false }))),
      );
      if (cancelled) return;
      const next = new Set<TaskType>();
      ALL_TYPES.forEach((t, i) => { if (results[i].status === "running") next.add(t); });
      setRunningTypes(next);
    }
    void poll();
    const timer = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  function switchType(t: TaskType) {
    if (t === type) return;
    setType(t);
    setFile(null);
    attachToType(t);
  }

  function pickFile(f: File) {
    clearView();
    setPhase("idle");
    setFile(f);
  }

  async function runClean() {
    if (!file) return;
    setError(null);
    setPhase("uploading");
    track("task_start", { type, size: file.size });
    try {
      await startTask(type, file, type === "video" ? { frameIntervalMs } : undefined);
      attachToType(type); // 提交成功后立刻接上，从头看着它跑
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  function seekVideo(ms: number) {
    if (videoElRef.current) videoElRef.current.currentTime = ms / 1000;
  }

  // ---- 结果人工修正（同步回历史）----
  function editImageFields(fields: ImageField[]) {
    setImgEnv((e) => {
      if (!e) return e;
      const next = { ...e, human_edited: true, result: { ...e.result, fields } };
      if (!viewingHistory) setHistory(addHistory(next, lastFilename.current, next.result.summary));
      track("field_edit", { type: "image" });
      return next;
    });
  }
  function editAudioSummary(tldr: string) {
    setAudEnv((e) => {
      if (!e) return e;
      const next = { ...e, human_edited: true, result: { ...e.result, summary: { ...e.result.summary, tldr } } };
      if (!viewingHistory) setHistory(addHistory(next, lastFilename.current, tldr));
      return next;
    });
  }

  // ---- 历史回看：纯本地静态快照，与任务槽无关，先断开当前任务流的连接 ----
  function openHistoryItem(item: HistoryItem) {
    setHistoryOpen(false);
    clearView();
    setFile(null);
    setViewingHistory(true);
    setType(item.type);
    setPhase("done");
    setAttachedMediaUrl(item.envelope.source.media_url ?? null);
    if (item.type === "image") setImgEnv(item.envelope as ImgEnv);
    else if (item.type === "audio") setAudEnv(item.envelope as AudEnv);
    else {
      const r = item.envelope.result as VideoResult;
      setSubs(r.subtitles ?? []);
      setEvents(r.frame_events ?? []);
      setVSummary(r);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">
          <span className="brand-tile" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
              <path d="m6.08 9.16-3.5 1.6a1 1 0 0 0 0 1.81l8.58 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.81l-3.5-1.6" />
              <path d="m6.08 14.16-3.5 1.6a1 1 0 0 0 0 1.81l8.58 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59" />
            </svg>
          </span>
          <span className="brand-text"><b>多模态</b>数据清洗台</span>
        </span>
        <div className="spacer" />
        <button
          className="chip chip-btn"
          onClick={() => { setHistoryOpen(true); track("history_open", { count: history.length }); }}
        >
          历史 {history.length > 0 ? `· ${history.length}` : ""}
        </button>
      </header>

      <div className="body">
        <TypeMenu active={type} running={runningTypes} onChange={switchType} />

        <div className="work">
          <section className="panel upload">
            <h2>上传 · 确认清洗</h2>
            <UploadPanel
              type={type}
              file={file}
              phase={phase}
              error={error}
              frameIntervalMs={frameIntervalMs}
              onFrameIntervalChange={(ms) => { setFrameIntervalMs(ms); track("frame_interval_change", { ms }); }}
              onPick={pickFile}
              onClear={() => { setFile(null); setPhase("idle"); }}
              onClean={runClean}
            />
          </section>

          <section className="panel result">
            <h2>
              清洗结果
              {viewingHistory && <span className="badge-view">历史回看</span>}
            </h2>
            {type === "image" && (
              <ImageResultView
                env={imgEnv}
                phase={phase}
                previewUrl={previewUrl}
                onEditFields={editImageFields}
              />
            )}
            {type === "audio" && (
              <AudioResultView
                env={audEnv}
                phase={phase}
                previewUrl={previewUrl}
                onEditTldr={editAudioSummary}
              />
            )}
            {type === "video" && (
              <VideoResultView
                previewUrl={previewUrl}
                videoRef={videoElRef}
                subtitles={subs}
                events={events}
                summary={vSummary}
                phase={phase}
                onSeek={seekVideo}
              />
            )}
          </section>
        </div>
      </div>

      <HistoryDrawer
        open={historyOpen}
        items={history}
        onClose={() => setHistoryOpen(false)}
        onOpenItem={openHistoryItem}
        onCleared={() => setHistory([])}
        onItemDeleted={setHistory}
      />
    </div>
  );
}
