import { describe, it, expect } from "vitest";
import {
  analyze,
  execute,
  inferFields,
  normalizeDate,
  normalizePhone,
  parseInstruction,
  parseNumber,
  csv,
} from "./engine";
import { makeRule, ruleCatalog } from "../data/rules";
import { createSeed, sampleRows } from "../data/seed";
import { checkDestination, commit } from "./warehouse";
import type { DataRow, Destination } from "./types";
const rows = (values: Record<string, string | null>[]): DataRow[] =>
  values.map((values, i) => ({ id: String(i), values }));
function rule(id: string, input: DataRow[]) {
  return makeRule(
    ruleCatalog.find((d) => d.id === id)!,
    inferFields(input),
  );
}
describe("data parsing and transformations", () => {
  it("normalizes dates and rejects calendar overflow", () => {
    expect(normalizeDate("2026/9/1")).toBe("2026-09-01");
    expect(normalizeDate("2026年9月1日")).toBe("2026-09-01");
    expect(normalizeDate("09/01/2026")).toBe("2026-09-01");
    expect(normalizeDate("2026-02-30")).toBeNull();
  });
  it("normalizes phone and currency without inventing missing digits", () => {
    expect(normalizePhone("+86 138-1234-5678")).toBe("13812345678");
    expect(normalizePhone("13800")).toBe("13800");
    expect(parseNumber("12,500元")).toBe(12500);
    expect(parseNumber("125万元")).toBe(1250000);
    expect(parseNumber("12%")).toBe(0.12);
    expect(parseNumber("未知")).toBeNull();
  });
  it("keeps originals unchanged and accounts for every row across outputs", () => {
    const seed = createSeed(),
      task = seed.tasks[0],
      original = JSON.stringify(task.raw),
      run = execute(task.raw, task.fields, task.plan);
    expect(JSON.stringify(task.raw)).toBe(original);
    expect(run.rows.length + run.deleted.length + run.exceptions.length).toBe(
      task.raw.length,
    );
    expect(run.deleted).toHaveLength(2);
    expect(run.exceptions).toHaveLength(2);
    expect(run.validation.blocked).toBe(false);
    expect(run.afterScore).toBeGreaterThan(run.beforeScore);
  });
  it("preserves true NULL values and routes incomplete identity records separately", () => {
    const input = rows([
      { 手机号: "-", 客户姓名: "甲" },
      { 手机号: null, 客户姓名: "乙" },
    ]);
    const f = inferFields(input);
    const run = execute(
      input,
      f,
      [
        rule("null", input),
        rule("customer-dedup", input),
        rule("empty-exception", input),
      ].map((r) =>
        r.operation === "deduplicate" ? { ...r, params: { keep: "first" } } : r,
      ),
    );
    expect(run.exceptions).toHaveLength(2);
    expect(run.deleted).toHaveLength(0);
    expect(run.exceptions[0].row.values.手机号).toBeNull();
  });
  it("supports custom suffix deduplication with time-based retention", () => {
    const input = rows([
      { 客户姓名: "甲", 手机号: "13812345678", 更新时间: "2026-09-01" },
      { 客户姓名: "甲", 手机号: "13912345678", 更新时间: "2026-09-02" },
    ]);
    const fields = inferFields(input);
    const match = parseInstruction(
      "客户名称一样且手机号后8位一样，保留更新时间最新记录",
      fields,
    )!;
    expect(match.custom).toBe(true);
    const run = execute(input, fields, match.rules);
    expect(run.rows).toHaveLength(1);
    expect(run.rows[0].values.手机号).toBe("13912345678");
  });
  it("rejects unsupported language instead of running arbitrary instructions", () => {
    expect(
      parseInstruction("运行一段 Python 代码", inferFields(sampleRows())),
    ).toBeNull();
  });
  it("blocks financial loss even when format quality improves", () => {
    const input = rows([
      {
        客户姓名: "甲",
        手机号: "13812345678",
        金额: "100",
        更新时间: "2026-09-01",
      },
      {
        客户姓名: "甲",
        手机号: "13812345678",
        金额: "200",
        更新时间: "2026-09-02",
      },
    ]);
    const run = execute(input, inferFields(input), [
      rule("customer-dedup", input),
    ]);
    expect(run.validation.blocked).toBe(true);
    expect(run.validation.metrics[0].loss).toBeCloseTo(1 / 3);
  });
  it("counts changes by retained row, not by operations", () => {
    const input = rows([{ 手机号: " +86 138-1234-5678 ", 地区: "HLJ" }]);
    const run = execute(input, inferFields(input), [
      rule("trim", input),
      rule("phone", input),
      rule("region", input),
    ]);
    expect(run.changed).toHaveLength(1);
    expect(run.rows[0].values.地区).toBe("黑龙江省");
  });
  it("fills median and retains leading NULL in forward fill", () => {
    const input = rows([{ 金额: "10" }, { 金额: null }, { 金额: "30" }]);
    expect(
      execute(input, inferFields(input), [rule("median", input)]).rows[1].values
        .金额,
    ).toBe("20");
    const leading = rows([{ 备注: null }, { 备注: "B" }, { 备注: null }]);
    expect(
      execute(leading, inferFields(leading), [
        rule("forward", leading),
      ]).rows.map((r) => r.values.备注),
    ).toEqual([null, "B", "B"]);
  });
  it("checks rule params and dictionary structure", () => {
    const input = sampleRows();
    const r = rule("enum", input);
    r.params.mapping = "[]";
    expect(() => execute(input, inferFields(input), [r])).toThrow("字典");
  });
  it("exports CSV safely with quoting and no fake null text", () => {
    const input = rows([{ 姓名: 'a,"b', 备注: "=1+1", 值: null }]);
    const output = csv(input, inferFields(input));
    expect(output).toContain('"a,""b"');
    expect(output).toContain('"\'=1+1"');
    expect(output).not.toContain("NULL");
  });
  it("infers Chinese labels and sensitive semantic types", () => {
    const f = inferFields(sampleRows());
    expect(f.find((f) => f.key === "cust_phone")).toMatchObject({
      label: "手机号",
      type: "手机号",
      sensitive: true,
    });
    expect(analyze([], f).score).toBe(0);
  });
});
describe("additional cleaning boundaries", () => {
  it("orders mixed date formats and rejects impossible times", () => {
    const input = rows([
      { 客户姓名: "甲", 手机号: "13812345678", 更新时间: "2026/9/2 9:00:00" },
      {
        客户姓名: "甲",
        手机号: "13812345678",
        更新时间: "2026-10-01 08:00:00",
      },
    ]);
    expect(
      execute(input, inferFields(input), [rule("customer-dedup", input)])
        .rows[0].id,
    ).toBe("1");
    expect(normalizeDate("2026-09-01 25:00:00")).toBeNull();
  });
  it("matches masking before general phone normalization", () => {
    const input = rows([{ 手机号: "13812345678" }]);
    const match = parseInstruction("手机号脱敏", inferFields(input))!;
    expect(
      execute(input, inferFields(input), match.rules).rows[0].values.手机号,
    ).toBe("138****5678");
  });
  it("keeps disabled rules out of execution and impact counts", () => {
    const input = rows([{ 姓名: " 甲 " }]);
    const disabled = { ...rule("trim", input), enabled: false };
    const run = execute(input, inferFields(input), [disabled]);
    expect(run.rows[0].values.姓名).toBe(" 甲 ");
    expect(run.impacts).toHaveLength(0);
  });
  it("preserves missing numeric values and isolates unparseable numbers", () => {
    const input = rows([{ 金额: null }, { 金额: "1万元" }, { 金额: "未知" }]);
    const run = execute(input, inferFields(input), [rule("number", input)]);
    expect(run.rows.map((r) => r.values.金额)).toEqual([null, "10000"]);
    expect(run.exceptions).toHaveLength(1);
    expect(run.deleted).toHaveLength(0);
  });
});
describe("local warehouse confirmation", () => {
  it("creates, appends, replaces and upserts only validated results", () => {
    let store = createSeed();
    const task = store.tasks[1];
    const mappings = Object.fromEntries(
      task.fields.map((f, i) => [f.key, "c" + i]),
    );
    const types = Object.fromEntries(
      task.fields.map((f) => [f.key, "VARCHAR(255)"]),
    );
    const d: Destination = {
      connection: "demo",
      database: "standard",
      table: "orders",
      mode: "新建表",
      primaryKey: "order_id",
      mappings,
      types,
    };
    store = commit(store, task, d);
    expect(store.warehouses.at(-1)?.rows).toHaveLength(24);
    expect(() => checkDestination(d, task.runs[0], store.warehouses)).toThrow(
      "已存在",
    );
    store = commit(store, task, { ...d, mode: "追加数据" });
    expect(store.warehouses.at(-1)?.rows).toHaveLength(48);
    store = commit(store, task, { ...d, mode: "覆盖表" });
    expect(store.warehouses.at(-1)?.rows).toHaveLength(24);
    store = commit(store, task, { ...d, mode: "增量更新" });
    expect(store.warehouses.at(-1)?.rows).toHaveLength(24);
  });
  it("does not allow unsafe identifiers or duplicate mapped columns", () => {
    const store = createSeed(),
      task = store.tasks[1];
    const d: Destination = {
      connection: "demo",
      database: "standard",
      table: "bad; drop table x",
      mode: "新建表",
      primaryKey: "",
      mappings: { a: "a" },
      types: {},
    };
    expect(() => checkDestination(d, task.runs[0], store.warehouses)).toThrow(
      "表名",
    );
  });
});
