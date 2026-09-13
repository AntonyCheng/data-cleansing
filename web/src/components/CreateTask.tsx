import { useState } from "react";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file";
import {
  ArrowRight,
  Upload,
  Check,
  FileSpreadsheet,
  Database,
  Globe2,
  Braces,
  Radio,
  Film,
  Image as ImageIcon,
  AudioLines,
  Sparkles,
} from "lucide-react";
import type { DataRow, DataTask } from "../lib/types";
import { analyze } from "../lib/engine";
import { makeTask, sampleRows } from "../data/seed";
import { Badge, Notice } from "./UI";
import { MEDIA_KIND_LABEL, startMediaTask, type MediaKind } from "../lib/media";
export const sourceOptions = [
  {
    name: "Excel / CSV",
    icon: FileSpreadsheet,
    description: "上传本地数据文件",
  },
  { name: "数据库", icon: Database, description: "MySQL / PostgreSQL" },
  { name: "API", icon: Braces, description: "HTTP / OpenAPI" },
  { name: "URL / 网页", icon: Globe2, description: "网页数据提取" },
  { name: "图片", icon: ImageIcon, description: "证件 / 票据结构化" },
  { name: "音频", icon: AudioLines, description: "转写、说话人分离、摘要" },
  { name: "视频", icon: Film, description: "字幕、画面事件、章节摘要" },
  {
    name: "Kafka / MQTT",
    icon: Radio,
    description: "消息与实时数据",
    later: true,
  },
];
// 三个媒体来源对应的 bff 任务类型，用于判断当前是否走媒体清洗分支
const MEDIA_SOURCE_KIND: Record<string, MediaKind> = {
  图片: "image",
  音频: "audio",
  视频: "video",
};
const MEDIA_ACCEPT: Record<MediaKind, string> = {
  image: "image/*,.pdf",
  audio: "audio/*",
  video: "video/mp4,video/quicktime",
};
const MEDIA_LIMIT_HINT: Record<MediaKind, string> = {
  image: "JPG / PNG / WEBP / 单页 PDF · ≤ 10MB",
  audio: "WAV / MP3 / M4A / AAC · ≤ 200MB · ≤ 5h",
  video: "MP4 / MOV · ≤ 500MB · ≤ 30min",
};
export default function CreateTask({
  initialType = "Excel / CSV",
  onCreate,
  onCreateMedia,
  onClose,
}: {
  initialType?: string;
  onCreate: (task: DataTask) => void;
  onCreateMedia: (kind: MediaKind, taskId: string, name: string, filename: string) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState(initialType);
  const [name, setName] = useState("");
  const [file, setFile] = useState("");
  const [rows, setRows] = useState<DataRow[]>([]);
  const [address, setAddress] = useState("");
  const [databaseType, setDatabaseType] = useState("MySQL");
  const [schedule, setSchedule] = useState("手动触发");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [parsed, setParsed] = useState<DataTask | null>(null);
  const mediaKind = MEDIA_SOURCE_KIND[type];
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [frameIntervalMs, setFrameIntervalMs] = useState(3000);
  async function submitMedia() {
    if (!mediaKind || !mediaFile) return;
    setError("");
    setBusy(true);
    try {
      const { taskId } = await startMediaTask(
        mediaKind,
        mediaFile,
        mediaKind === "video" ? { frameIntervalMs } : undefined,
      );
      onCreateMedia(mediaKind, taskId, name.trim() || mediaFile.name, mediaFile.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败，请检查服务是否可用。");
    } finally {
      setBusy(false);
    }
  }
  async function upload(input?: File) {
    if (!input) return;
    setError("");
    setRows([]);
    setFile("");
    if (input.size > 5 * 1024 * 1024) {
      setError("请上传 5 MB 以内的文件。");
      return;
    }
    if (!/\.(csv|xlsx)$/i.test(input.name)) {
      setError("支持 CSV 和 XLSX 文件。");
      return;
    }
    setBusy(true);
    try {
      let matrix: string[][];
      if (/\.xlsx$/i.test(input.name)) {
        const values = await readXlsxFile(input);
        matrix = values.map((row) =>
          row.map((v) =>
            v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""),
          ),
        );
      } else {
        const parsed = Papa.parse<string[]>(await input.text(), {
          skipEmptyLines: "greedy",
        });
        if (parsed.errors.length)
          throw new Error("CSV 格式错误，请检查引号与分隔符。");
        matrix = parsed.data;
      }
      matrix = matrix.filter((r) => r.some((v) => v.trim()));
      const maxColumns = Math.max(
        ...matrix.slice(0, 10).map((r) => r.filter((v) => v.trim()).length),
      );
      const headerIndex = matrix
        .slice(0, 10)
        .findIndex((r) => r.filter((v) => v.trim()).length === maxColumns);
      const headers = (matrix[headerIndex] || []).map((v) => v.trim());
      if (
        !headers.length ||
        headers.some((v) => !v) ||
        new Set(headers).size !== headers.length
      )
        throw new Error("无法识别唯一表头，请确保表头没有重复或空名称。");
      const body = matrix.slice(headerIndex + 1);
      if (!body.length) throw new Error("文件只有表头，没有可处理的数据行。");
      if (body.length > 10000)
        throw new Error("本地演示最多支持 10,000 行，请拆分文件。");
      if (body.some((r) => r.length > headers.length))
        throw new Error("数据行列数超过表头，请检查文件结构。");
      setRows(
        body.map((row, i) => ({
          id: `import-${i}`,
          values: Object.fromEntries(
            headers.map((key, j) => [key, row[j] ?? null]),
          ),
        })),
      );
      setFile(input.name);
      setName(input.name.replace(/\.[^.]+$/, "") + "整理");
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失败，请检查文件。");
    } finally {
      setBusy(false);
    }
  }
  function next() {
    setError("");
    if (!name.trim()) {
      setError("请填写任务名称。");
      return;
    }
    if (type === "Excel / CSV" && !rows.length) {
      setError("请先选择数据文件，或使用样例数据。");
      return;
    }
    if (type !== "Excel / CSV" && !address.trim()) {
      setError("请填写数据源地址。");
      return;
    }
    if (["API", "URL / 网页"].includes(type)) {
      try {
        const u = new URL(address);
        if (!["http:", "https:"].includes(u.protocol)) throw new Error();
      } catch {
        setError("请填写有效的 HTTP / HTTPS 地址。");
        return;
      }
    }
    setBusy(true);
    setTimeout(() => {
      setParsed(
        makeTask(
          name.trim(),
          type === "Excel / CSV" ? file : address,
          type === "Excel / CSV"
            ? file.endsWith(".csv")
              ? "CSV"
              : "Excel"
            : type === "数据库"
              ? databaseType
              : type === "URL / 网页"
                ? "URL"
                : "API",
          type === "Excel / CSV" ? rows : sampleRows(),
          type !== "Excel / CSV" || file === "客户数据样例.xlsx",
        ),
      );
      setBusy(false);
    }, 500);
  }
  return (
    <>
      <div className="wizard-steps">
        <span className={!parsed ? "current" : "complete"}>
          <b>{parsed ? <Check size={13} /> : 1}</b>选择数据
        </span>
        <i />
        <span className={parsed ? "current" : ""}>
          <b>2</b>{mediaKind ? "提交清洗" : "自动解析"}
        </span>
        <i />
        <span>
          <b>3</b>进入工作台
        </span>
      </div>
      {!parsed ? (
        <>
          <div className="source-selector">
            {sourceOptions.map((s) => (
              <button
                disabled={s.later}
                key={s.name}
                className={type === s.name ? "selected" : ""}
                onClick={() => {
                  setType(s.name);
                  setError("");
                }}
              >
                <s.icon size={22} />
                <strong>{s.name}</strong>
                <small>{s.later ? "后续开放" : s.description}</small>
              </button>
            ))}
          </div>
          {type === "Excel / CSV" ? (
            <>
              <label className="upload-area">
                <Upload size={28} />
                <strong>
                  {busy ? "正在读取数据…" : file || "点击选择或拖入文件"}
                </strong>
                <span>
                  CSV、XLSX · 最大 5 MB / 10,000 行 · Excel 读取首个工作表
                </span>
                <input
                  type="file"
                  aria-label="上传数据文件"
                  accept=".csv,.xlsx"
                  disabled={busy}
                  onChange={(e) => void upload(e.target.files?.[0])}
                />
              </label>
              <button
                className="sample-link"
                onClick={() => {
                  setRows(sampleRows());
                  setFile("客户数据样例.xlsx");
                  setName("客户数据标准化");
                  setError("");
                }}
              >
                没有文件？使用客户数据样例
                <ArrowRight size={14} />
              </button>
              {rows.length > 0 && (
                <Notice>
                  已读取 {rows.length} 行数据，下一步自动识别字段和质量问题。
                </Notice>
              )}
            </>
          ) : mediaKind ? (
            <>
              <label className="upload-area">
                <Upload size={28} />
                <strong>
                  {mediaFile ? mediaFile.name : `点击选择${MEDIA_KIND_LABEL[mediaKind]}文件`}
                </strong>
                <span>{MEDIA_LIMIT_HINT[mediaKind]}</span>
                <input
                  type="file"
                  aria-label={`上传${MEDIA_KIND_LABEL[mediaKind]}文件`}
                  accept={MEDIA_ACCEPT[mediaKind]}
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      setMediaFile(f);
                      setError("");
                      if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, ""));
                    }
                  }}
                />
              </label>
              {mediaKind === "video" && (
                <label className="field">
                  抽帧间隔 · {(frameIntervalMs / 1000).toFixed(0)}s
                  <input
                    type="range"
                    min={2000}
                    max={10000}
                    step={1000}
                    value={frameIntervalMs}
                    disabled={busy}
                    onChange={(e) => setFrameIntervalMs(Number(e.target.value))}
                  />
                </label>
              )}
              {mediaFile && (
                <Notice>
                  已选择文件，提交后由服务端结构化处理，可在数据任务中查看进度。
                </Notice>
              )}
            </>
          ) : (
            <>
              <div className="form-columns">
                {type === "数据库" && (
                  <label className="field">
                    数据库类型
                    <select
                      value={databaseType}
                      onChange={(e) => setDatabaseType(e.target.value)}
                    >
                      <option>MySQL</option>
                      <option>PostgreSQL</option>
                      <option>Oracle</option>
                      <option>达梦</option>
                    </select>
                  </label>
                )}
                <label className="field">
                  同步方式
                  <select
                    value={schedule}
                    onChange={(e) => setSchedule(e.target.value)}
                  >
                    <option>手动触发</option>
                    <option>每天 09:00</option>
                    <option>每小时</option>
                    <option>增量同步</option>
                  </select>
                </label>
              </div>
              <label className="field">
                {type === "数据库"
                  ? "连接地址 / 数据库"
                  : type === "API"
                    ? "接口地址或 OpenAPI 文档 URL"
                    : "网页 URL"}
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={
                    type === "数据库"
                      ? "localhost:3306 / customer"
                      : "https://example.com/data"
                  }
                />
              </label>
              <Notice>
                前端演示会保存配置，并使用客户样例演示后续流程；不会连接远程数据源。
              </Notice>
            </>
          )}
          <label className="field">
            任务名称
            <input
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：客户数据标准化"
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-footer">
            <button className="button" onClick={onClose}>
              取消
            </button>
            <button
              className="button primary"
              disabled={busy || (!!mediaKind && !mediaFile)}
              onClick={mediaKind ? submitMedia : next}
            >
              <Sparkles size={16} />
              {mediaKind
                ? busy
                  ? "正在提交…"
                  : "提交清洗"
                : busy
                  ? "正在解析数据…"
                  : "开始解析"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="parse-success">
            <span>
              <Check size={23} />
            </span>
            <div>
              <h3>数据已解析，可以开始整理</h3>
              <p>
                {parsed.source} · {parsed.raw.length} 行 ·{" "}
                {parsed.fields.length} 个字段
              </p>
            </div>
            <Badge tone="green">解析完成</Badge>
          </div>
          <div className="parse-metrics">
            <div>
              <strong>
                {analyze(parsed.raw, parsed.fields).score}
                <small> / 100</small>
              </strong>
              <span>原始质量评分</span>
            </div>
            <div>
              <strong>
                {analyze(parsed.raw, parsed.fields).issues.length}
                <small> 项</small>
              </strong>
              <span>发现质量问题</span>
            </div>
            <div>
              <strong>
                {parsed.fields.filter((f) => f.sensitive).length}
                <small> 个</small>
              </strong>
              <span>识别敏感字段</span>
            </div>
          </div>
          <div className="parse-fields">
            {parsed.fields.map((f) => (
              <div key={f.key}>
                <span>
                  <strong>{f.label}</strong>
                  <code>{f.key}</code>
                </span>
                <span>{f.type}</span>
                {f.sensitive && <Badge tone="amber">敏感</Badge>}
              </div>
            ))}
          </div>
          <p className="helper">
            字段类型与语义来自本地规则识别，可在工作台中检查和调整。
          </p>
          <div className="form-footer">
            <button className="button" onClick={() => setParsed(null)}>
              返回修改
            </button>
            <button
              className="button primary"
              onClick={() =>
                onCreate({
                  ...parsed,
                  sourceSchedule:
                    type === "Excel / CSV" ? "手动上传" : schedule,
                })
              }
            >
              进入数据工作台
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      )}
    </>
  );
}
