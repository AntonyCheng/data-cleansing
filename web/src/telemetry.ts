// 轻量埋点：批量攒事件，定时 / 卸载时 flush 到 BFF（/api/telemetry -> telemetry/*.jsonl）

type Props = Record<string, string | number | boolean | null | undefined>;
interface Event extends Props {
  event: string;
  ts: number;
  session: string;
}

const SESSION = Math.random().toString(36).slice(2, 10);
let queue: Event[] = [];
let timer: number | undefined;

function flush(): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  const body = JSON.stringify(batch);
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/telemetry", new Blob([body], { type: "application/json" }));
    } else {
      void fetch("/api/telemetry", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
    }
  } catch {
    /* 埋点失败不影响主流程 */
  }
}

export function track(event: string, props: Props = {}): void {
  queue.push({ ...props, event, ts: Date.now(), session: SESSION });
  if (import.meta.env.DEV) console.debug("[track]", event, props);
  if (queue.length >= 10) flush();
  else {
    clearTimeout(timer);
    timer = window.setTimeout(flush, 4000);
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
