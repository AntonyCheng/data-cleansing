import { runStatus } from "../lib/status";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Database,
  ShieldCheck,
  Columns3,
  Type,
} from "lucide-react";
import type { DataTask, Destination, Store } from "../lib/types";
import { checkDestination, ddl } from "../lib/warehouse";
import { parseNumber, normalizeDate, sqlType } from "../lib/engine";
import { TableHeading } from "./TableHeading";
import { Badge, Dialog, Notice } from "./UI";
export default function ImportDialog({
  task,
  store,
  onConfirm,
  onClose,
}: {
  task: DataTask;
  store: Store;
  onConfirm: (d: Destination) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dest, setDest] = useState<Destination>({
    connection: "本地演示数仓",
    database: "standard",
    table: "clean_" + task.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12),
    mode: "新建表",
    primaryKey: "",
    mappings: Object.fromEntries(
      task.fields.map((f, i) => [
        f.key,
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.key) ? f.key : "field_" + (i + 1),
      ]),
    ),
    types: Object.fromEntries(task.fields.map((f) => [f.key, sqlType(f.type)])),
  });
  const run = task.runs[0];
  const targets = useMemo(
    () =>
      store.warehouses.filter(
        (w) =>
          w.destination.connection === dest.connection &&
          w.destination.database === dest.database,
      ),
    [store.warehouses, dest.connection, dest.database],
  );
  function next() {
    try {
      checkDestination(dest, run, store.warehouses);
      for (const f of task.fields) {
        const type = dest.types[f.key];
        if (
          type.startsWith("DECIMAL") &&
          run.rows.some(
            (r) =>
              r.values[f.key] !== null && parseNumber(r.values[f.key]) === null,
          )
        )
          throw new Error(
            `${f.label}仍有无法转换为数值的内容，请调整类型或清洗规则。`,
          );
        if (
          type === "DATETIME" &&
          run.rows.some(
            (r) =>
              r.values[f.key] !== null && !normalizeDate(r.values[f.key] || ""),
          )
        )
          throw new Error(`${f.label}仍有无效日期，请先处理。`);
      }
      setError("");
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "入库配置无效");
    }
  }
  return (
    <Dialog
      title={step === 1 ? "确认入库 · 配置目标" : "确认入库 · 最后检查"}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="import-heading">
        <span className="source-icon mint">
          <Database size={23} />
        </span>
        <div>
          <h3>{task.name}</h3>
          <p>
            {run.rows.length} 行清洗结果 · {task.fields.length} 个字段
          </p>
        </div>
        <Badge tone={runStatus(run).tone}>{runStatus(run).text}</Badge>
      </div>
      {step === 1 ? (
        <>
          <Notice>
            前端模式会写入浏览器内的演示数据表，不连接真实数据库。写入前请确认目标、方式和字段映射。
          </Notice>
          <div className="form-columns">
            <label className="field">
              目标数据库
              <select
                value={dest.connection}
                onChange={(e) =>
                  setDest({ ...dest, connection: e.target.value })
                }
              >
                <option>本地演示数仓</option>
                <option>业务数据库（演示）</option>
              </select>
            </label>
            <label className="field">
              目标库
              <select
                value={dest.database}
                onChange={(e) => setDest({ ...dest, database: e.target.value })}
              >
                <option>standard</option>
                <option>analytics</option>
                <option>staging</option>
              </select>
            </label>
          </div>
          <div className="form-columns">
            <label className="field">
              目标表
              <input
                aria-label="目标表"
                list="existing-tables"
                value={dest.table}
                onChange={(e) => setDest({ ...dest, table: e.target.value })}
              />
              <datalist id="existing-tables">
                {targets.map((w) => (
                  <option key={w.id}>{w.destination.table}</option>
                ))}
              </datalist>
            </label>
            <label className="field">
              写入方式
              <select
                value={dest.mode}
                onChange={(e) =>
                  setDest({
                    ...dest,
                    mode: e.target.value as Destination["mode"],
                  })
                }
              >
                {["新建表", "覆盖表", "追加数据", "增量更新"].map((mode) => (
                  <option key={mode}>{mode}</option>
                ))}
              </select>
            </label>
          </div>
          {dest.mode === "覆盖表" && (
            <Notice warning>
              覆盖会替换目标演示表中的全部记录。下一步会再次显示本次影响，请仔细检查。
            </Notice>
          )}
          {dest.mode === "增量更新" && (
            <label className="field">
              更新主键
              <select
                value={dest.primaryKey}
                onChange={(e) =>
                  setDest({ ...dest, primaryKey: e.target.value })
                }
              >
                <option value="">请选择非空唯一字段</option>
                {task.fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="mapping-title">
            <h3>字段映射</h3>
            <span>
              <ShieldCheck size={13} />
              已自动匹配字段类型
            </span>
          </div>
          <div className="mapping-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <TableHeading icon={Columns3}>来源字段</TableHeading>
                  </th>
                  <th scope="col">
                    <TableHeading icon={Database}>目标字段名</TableHeading>
                  </th>
                  <th scope="col">
                    <TableHeading icon={Type}>数据类型</TableHeading>
                  </th>
                </tr>
              </thead>
              <tbody>
                {task.fields.map((f) => (
                  <tr key={f.key}>
                    <td>{f.label}</td>
                    <td>
                      <input
                        aria-label={f.label + "目标字段名"}
                        value={dest.mappings[f.key]}
                        onChange={(e) =>
                          setDest({
                            ...dest,
                            mappings: {
                              ...dest.mappings,
                              [f.key]: e.target.value,
                            },
                          })
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label={f.label + "入库类型"}
                        value={dest.types[f.key]}
                        onChange={(e) =>
                          setDest({
                            ...dest,
                            types: { ...dest.types, [f.key]: e.target.value },
                          })
                        }
                      >
                        {[
                          "VARCHAR(255)",
                          "VARCHAR(32)",
                          "DECIMAL(18,4)",
                          "DATETIME",
                          "TEXT",
                        ].map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-footer">
            <button className="button" onClick={onClose}>
              取消
            </button>
            <button
              className="button primary"
              disabled={run.validation.blocked}
              onClick={next}
            >
              检查入库配置
              <ArrowRight size={16} />
            </button>
          </div>
        </>
      ) : (
        <>
          <dl className="definition-list">
            <dt>目标位置</dt>
            <dd>
              {dest.connection} / {dest.database}.{dest.table}
            </dd>
            <dt>写入方式</dt>
            <dd>{dest.mode}</dd>
            <dt>本次记录</dt>
            <dd>{run.rows.length} 行</dd>
            <dt>目标现有记录</dt>
            <dd>
              {targets.find((w) => w.destination.table === dest.table)?.rows
                .length || 0}{" "}
              行
            </dd>
            <dt>异常数据</dt>
            <dd>{run.exceptions.length} 行保留在异常数据集，不写入</dd>
          </dl>
          <details open>
            <summary>自动生成的表结构（DDL）</summary>
            <pre>{ddl(dest)}</pre>
          </details>
          <Notice warning={dest.mode === "覆盖表"}>
            {dest.mode === "覆盖表"
              ? "确认后将覆盖目标演示表中的现有数据。"
              : "检查字段映射和清洗结果后，点击下方按钮确认写入本地演示表。"}
          </Notice>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-footer">
            <button
              disabled={busy}
              className="button"
              onClick={() => setStep(1)}
            >
              返回修改
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setTimeout(() => {
                  try {
                    onConfirm(dest);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "入库失败");
                    setBusy(false);
                  }
                }, 550);
              }}
            >
              <Check size={16} />
              {busy ? "正在写入…" : "确认入库"}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
