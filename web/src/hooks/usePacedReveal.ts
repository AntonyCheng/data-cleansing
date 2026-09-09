import { useEffect, useRef, useState } from "react";

/**
 * 把「陆续变得可见」的列表按固定节奏逐项释放给 UI，避免批量到达时一坨同时出现。
 * - 第一项立即放出（不因为节奏而推迟首次出现）；其后每 intervalMs 放一项。
 * - active=false 时（未在跟随播放 / 已播完 / 非实时场景）全部立即可见，不做动画排队。
 * - items 收缩（如拖动进度条回退）时已放出数量跟着收紧，不越界。
 */
export function usePacedReveal<T>(items: T[], intervalMs: number, active: boolean): T[] {
  const [revealed, setRevealed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) {
      setRevealed(items.length);
      return;
    }
    setRevealed((r) => Math.min(r, items.length));
  }, [items.length, active]);

  useEffect(() => {
    if (!active || revealed >= items.length) return;
    const delay = revealed === 0 ? 0 : intervalMs;
    timerRef.current = setTimeout(() => setRevealed((r) => Math.min(r + 1, items.length)), delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [active, revealed, items.length, intervalMs]);

  return items.slice(0, revealed);
}
