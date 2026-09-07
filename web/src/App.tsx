import { useEffect, useMemo, useRef, useState } from "react";
import { cleanAudio, cleanImage, exportToWarehouse, getHealth, openVideoStream, uploadVideo } from "./api";
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
  Subtitle,
  TaskEnvelope,
  TaskType,
  VideoResult,
  VideoStreamMsg,
} from "./types";

type ImgEnv = TaskEnvelope<ImageResult>;
type AudEnv = TaskEnvelope<AudioResult>;
type Phase = "idle" | "uploading" | "cleaning" | "done" | "error";

export function App() {
  const [type, setType] = useState<TaskType>("image");
  const [health, setHealth] = useState<{ mode: string } | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [viewingHistory, setViewingHistory] = useState(false);

  const [imgEnv, setImgEnv] = useState<ImgEnv | null>(null);
  const [audEnv, setAudEnv] = useState<AudEnv | null>(null);

  // 视频"边播边析"实时状态
  const [subs, setSubs] = useState<Subtitle[]>([]);
  const [events, setEvents] = useState<FrameEvent[]>([]);
  const [vSummary, setVSummary] = useState<VideoResult | null>(null);
  const [frameIntervalMs, setFrameIntervalMs] = useState(3000);
  const wsRef = useRef<WebSocket | null>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const lastFilename = useRef<string>("");

  // 会话费用 + 历史
  const [sessionCost, setSessionCost] = useState(0);
  const [sessionCalls, setSessionCalls] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [warehouseMsg, setWarehouseMsg] = useState<string | null>(null);

  async function sendToWarehouse(envelope: unknown) {
    setWarehouseMsg("回传中…");
    try {
      await exportToWarehouse(envelope);
      setWarehouseMsg("已回传数仓");
      track("export", { via: "warehouse", type });
    } catch (e) {
      setWarehouseMsg(`回传失败：${e instanceof Error ? e.message : String(e)}`);
    }
    setTimeout(() => setWarehouseMsg(null), 4000);
  }

  useEffect(() => {
    getHealth().then((h) => setHealth(h)).catch(() => setHealth({ mode: "unknown" }));
    setHistory(listHistory());
  }, []);

  const objectUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  function resetResults() {
    setImgEnv(null);
    setAudEnv(null);
    setSubs([]);
    setEvents([]);
    setVSummary(null);
    setError(null);
    setPhase("idle");
    setViewingHistory(false);
    wsRef.current?.close();
    wsRef.current = null;
  }

  function switchType(t: TaskType) {
    if (t === type) return;
    const hasResult = imgEnv || audEnv || vSummary || subs.length;
    if (hasResult && !viewingHistory && !window.confirm("当前结果尚未导出，切换类型将清空，确定？")) return;
    setType(t);
    setFile(null);
    resetResults();
  }

  function pickFile(f: File) {
    resetResults();
    setFile(f);
  }

  function recordSpend(cny: number, calls: number) {
    setSessionCost((c) => c + cny);
    setSessionCalls((n) => n + calls);
  }

  function saveToHistory(env: TaskEnvelope, filename: string, summary: string) {
    lastFilename.current = filename;
    setHistory(addHistory(env, filename, summary));
  }

  async function runClean() {
    if (!file) return;
    setError(null);
    setViewingHistory(false);
    const t0 = Date.now();
    track("task_start", { type, size: file.size });
    try {
      setPhase("cleaning");
      if (type === "image") {
        const env = await cleanImage(file);
        setImgEnv(env);
        recordSpend(env.cost_estimate_cny, env.cost_calls?.length ?? 1);
        saveToHistory(env, file.name, env.result.summary);
        setPhase("done");
        track("task_success", { type, ms: Date.now() - t0, cny: env.cost_estimate_cny, layout: env.result.layout });
      } else if (type === "audio") {
        const env = await cleanAudio(file);
        setAudEnv(env);
        recordSpend(env.cost_estimate_cny, env.cost_calls?.length ?? 1);
        saveToHistory(env, file.name, env.result.summary.tldr);
        setPhase("done");
        track("task_success", { type, ms: Date.now() - t0, cny: env.cost_estimate_cny, lines: env.result.transcript.length });
      } else {
        const { id } = await uploadVideo(file);
        startVideoStream(id, file.name, t0);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setPhase("error");
      track("task_fail", { type, ms: Date.now() - t0, message: message.slice(0, 120) });
    }
  }

  function startVideoStream(id: string, filename: string, t0: number) {
    setSubs([]);
    setEvents([]);
    setVSummary(null);
    const collectedSubs: Subtitle[] = [];
    const collectedEvents: FrameEvent[] = [];
    let summaryData: Pick<VideoResult, "chapters" | "summary" | "tags" | "entities"> | null = null;

    const ws = openVideoStream(id, frameIntervalMs);
    wsRef.current = ws;
    ws.onopen = () => videoElRef.current?.play().catch(() => {});
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as VideoStreamMsg;
      if (msg.kind === "subtitle") {
        collectedSubs.push(msg.data);
        setSubs((s) => [...s, msg.data]);
      } else if (msg.kind === "frame_event") {
        collectedEvents.push(msg.data);
        setEvents((e) => [...e, msg.data]);
      } else if (msg.kind === "summary") {
        summaryData = msg.data;
        setVSummary({ subtitles: [], frame_events: [], ...msg.data });
      } else if (msg.kind === "cost") {
        recordSpend(msg.data.cny, msg.data.calls.length);
      } else if (msg.kind === "error") {
        setError(msg.data.message);
        setPhase("error");
      } else if (msg.kind === "done") {
        setPhase("done");
        track("task_success", {
          type: "video",
          ms: Date.now() - t0,
          frames: collectedEvents.length,
          subs: collectedSubs.length,
        });
        if (summaryData) {
          const env: TaskEnvelope<VideoResult> = {
            task_id: `tsk_video_${id.slice(0, 8)}`,
            type: "video",
            source: { filename, tos_url: "", duration_ms: 0 },
            provider: { vendor: "volcengine", apis: ["ark.doubao-vision", "speech.seedasr.auc"] },
            status: "succeeded",
            cost_estimate_cny: 0,
            created_at: new Date().toISOString(),
            human_edited: false,
            result: {
              subtitles: collectedSubs,
              frame_events: collectedEvents,
              ...summaryData,
            },
          };
          saveToHistory(env, filename, summaryData.summary);
        }
      }
    };
    ws.onerror = () => { setError("实时分析连接异常"); setPhase("error"); };
    ws.onclose = () => {
      wsRef.current = null;
      setPhase((p) => (p === "cleaning" ? "done" : p));
    };
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

  // ---- 历史回看 ----
  function openHistoryItem(item: HistoryItem) {
    setHistoryOpen(false);
    setFile(null);
    resetResults();
    setViewingHistory(true);
    setType(item.type);
    setPhase("done");
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
          <b>多模态</b> 数据清洗台
        </span>
        <div className="spacer" />
        <span className="chip" title="本会话预估调用费用（以火山计费为准）">
          ¥{sessionCost.toFixed(3)} · {sessionCalls} 次
        </span>
        {warehouseMsg && <span className="chip mode-live">{warehouseMsg}</span>}
        <button
          className="chip chip-btn"
          onClick={() => { setHistoryOpen(true); track("history_open", { count: history.length }); }}
        >
          历史 {history.length > 0 ? `· ${history.length}` : ""}
        </button>
        {health && (
          <span className={`chip mode-${health.mode}`}>
            {health.mode === "mock" ? "MOCK 样例模式" : health.mode === "live" ? "LIVE 火山引擎" : health.mode}
          </span>
        )}
      </header>

      <div className="body">
        <TypeMenu active={type} onChange={switchType} />

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
              onClear={() => { setFile(null); resetResults(); }}
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
                previewUrl={objectUrl}
                onEditFields={editImageFields}
                onWarehouse={() => imgEnv && sendToWarehouse(imgEnv)}
              />
            )}
            {type === "audio" && (
              <AudioResultView
                env={audEnv}
                phase={phase}
                previewUrl={objectUrl}
                onEditTldr={editAudioSummary}
                onWarehouse={() => audEnv && sendToWarehouse(audEnv)}
              />
            )}
            {type === "video" && (
              <VideoResultView
                previewUrl={objectUrl}
                videoRef={videoElRef}
                subtitles={subs}
                events={events}
                summary={vSummary}
                phase={phase}
                onSeek={seekVideo}
                onWarehouse={(env) => sendToWarehouse(env)}
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
      />
    </div>
  );
}
