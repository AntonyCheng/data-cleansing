import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { useStored } from "../lib/storage";

const DEFAULT_WIDTH = 322;
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;
const MIN_TABLE_WIDTH = 480;
const DIVIDER_WIDTH = 14;

export default function ResizableWorkspace({
  children,
  copilot,
}: {
  children: ReactNode;
  copilot: ReactNode;
}) {
  const canvas = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [preferredWidth, setPreferredWidth] = useStored<number>(
    "kdata.studio.copilot-width",
    () => DEFAULT_WIDTH,
  );
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef<{ x: number; width: number; current: number } | null>(
    null,
  );

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setCanvasWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Limit the panel against the available canvas, without losing the user's
  // preferred width when the browser is temporarily made narrower.
  const maxWidth = Math.max(
    MIN_WIDTH,
    Math.min(
      MAX_WIDTH,
      (canvasWidth || 1200) - MIN_TABLE_WIDTH - DIVIDER_WIDTH,
    ),
  );
  const clamp = (value: number) =>
    Math.round(Math.max(MIN_WIDTH, Math.min(maxWidth, value)));
  const width = clamp(
    dragWidth ??
      (Number.isFinite(preferredWidth) ? preferredWidth : DEFAULT_WIDTH),
  );
  const adjust = (delta: number) => setPreferredWidth(clamp(width + delta));
  function finishDrag(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    if (commit) setPreferredWidth(clamp(active.current));
    setDragWidth(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      ref={canvas}
      className={`workspace-canvas resizable-workspace ${copilot ? "" : "assistant-hidden"} ${dragWidth !== null ? "is-resizing" : ""}`}
      style={{ "--copilot-width": `${width}px` } as CSSProperties}
    >
      <div className="workspace-sheet">{children}</div>
      {copilot && (
        <>
          <div className="workspace-divider">
            <div
              className="workspace-resizer"
              role="separator"
              tabIndex={0}
              aria-label="调整 AI 副驾驶宽度"
              aria-orientation="vertical"
              aria-valuemin={MIN_WIDTH}
              aria-valuemax={Math.round(maxWidth)}
              aria-valuenow={width}
              aria-valuetext={`AI 副驾驶宽度 ${width} 像素`}
              title="左右拖动调整宽度；方向键微调，双击恢复默认宽度"
              onDoubleClick={() => setPreferredWidth(DEFAULT_WIDTH)}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 50 : 20;
                if (event.key === "ArrowLeft") adjust(step);
                else if (event.key === "ArrowRight") adjust(-step);
                else if (event.key === "Home") setPreferredWidth(MIN_WIDTH);
                else if (event.key === "End") setPreferredWidth(maxWidth);
                else if (event.key === "Enter")
                  setPreferredWidth(DEFAULT_WIDTH);
                else return;
                event.preventDefault();
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                drag.current = { x: event.clientX, width, current: width };
                setDragWidth(width);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!drag.current) return;
                const next = clamp(
                  drag.current.width + drag.current.x - event.clientX,
                );
                drag.current.current = next;
                setDragWidth(next);
              }}
              onPointerUp={(event) => finishDrag(event, true)}
              onPointerCancel={(event) => finishDrag(event, false)}
              onLostPointerCapture={(event) => finishDrag(event, false)}
            >
              <span />
              <i className="workspace-grip" aria-hidden="true" />
            </div>
          </div>
          {copilot}
        </>
      )}
    </div>
  );
}
