import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import {
  X,
  Search,
  CheckCircle2,
  AlertTriangle,
  Database,
  FileSpreadsheet,
  Globe2,
  Braces,
  Inbox,
  Film,
  AudioLines,
  Image as ImageIcon,
} from "lucide-react";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "green" | "amber" | "red" | "blue" | "neutral";
}) {
  return (
    <span className={`badge ${tone}`}>
      <i />
      {children}
    </span>
  );
}
export function SourceIcon({
  type,
  size = 19,
}: {
  type: string;
  size?: number;
}) {
  const Icon = /Excel|CSV|文件/.test(type)
    ? FileSpreadsheet
    : /URL|Web/.test(type)
      ? Globe2
      : type === "API"
        ? Braces
        : /视频/.test(type)
            ? Film
            : /音频/.test(type)
              ? AudioLines
              : /图片/.test(type)
                ? ImageIcon
                : Database;
  return (
    <span
      className={`source-icon ${/Excel|CSV/.test(type) ? "mint" : type === "API" ? "purple" : /URL/.test(type) ? "sand" : "blue"}`}
    >
      <Icon size={size} />
    </span>
  );
}
export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={id}>{title}</h2>
        <button className="icon-button" aria-label="关闭弹窗" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
export function SearchBox({
  value,
  onChange,
  placeholder = "搜索…",
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-box">
      <Search size={16} />
      <input
        aria-label={placeholder}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="清空搜索" onClick={() => onChange("")}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
export function Notice({
  children,
  warning = false,
}: {
  children: ReactNode;
  warning?: boolean;
}) {
  return (
    <div className={`notice ${warning ? "warning" : ""}`}>
      {warning ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title = "暂无数据",
  description = "创建一个数据任务，从接入开始。",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={30} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function formatTime(time: string) {
  return new Date(time).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
