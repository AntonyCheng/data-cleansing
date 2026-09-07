export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function copyJson(data: unknown) {
  await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
}

export function toSrt(lines: { start_ms: number; end_ms: number; text: string }[]): string {
  const ts = (ms: number) => {
    const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    const x = String(ms % 1000).padStart(3, "0");
    return `${h}:${m}:${s},${x}`;
  };
  return lines
    .map((l, i) => `${i + 1}\n${ts(l.start_ms)} --> ${ts(l.end_ms)}\n${l.text}\n`)
    .join("\n");
}

export function downloadText(name: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}
