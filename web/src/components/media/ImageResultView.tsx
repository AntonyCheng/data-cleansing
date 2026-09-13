import { Download } from "lucide-react";
import type { ImageField, ImageResult, TaskEnvelope } from "../../lib/media";
import { download } from "../../lib/engine";
import { Empty } from "../UI";

export default function ImageResultView({
  env,
  running,
  previewUrl,
  onEditFields,
}: {
  env: TaskEnvelope<ImageResult> | null;
  running: boolean;
  previewUrl: string | null;
  onEditFields: (fields: ImageField[]) => void;
}) {
  if (running) {
    return (
      <div className="media-result">
        {previewUrl && (
          <div className="media-preview">
            <img src={previewUrl} alt="预览" />
          </div>
        )}
        <div className="media-skeleton" style={{ width: "40%" }} />
        <div className="media-skeleton" />
        <div className="media-skeleton" style={{ width: "80%" }} />
        <div className="media-skeleton" style={{ width: "60%" }} />
      </div>
    );
  }

  if (!env) {
    return (
      <Empty
        title="尚无清洗结果"
        description="上传图片并提交清洗后，结构化字段会展示在这里。命中证件 / 票据等版式时会输出字段表。"
      />
    );
  }

  const r = env.result;
  const setValue = (i: number, value: string) => {
    onEditFields(r.fields.map((f, idx) => (idx === i ? { ...f, value } : f)));
  };

  return (
    <div className="media-result">
      {previewUrl && (
        <div className="media-preview">
          <img src={previewUrl} alt="原始图片" />
        </div>
      )}

      <div className="media-subhead">
        版式 · {r.layout}
        {env.human_edited && <span className="media-edited-flag">已人工修正</span>}
      </div>
      <p className="media-summary">{r.summary}</p>
      <div className="media-tags">
        {r.tags.map((t) => (
          <span key={t} className="media-tag">
            {t}
          </span>
        ))}
      </div>

      <div className="media-subhead">结构化字段（点值可编辑）</div>
      <div className="media-fields">
        {r.fields.map((f, i) => (
          <div key={f.key} className={`media-field-row${f.confidence < 0.8 ? " low" : ""}`}>
            <span className="k">{f.label}</span>
            <span className="v">
              <input
                className="media-field-input"
                value={f.value}
                aria-label={f.label}
                onChange={(e) => setValue(i, e.target.value)}
              />
              <span className="media-confidence"> · {(f.confidence * 100).toFixed(0)}%</span>
            </span>
          </div>
        ))}
      </div>

      {r.line_items && r.line_items.length > 0 && (
        <>
          <div className="media-subhead">明细行</div>
          <div className="media-fields">
            {r.line_items.map((li, i) => (
              <div key={i} className="media-field-row">
                <span className="k">{li.name}</span>
                <span className="v">
                  金额 {li.amount.toFixed(2)} · 税 {li.tax.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="media-subhead">全文 OCR</div>
      <div className="media-mono-block">{r.full_text}</div>

      <div className="media-export-bar">
        <button className="button" onClick={() => download(`${env.task_id}.json`, JSON.stringify(env, null, 2), "application/json")}>
          <Download size={15} />
          下载 JSON
        </button>
      </div>
    </div>
  );
}
