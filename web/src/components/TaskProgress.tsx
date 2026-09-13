import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DataTask } from "../lib/types";
import {
  IMPORT_STATUS,
  PROCESSING_STATUS,
  importStatus,
  taskStatus,
} from "../lib/status";

export default function TaskProgress({ task }: { task: DataTask }) {
  const processing = taskStatus(task);
  const storage = importStatus(task);
  const run = task.runs[0];
  const stages = [
    {
      name: "数据接入",
      state: "已完成",
      tone: "done",
      description: `已接入 ${task.sourceType} 数据，来源：${task.source}。`,
    },
    {
      name: "解析与分析",
      state: "已完成",
      tone: "done",
      description: `已解析 ${task.raw.length.toLocaleString()} 行、${task.fields.length} 个字段，完成字段识别与质量分析。`,
    },
    {
      name: "清洗与预览",
      state: processing.text,
      tone:
        processing === PROCESSING_STATUS.complete
          ? "done"
          : processing === PROCESSING_STATUS.invalid
            ? "warning"
            : "pending",
      description:
        processing === PROCESSING_STATUS.complete
          ? `最新清洗结果保留 ${run.rows.length.toLocaleString()} 行，校验通过，可预览或导出清洗后的数据。`
          : processing === PROCESSING_STATUS.invalid
            ? `${PROCESSING_STATUS.invalid.description}${run.validation.messages.length ? `原因：${run.validation.messages.join("；")}` : ""}`
            : PROCESSING_STATUS.pending.description,
    },
    {
      name: "确认入库",
      state: storage?.text || processing.text,
      tone: storage === IMPORT_STATUS.stored ? "done" : "pending",
      description:
        storage === IMPORT_STATUS.stored
          ? `最新清洗版本已写入${task.destination ? `本地演示表 ${task.destination.database}.${task.destination.table}` : "目标表"}。再次清洗后需重新确认入库。`
          : storage
            ? storage.description
            : "需先完成清洗并通过校验，再选择目标表、核对字段映射并确认入库。",
    },
  ];
  const [active, setActive] = useState<{
    index: number;
    anchor: HTMLElement;
  } | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const id = useId();

  function keepOpen() {
    clearTimeout(hideTimer.current);
  }
  function scheduleClose() {
    keepOpen();
    hideTimer.current = setTimeout(() => setActive(null), 140);
  }
  function open(index: number, anchor: HTMLElement) {
    keepOpen();
    setPosition(null);
    setActive({ index, anchor });
  }

  useEffect(() => () => clearTimeout(hideTimer.current), []);
  useEffect(() => {
    if (!active) return;
    const dismiss = () => {
      clearTimeout(hideTimer.current);
      setActive(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const onPointer = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !tip.current?.contains(event.target as Node)
      )
        dismiss();
    };
    const onScroll = (event: Event) => {
      if (!tip.current?.contains(event.target as Node)) dismiss();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [active]);

  useLayoutEffect(() => {
    if (!active || !tip.current) return;
    const anchor = active.anchor.getBoundingClientRect();
    const rect = tip.current.getBoundingClientRect();
    const left = Math.max(
      12,
      Math.min(
        anchor.left + anchor.width / 2 - rect.width / 2,
        window.innerWidth - rect.width - 12,
      ),
    );
    const below = anchor.bottom + 8;
    const top =
      below + rect.height <= window.innerHeight - 12
        ? below
        : Math.max(12, anchor.top - rect.height - 8);
    setPosition({ left, top });
  }, [active]);

  return (
    <>
      <div
        className="mini-progress"
        role="group"
        aria-label={`${task.name}处理进度`}
        ref={root}
      >
        {stages.map((stage, index) => (
          <button
            key={stage.name}
            type="button"
            className={`task-progress-step ${stage.tone} ${active?.index === index ? "is-active" : ""}`}
            aria-label={`${index + 1}. ${stage.name}：${stage.state}`}
            aria-describedby={active?.index === index ? id : undefined}
            onPointerEnter={(event) => {
              if (event.pointerType !== "touch")
                open(index, event.currentTarget);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== "touch") scheduleClose();
            }}
            onFocus={(event) => open(index, event.currentTarget)}
            onBlur={scheduleClose}
            onClick={(event) => open(index, event.currentTarget)}
          >
            <span aria-hidden="true" />
          </button>
        ))}
      </div>
      {active &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className="task-progress-tooltip"
            style={{
              left: position?.left || 0,
              top: position?.top || 0,
              visibility: position ? "visible" : "hidden",
            }}
            onPointerEnter={keepOpen}
            onPointerLeave={scheduleClose}
          >
            <div className="task-progress-tooltip-heading">
              <strong>
                {active.index + 1}. {stages[active.index].name}
              </strong>
              <span className={stages[active.index].tone}>
                {stages[active.index].state}
              </span>
            </div>
            <p>{stages[active.index].description}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
