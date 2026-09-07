import { AsyncLocalStorage } from "node:async_hooks";

export interface CostCall {
  api: string;
  cny: number;
}
export interface CostAcc {
  cny: number;
  calls: CostCall[];
}

const als = new AsyncLocalStorage<CostAcc>();

/** 在一个成本核算上下文里执行；内部任意深度的 addCost 都会累加到同一个 acc */
export async function withCost<T>(fn: () => Promise<T>): Promise<{ result: T; cost: CostAcc }> {
  const acc: CostAcc = { cny: 0, calls: [] };
  const result = await als.run(acc, fn);
  return { result, cost: acc };
}

/** 生成器版本：返回 acc 供边跑边读 */
export function newCostAcc(): CostAcc {
  return { cny: 0, calls: [] };
}
export function runWithAcc<T>(acc: CostAcc, fn: () => T): T {
  return als.run(acc, fn);
}

export function addCost(api: string, cny: number): void {
  const acc = als.getStore();
  if (acc) {
    acc.cny += cny;
    acc.calls.push({ api, cny: Number(cny.toFixed(6)) });
  }
}

// ---- 费率表（预估，以火山引擎计费页为准）----
// ¥ / 1M tokens
const ARK_RATES: Record<string, { in: number; out: number }> = {
  "doubao-seed-2-1-turbo": { in: 0.8, out: 2 },
  "doubao-seed-2-1-pro": { in: 3, out: 9 },
  "doubao-seed-1-6-vision": { in: 1.5, out: 6 },
  default: { in: 1.5, out: 6 },
};

export function arkCost(model: string, promptTokens: number, completionTokens: number): number {
  const key = Object.keys(ARK_RATES).find((k) => k !== "default" && model.startsWith(k)) ?? "default";
  const r = ARK_RATES[key];
  return (promptTokens * r.in + completionTokens * r.out) / 1_000_000;
}

/** 录音识别：约 ¥0.2/小时（预估）；缺时长时按 5 分钟兜底 */
export function speechAucCost(durationMs: number): number {
  const ms = durationMs > 0 ? durationMs : 5 * 60_000;
  return (ms / 3_600_000) * 0.2;
}
