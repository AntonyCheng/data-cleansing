import type { KeyboardEvent } from "react";
import type { TaskType } from "../types";

const ITEMS: { key: TaskType; icon: string; name: string; sub: string }[] = [
  { key: "image", icon: "▦", name: "图片", sub: "OCR / 结构化" },
  { key: "audio", icon: "◍", name: "音频", sub: "转写 / 摘要" },
  { key: "video", icon: "▷", name: "视频", sub: "边播边析" },
];

export function TypeMenu({
  active,
  onChange,
}: {
  active: TaskType;
  onChange: (t: TaskType) => void;
}) {
  const onKey = (e: KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = (idx + (e.key === "ArrowDown" ? 1 : ITEMS.length - 1)) % ITEMS.length;
    onChange(ITEMS[next].key);
  };

  return (
    <nav className="menu" aria-label="数据类型">
      <p>数据类型</p>
      {ITEMS.map((it, idx) => (
        <button
          key={it.key}
          className={it.key === active ? "active" : ""}
          onClick={() => onChange(it.key)}
          onKeyDown={(e) => onKey(e, idx)}
          aria-pressed={it.key === active}
        >
          <span className="m-icon">{it.icon}</span>
          <span className="m-name">{it.name}</span>
          <span className="m-sub">{it.sub}</span>
        </button>
      ))}
    </nav>
  );
}
