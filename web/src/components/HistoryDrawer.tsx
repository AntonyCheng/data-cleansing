import { clearHistory, type HistoryItem } from "../history";

const TYPE_LABEL: Record<HistoryItem["type"], string> = {
  image: "图片",
  audio: "音频",
  video: "视频",
};

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function HistoryDrawer({
  open,
  items,
  onClose,
  onOpenItem,
  onCleared,
}: {
  open: boolean;
  items: HistoryItem[];
  onClose: () => void;
  onOpenItem: (item: HistoryItem) => void;
  onCleared: () => void;
}) {
  if (!open) return null;
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} aria-label="历史记录">
        <div className="drawer-head">
          <span>历史记录 · 本机保存最近 {40} 条</span>
          <button className="link" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        {items.length === 0 ? (
          <div className="empty" style={{ margin: 16 }}>还没有记录。完成一次清洗后会自动保存在这里，回看不重复计费。</div>
        ) : (
          <ul className="drawer-list">
            {items.map((it) => (
              <li key={it.task_id}>
                <button className="hist-item" onClick={() => onOpenItem(it)}>
                  <div className="hist-top">
                    <span className={`hist-tag t-${it.type}`}>{TYPE_LABEL[it.type]}</span>
                    <span className="hist-file">{it.filename || it.task_id}</span>
                    <span className="hist-when">{when(it.created_at)}</span>
                  </div>
                  <div className="hist-sum">{it.summary || "（无摘要）"}</div>
                  <div className="hist-cost">预估 ¥{it.cost_estimate_cny.toFixed(3)}</div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {items.length > 0 && (
          <div className="drawer-foot">
            <button
              className="link"
              onClick={() => {
                clearHistory();
                onCleared();
              }}
            >
              清空历史
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
