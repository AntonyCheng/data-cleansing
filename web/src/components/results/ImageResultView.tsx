import { useRef, useState } from "react";
import type { ImageField, ImageResult, TaskEnvelope } from "../../types";
import { track } from "../../telemetry";
import { copyJson, downloadJson } from "../export";

type Phase = "idle" | "uploading" | "cleaning" | "done" | "error";

interface DrawBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 把原图像素 bbox 换算成叠加层坐标（考虑 object-fit: contain 的留白） */
function projectBox(img: HTMLImageElement, bbox: [number, number, number, number]): DrawBox | null {
  const { naturalWidth: nw, naturalHeight: nh } = img;
  if (!nw || !nh) return null;
  const bw = img.clientWidth;
  const bh = img.clientHeight;
  const natRatio = nw / nh;
  const boxRatio = bw / bh;
  let drawW: number;
  let drawH: number;
  if (natRatio > boxRatio) {
    drawW = bw;
    drawH = bw / natRatio;
  } else {
    drawH = bh;
    drawW = bh * natRatio;
  }
  const offX = (bw - drawW) / 2;
  const offY = (bh - drawH) / 2;
  const scale = drawW / nw;
  const [x1, y1, x2, y2] = bbox;
  return {
    left: offX + x1 * scale,
    top: offY + y1 * scale,
    width: Math.max(2, (x2 - x1) * scale),
    height: Math.max(2, (y2 - y1) * scale),
  };
}

export function ImageResultView({
  env,
  phase,
  previewUrl,
  onEditFields,
  onWarehouse,
}: {
  env: TaskEnvelope<ImageResult> | null;
  phase: Phase;
  previewUrl: string | null;
  onEditFields: (fields: ImageField[]) => void;
  onWarehouse: () => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [activeField, setActiveField] = useState<number | null>(null);
  const [, forceRender] = useState(0);

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

  const activeBbox = activeField != null ? r.fields[activeField]?.bbox : undefined;
  const drawBox =
    activeBbox && imgRef.current ? projectBox(imgRef.current, activeBbox) : null;

  return (
    <div>
      {previewUrl && (
        <div className="preview preview-locatable">
          <img
            ref={imgRef}
            src={previewUrl}
            alt="原始图片"
            onLoad={() => forceRender((n) => n + 1)}
          />
          {drawBox && (
            <div
              className="locate-box"
              style={{ left: drawBox.left, top: drawBox.top, width: drawBox.width, height: drawBox.height }}
            />
          )}
        </div>
      )}

      <div className="subhead">
        版式 · {r.layout}
        {env.human_edited && <span className="edited-flag">已人工修正</span>}
      </div>
      <p style={{ margin: "0 0 8px" }}>{r.summary}</p>
      <div className="tags">{r.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>

      <div className="subhead">结构化字段（点值编辑 · 悬停定位原图）</div>
      <div className="fields">
        {r.fields.map((f, i) => (
          <div
            key={f.key}
            className={`field-row${f.confidence < 0.8 ? " low" : ""}${f.bbox ? " has-box" : ""}`}
            onMouseEnter={() => f.bbox && setActiveField(i)}
            onMouseLeave={() => setActiveField((cur) => (cur === i ? null : cur))}
          >
            <span className="k">{f.label}</span>
            <span className="v">
              <input
                className="field-input"
                value={f.value}
                aria-label={f.label}
                onChange={(e) => setValue(i, e.target.value)}
              />
              <span className="cf"> · {(f.confidence * 100).toFixed(0)}%{f.bbox ? " · 可定位" : ""}</span>
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
        <button onClick={() => { copyJson(env); track("export", { via: "copy", type: "image" }); }}>复制 JSON</button>
        <button onClick={() => { downloadJson(`${env.task_id}.json`, env); track("export", { via: "download", type: "image" }); }}>下载 JSON</button>
        <button onClick={onWarehouse}>回传数仓</button>
      </div>
    </div>
  );
}
