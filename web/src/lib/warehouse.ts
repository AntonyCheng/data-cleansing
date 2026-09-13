import type {
  DataRow,
  DataTask,
  Destination,
  Run,
  Store,
  Warehouse,
} from "./types";
import { isEmpty } from "./engine";
export function targetId(d: Destination) {
  return `${d.connection}/${d.database}/${d.table}`;
}
export function checkDestination(
  destination: Destination,
  run: Run,
  warehouses: Warehouse[],
) {
  if (run.validation.blocked)
    throw new Error("业务指标校验未通过，请先调整清洗规则。");
  if (!run.rows.length) throw new Error("没有可以入库的数据。");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(destination.table))
    throw new Error("表名请使用英文字母、数字和下划线，且不能以数字开头。");
  const columns = Object.values(destination.mappings);
  if (
    columns.some((c) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c)) ||
    new Set(columns).size !== columns.length
  )
    throw new Error("目标字段名须为唯一的英文标识符。");
  const existing = warehouses.find(
    (w) => targetId(w.destination) === targetId(destination),
  );
  if (destination.mode === "新建表" && existing)
    throw new Error("目标表已存在，请选择其他表名或写入方式。");
  if (["追加数据", "增量更新"].includes(destination.mode) && existing) {
    const current = Object.values(existing.destination.mappings)
      .sort()
      .join("|");
    if (current !== columns.sort().join("|"))
      throw new Error("字段结构与目标表不一致，不能追加或增量更新。");
  }
  if (destination.mode === "增量更新") {
    const key = destination.primaryKey;
    if (!key || !Object.hasOwn(destination.mappings, key))
      throw new Error("请选择增量更新的主键。");
    if (run.rows.some((r) => isEmpty(r.values[key])))
      throw new Error("主键中存在空值，请先处理。");
    if (new Set(run.rows.map((r) => r.values[key])).size !== run.rows.length)
      throw new Error("主键存在重复，不能进行增量更新。");
  }
}
export function commit(store: Store, task: DataTask, d: Destination): Store {
  const run = task.runs[0];
  if (!run) throw new Error("请先执行清洗并校验结果。");
  checkDestination(d, run, store.warehouses);
  const existing = store.warehouses.find(
    (w) => targetId(w.destination) === targetId(d),
  );
  const incoming = run.rows.map((row) => ({
    id: crypto.randomUUID(),
    values: Object.fromEntries(
      Object.entries(d.mappings).map(([key, target]) => [
        target,
        row.values[key] ?? null,
      ]),
    ),
  }));
  let rows: DataRow[] = incoming;
  if (existing && d.mode === "追加数据") rows = [...existing.rows, ...incoming];
  if (existing && d.mode === "增量更新") {
    const key = d.mappings[d.primaryKey];
    const merged = new Map(existing.rows.map((r) => [r.values[key], r]));
    incoming.forEach((r) => merged.set(r.values[key], r));
    rows = [...merged.values()];
  }
  const now = new Date().toISOString();
  const warehouse: Warehouse = {
    id: existing?.id || crypto.randomUUID(),
    destination: structuredClone(d),
    rows,
    taskId: task.id,
    runId: run.id,
    updatedAt: now,
  };
  return {
    ...store,
    warehouses: [
      ...store.warehouses.filter((w) => w.id !== warehouse.id),
      warehouse,
    ],
    tasks: store.tasks.map((t) =>
      t.id === task.id
        ? {
            ...t,
            storedRunId: run.id,
            destination: d,
            storedAt: now,
            updatedAt: now,
          }
        : t,
    ),
  };
}
export function ddl(d: Destination) {
  const fields = Object.entries(d.mappings).map(
    ([key, name]) => `  \`${name}\` ${d.types[key] || "VARCHAR(255)"}`,
  );
  if (d.primaryKey && d.mappings[d.primaryKey])
    fields.push(`  PRIMARY KEY (\`${d.mappings[d.primaryKey]}\`)`);
  return `CREATE TABLE \`${d.database}\`.\`${d.table}\` (\n${fields.join(",\n")}\n);`;
}
