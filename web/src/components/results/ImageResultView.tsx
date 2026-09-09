import type { ImageField, ImageResult, TaskEnvelope } from "../../types";
import { track } from "../../telemetry";
import { downloadJson } from "../export";

type Phase = "idle" | "uploading" | "cleaning" | "done" | "error";

export function ImageResultView({
  env,
  phase,
  previewUrl,
  onEditFields,
}: {
  env: TaskEnvelope<ImageResult> | null;
  phase: Phase;
  previewUrl: string | null;
  onEditFields: (fields: ImageField[]) => void;
}) {
  if (phase === "uploading" || phase === "cleaning") {
    return (
      <div>
        {previewUrl && <div className="preview"><img src={previewUrl} alt="预览" /></div>}
        <div className="skeleton" style={{ width: "40%" }} />
        <div className="skeleton" />
        <div className="skeleton" style={{ width: "80%" }} />
        <div className="skeleton" style={{ width: "60%" }} />
      </div>
    );
  }

  if (!env) {
    return <div className="empty">上传图片并点击「确认清洗」，结构化结果在此显示。<br />命中身份证 / 增值税发票等版式时输出字段表。</div>;
  }

  const r = env.result;
  const setValue = (i: number, value: string) => {
    onEditFields(r.fields.map((f, idx) => (idx === i ? { ...f, value } : f)));
  };

  return (
    <div>
      {previewUrl && <div className="preview"><img src={previewUrl} alt="原始图片" /></div>}

      <div className="subhead">
        版式 · {r.layout}
        {env.human_edited && <span className="edited-flag">已人工修正</span>}
      </div>
      <p style={{ margin: "0 0 8px" }}>{r.summary}</p>
      <div className="tags">{r.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>

      <div className="subhead">结构化字段（点值可编辑）</div>
      <div className="fields">
        {r.fields.map((f, i) => (
          <div key={f.key} className={`field-row${f.confidence < 0.8 ? " low" : ""}`}>
            <span className="k">{f.label}</span>
            <span className="v">
              <input
                className="field-input"
                value={f.value}
                aria-label={f.label}
                onChange={(e) => setValue(i, e.target.value)}
              />
              <span className="cf"> · {(f.confidence * 100).toFixed(0)}%</span>
            </span>
          </div>
        ))}
      </div>

      {r.line_items && r.line_items.length > 0 && (
        <>
          <div className="subhead">明细行</div>
          <div className="fields">
            {r.line_items.map((li, i) => (
              <div key={i} className="field-row">
                <span className="k">{li.name}</span>
                <span className="v">金额 {li.amount.toFixed(2)} · 税 {li.tax.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="subhead">全文 OCR</div>
      <div className="mono-block">{r.full_text}</div>

      <div className="export-bar">
        <button onClick={() => { downloadJson(`${env.task_id}.json`, env); track("export", { via: "download", type: "image" }); }}>下载 JSON</button>
      </div>
    </div>
  );
}
