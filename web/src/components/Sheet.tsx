import { runStatus } from "../lib/status";
import { useDeferredValue, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Columns3,
  Filter,
  ListOrdered,
  AlertTriangle,
  Search,
  ChevronLeft,
  ChevronRight,
  Download,
  X,
  Maximize2,
  Shield,
} from "lucide-react";
import type {
  DataRow,
  DataTask,
  Field,
  FieldType,
  SheetView,
} from "../lib/types";
import {
  analyze,
  csv,
  download,
  fieldStats,
  isEmpty,
  parseNumber,
} from "../lib/engine";
import { TableHeading, fieldIcon } from "./TableHeading";
import { Badge, Dialog, Empty, Notice, SearchBox, formatTime } from "./UI";
export type RowFilter = { name: string; ids: string[] } | null;
type Condition = { field: string; op: string; value: string };
export default function Sheet({
  task,
  view,
  setView,
  onFields,
  issueFilter,
  setIssueFilter,
}: {
  task: DataTask;
  view: SheetView;
  setView: (v: SheetView) => void;
  onFields: (fields: Field[]) => void;
  issueFilter: RowFilter;
  setIssueFilter: (v: RowFilter) => void;
}) {
  const run = task.runs[0];
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search);
  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sample, setSample] = useState(false);
  const [modal, setModal] = useState<"columns" | "filter" | "cell" | null>(
    null,
  );
  const [field, setField] = useState<Field | null>(null);
  const [cell, setCell] = useState<{
    row: DataRow;
    field: Field;
    address: string;
  } | null>(null);
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [join, setJoin] = useState("AND");
  const [draft, setDraft] = useState<Condition[]>([]);
  const [draftJoin, setDraftJoin] = useState("AND");
  const base =
    view === "cleaned"
      ? run?.rows || []
      : view === "exceptions"
        ? run?.exceptions.map((e) => e.row) || []
        : task.raw;
  const visible = task.fields.filter((f) => !f.hidden);
  const originals = useMemo(
    () => new Map(task.raw.map((r) => [r.id, r])),
    [task.raw],
  );
  const report = useMemo(
    () => analyze(task.raw, task.fields),
    [task.raw, task.fields],
  );
  const issueMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    report.issues.forEach((i) =>
      i.rows.forEach((id) => {
        const set = map.get(id) || new Set<string>();
        set.add(i.field);
        map.set(id, set);
      }),
    );
    return map;
  }, [report]);
  const changedSet = new Set(run?.changed);
  const removedSet = new Set(run?.deleted.map((r) => r.id));
  const filtered = useMemo(() => {
    let rows = base.filter(
      (r) =>
        (!query ||
          Object.values(r.values).some((v) =>
            String(v ?? "")
              .toLowerCase()
              .includes(query.toLowerCase()),
          )) &&
        (!issueFilter || issueFilter.ids.includes(r.id)),
    );
    if (conditions.length)
      rows = rows.filter((r) => {
        const matches = conditions.map((c) => {
          const v = r.values[c.field] ?? "",
            num = parseNumber(v),
            target = parseNumber(c.value);
          return (
            {
              包含: v.includes(c.value),
              不包含: !v.includes(c.value),
              等于: v === c.value,
              不等于: v !== c.value,
              为空: isEmpty(v),
              不为空: !isEmpty(v),
              大于: num !== null && target !== null && num > target,
              小于: num !== null && target !== null && num < target,
            }[c.op] || false
          );
        });
        return join === "AND" ? matches.every(Boolean) : matches.some(Boolean);
      });
    if (sort)
      rows = [...rows].sort((a, b) => {
        const av = a.values[sort.key] ?? "",
          bv = b.values[sort.key] ?? "";
        const numeric =
          task.fields.find((f) => f.key === sort.key)?.type === "数值";
        return (
          (numeric
            ? (parseNumber(av) ?? -Infinity) - (parseNumber(bv) ?? -Infinity)
            : av.localeCompare(bv, "zh-CN", { numeric: true })) *
          (sort.desc ? -1 : 1)
        );
      });
    return sample ? rows.slice(0, 100) : rows;
  }, [base, query, issueFilter, conditions, join, sort, sample, task.fields]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    safePage = Math.min(page, pages);
  function resize(f: Field, width: number) {
    onFields(
      task.fields.map((x) =>
        x.key === f.key
          ? { ...x, width: Math.min(360, Math.max(100, width)) }
          : x,
      ),
    );
  }
  const noOutput = (view === "cleaned" || view === "exceptions") && !run;
  return (
    <section className="sheet-panel">
      <div className="sheet-topbar">
        <div className="sheet-tabs" role="tablist" aria-label="数据视图">
          {[
            { id: "raw", name: "原始数据", count: task.raw.length },
            { id: "cleaned", name: "清洗后数据", count: run?.rows.length },
            {
              id: "exceptions",
              name: "异常数据",
              count: run?.exceptions.length,
            },
            { id: "history", name: "清洗记录", count: task.runs.length },
          ].map((t) => (
            <button
              role="tab"
              aria-selected={view === t.id}
              key={t.id}
              className={view === t.id ? "active" : ""}
              onClick={() => {
                setView(t.id as SheetView);
                setIssueFilter(null);
                setPage(1);
                setCell(null);
              }}
            >
              {t.name}
              {t.count !== undefined && <span>{t.count}</span>}
            </button>
          ))}
        </div>
        {view !== "history" && (
          <div className="sheet-pagination" aria-label="数据分页">
            <select
              aria-label="每页行数"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
                setCell(null);
              }}
            >
              {[10, 25, 50].map((n) => (
                <option value={n} key={n}>
                  {n} 行/页
                </option>
              ))}
            </select>
            <button
              disabled={safePage === 1}
              aria-label="上一页"
              onClick={() => {
                setPage(safePage - 1);
                setCell(null);
              }}
            >
              <ChevronLeft size={15} />
            </button>
            <span aria-live="polite">
              {safePage} / {pages}
            </span>
            <button
              disabled={safePage === pages}
              aria-label="下一页"
              onClick={() => {
                setPage(safePage + 1);
                setCell(null);
              }}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        )}
      </div>
      {view === "history" ? (
        <div className="run-history">
          {!task.runs.length ? (
            <Empty
              title="还没有清洗记录"
              description="执行清洗后，规则、影响行数和校验结果会记录在这里。"
            />
          ) : (
            task.runs.map((r, i) => (
              <div className="run-entry" key={r.id}>
                <div className="run-entry-top">
                  <span className="run-number">{task.runs.length - i}</span>
                  <div>
                    <h3>
                      第 {task.runs.length - i} 次清洗{" "}
                      <Badge tone={runStatus(r).tone}>
                        {runStatus(r).text}
                      </Badge>
                    </h3>
                    <p>
                      {formatTime(r.time)} · 执行 {r.rules.length} 条规则
                    </p>
                  </div>
                  <strong>
                    {r.beforeScore}
                    <span> → </span>
                    {r.afterScore}
                    <small> 分</small>
                  </strong>
                </div>
                <div className="run-stats">
                  <span>
                    修改 <b>{r.changed.length}</b>
                  </span>
                  <span>
                    删除 <b>{r.deleted.length}</b>
                  </span>
                  <span>
                    异常 <b>{r.exceptions.length}</b>
                  </span>
                  <span>
                    保留 <b>{r.rows.length}</b>
                  </span>
                </div>
                <details>
                  <summary>查看执行规则与删除明细</summary>
                  {r.impacts.map((x) => (
                    <p key={x.ruleId}>
                      {x.name}
                      <span>
                        {x.kind} {x.affected} 行
                      </span>
                    </p>
                  ))}
                  {r.deleted.length > 0 && (
                    <button
                      className="text-button"
                      onClick={() =>
                        download(
                          "删除记录.csv",
                          csv(r.deleted, task.fields),
                          "text/csv;charset=utf-8",
                        )
                      }
                    >
                      <Download size={14} />
                      导出本次删除记录
                    </button>
                  )}
                </details>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="sheet-toolbar">
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="搜索数据内容…"
            />
            <div className="sheet-statistics">
              <span>
                共 {filtered.length.toLocaleString()} 行 · {visible.length}/
                {task.fields.length} 列
              </span>
              <span className="sheet-legends">
                <span>
                  <i className="legend-dot changed" />
                  修改
                </span>
                <span>
                  <i className="legend-dot deleted" />
                  删除
                </span>
              </span>
            </div>
            <div className="sheet-tools">
              <button
                aria-label={
                  conditions.length ? `筛选 ${conditions.length}` : "筛选"
                }
                className={conditions.length ? "active" : ""}
                onClick={() => {
                  setDraft(
                    conditions.length
                      ? conditions
                      : [
                          {
                            field: task.fields[0]?.key || "",
                            op: "包含",
                            value: "",
                          },
                        ],
                  );
                  setDraftJoin(join);
                  setModal("filter");
                }}
              >
                <Filter size={15} />
                <span>
                  筛选{conditions.length > 0 ? ` ${conditions.length}` : ""}
                </span>
              </button>
              <button aria-label="字段" onClick={() => setModal("columns")}>
                <Columns3 size={15} />
                <span>字段</span>
              </button>
              <button
                aria-label={sample ? "取消抽样" : "抽样"}
                aria-pressed={sample}
                className={sample ? "active" : ""}
                onClick={() => {
                  setSample(!sample);
                  setPage(1);
                }}
              >
                <Search size={15} />
                <span>{sample ? "取消抽样" : "抽样"}</span>
              </button>
              <button
                disabled={!base.length}
                onClick={() =>
                  download(
                    task.name +
                      "-" +
                      {
                        raw: "原始数据",
                        cleaned: "清洗后数据",
                        exceptions: "异常数据",
                      }[view] +
                      ".csv",
                    csv(filtered, visible),
                    "text/csv;charset=utf-8",
                  )
                }
                aria-label="导出当前数据"
              >
                <Download size={16} />
              </button>
            </div>
          </div>
          {issueFilter && (
            <div className="filter-chip">
              <Filter size={13} />
              {issueFilter.name} · {filtered.length} 行
              <button
                aria-label="清除问题筛选"
                onClick={() => setIssueFilter(null)}
              >
                <X size={13} />
              </button>
            </div>
          )}
          {conditions.length > 0 && (
            <div className="filter-chip">
              已应用 {conditions.length} 个筛选条件（{join}）
              <button
                onClick={() => {
                  setConditions([]);
                  setPage(1);
                }}
              >
                清除
              </button>
            </div>
          )}
          {sample && (
            <div className="filter-chip">
              当前为固定抽样：筛选排序后的前 100 行
            </div>
          )}
          <div className={`formula-bar ${cell ? "has-selection" : ""}`}>
            <span className="cell-address">{cell?.address || "A1"}</span>
            <i>ƒx</i>
            <div
              className="formula-content"
              title={
                cell
                  ? `${cell.field.label} · ${cell.row.values[cell.field.key] ?? "NULL"}`
                  : undefined
              }
            >
              {cell ? (
                <>
                  <strong>{cell.field.label}</strong>
                  <span>{cell.row.values[cell.field.key] ?? "NULL"}</span>
                </>
              ) : (
                "点击单元格查看完整内容，点击字段名称查看统计"
              )}
            </div>
            {cell && (
              <div className="cell-actions">
                <button
                  className="text-button"
                  onClick={() => setModal("cell")}
                  title="查看完整内容"
                >
                  <Maximize2 size={13} />
                  <span>完整内容</span>
                </button>
                <button
                  className="text-button"
                  onClick={() => setField({ ...cell.field })}
                >
                  字段统计
                </button>
                <button
                  className="icon-button"
                  aria-label="关闭单元格详情"
                  onClick={() => setCell(null)}
                >
                  <X size={13} />
                </button>
              </div>
            )}
          </div>
          {noOutput ? (
            <Empty
              title={view === "cleaned" ? "还没有清洗结果" : "还没有异常数据集"}
              description="先在右侧生成清洗方案，预览影响后开始清洗。"
            />
          ) : !filtered.length ? (
            <Empty
              title={view === "exceptions" ? "没有异常记录" : "没有匹配的数据"}
              description={
                view === "exceptions"
                  ? "本次清洗没有分流异常数据。"
                  : "调整搜索或筛选条件后重试。"
              }
            />
          ) : (
            <div className="sheet-scroll">
              <table
                className="spreadsheet"
                style={{
                  width:
                    visible.reduce((sum, f) => sum + f.width, 44) +
                    (view === "exceptions" ? 260 : 0),
                }}
              >
                <colgroup>
                  <col style={{ width: 44 }} />
                  {visible.map((f) => (
                    <col key={f.key} style={{ width: f.width }} />
                  ))}
                  {view === "exceptions" && <col style={{ width: 260 }} />}
                </colgroup>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="row-index corner"
                      aria-label="序号"
                    >
                      <ListOrdered size={14} aria-hidden="true" />
                    </th>
                    {visible.map((f, index) => {
                      const Icon = fieldIcon(f.type);
                      return (
                        <th scope="col" key={f.key}>
                          <div className="column-letter">
                            {String.fromCharCode(65 + index)}
                          </div>
                          <div className="column-heading">
                            <button
                              onClick={() => setField({ ...f })}
                              aria-label={"查看字段 " + f.label}
                            >
                              <Icon size={13} aria-hidden="true" />
                              <span>{f.label}</span>
                              {f.sensitive && <Shield size={10} />}
                            </button>
                            <button
                              className="column-sort"
                              aria-label={"排序 " + f.label}
                              onClick={() => {
                                setSort(
                                  sort?.key === f.key
                                    ? sort.desc
                                      ? null
                                      : { key: f.key, desc: true }
                                    : { key: f.key, desc: false },
                                );
                                setPage(1);
                              }}
                            >
                              {sort?.key === f.key ? (
                                sort.desc ? (
                                  <ArrowDown size={12} />
                                ) : (
                                  <ArrowUp size={12} />
                                )
                              ) : (
                                <ArrowUpDown size={12} />
                              )}
                            </button>
                          </div>
                          <div
                            role="separator"
                            aria-label={"调整 " + f.label + " 列宽"}
                            aria-orientation="vertical"
                            aria-valuemin={100}
                            aria-valuemax={360}
                            aria-valuenow={f.width}
                            tabIndex={0}
                            className="column-resizer"
                            onKeyDown={(e) => {
                              if (e.key === "ArrowRight")
                                resize(f, f.width + 20);
                              if (e.key === "ArrowLeft")
                                resize(f, f.width - 20);
                            }}
                            onPointerDown={(e) => {
                              const el = e.currentTarget,
                                start = e.clientX,
                                width = f.width;
                              el.setPointerCapture(e.pointerId);
                              const move = (event: PointerEvent) =>
                                resize(f, width + event.clientX - start);
                              const stop = () => {
                                el.removeEventListener("pointermove", move);
                                el.removeEventListener("pointerup", stop);
                                el.removeEventListener("pointercancel", stop);
                              };
                              el.addEventListener("pointermove", move);
                              el.addEventListener("pointerup", stop);
                              el.addEventListener("pointercancel", stop);
                            }}
                          />
                        </th>
                      );
                    })}
                    {view === "exceptions" && (
                      <th scope="col">
                        <div className="column-letter">异常原因</div>
                        <TableHeading icon={AlertTriangle}>
                          处理说明
                        </TableHeading>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtered
                    .slice((safePage - 1) * pageSize, safePage * pageSize)
                    .map((row, index) => (
                      <tr
                        key={row.id}
                        className={
                          view === "raw" && removedSet.has(row.id)
                            ? "removed-row"
                            : ""
                        }
                      >
                        <th className="row-index" scope="row">
                          {(safePage - 1) * pageSize + index + 1}
                        </th>
                        {visible.map((f, col) => {
                          const value = row.values[f.key],
                            original = originals.get(row.id)?.values[f.key];
                          const changed =
                            view === "cleaned" &&
                            changedSet.has(row.id) &&
                            value !== original;
                          const problem =
                            view === "raw" &&
                            (issueMap.get(row.id)?.has(f.key) ||
                              issueMap.get(row.id)?.has("*"));
                          return (
                            <td
                              key={f.key}
                              className={`${changed ? "changed-cell " : ""}${problem ? "issue-cell " : ""}${f.type === "数值" ? "numeric " : ""}${cell?.row.id === row.id && cell.field.key === f.key ? "selected-cell" : ""}`}
                            >
                              <button
                                title={value ?? "NULL"}
                                onClick={() =>
                                  setCell({
                                    row,
                                    field: f,
                                    address: `${String.fromCharCode(65 + col)}${(safePage - 1) * pageSize + index + 1}`,
                                  })
                                }
                              >
                                {value === null ? (
                                  <span className="null-value">NULL</span>
                                ) : value === "" ? (
                                  <span className="null-value">空字符串</span>
                                ) : (
                                  value
                                )}
                                {changed && <i className="cell-change-dot" />}
                              </button>
                            </td>
                          );
                        })}
                        {view === "exceptions" && (
                          <td className="exception-reason">
                            {run?.exceptions
                              .find((e) => e.row.id === row.id)
                              ?.reasons.join("；")}
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {modal === "cell" && cell && (
        <Dialog
          title={`${cell.address} · ${cell.field.label}`}
          onClose={() => setModal(null)}
        >
          <p className="helper">当前视图中的完整单元格内容</p>
          <pre className="cell-full-value">
            {cell.row.values[cell.field.key] ?? "NULL"}
          </pre>
          {view === "cleaned" && (
            <>
              <p className="helper">原始内容</p>
              <pre className="cell-full-value">
                {originals.get(cell.row.id)?.values[cell.field.key] ?? "NULL"}
              </pre>
            </>
          )}
        </Dialog>
      )}
      {modal === "columns" && (
        <Dialog title="显示字段" onClose={() => setModal(null)}>
          <p className="helper">
            选择需要查看的字段。隐藏只影响预览，不会删除数据。
          </p>
          <div className="field-checks">
            {task.fields.map((f) => (
              <label key={f.key}>
                <input
                  type="checkbox"
                  checked={!f.hidden}
                  disabled={!f.hidden && visible.length === 1}
                  onChange={(e) =>
                    onFields(
                      task.fields.map((x) =>
                        x.key === f.key
                          ? { ...x, hidden: !e.target.checked }
                          : x,
                      ),
                    )
                  }
                />
                <span>
                  {f.label}
                  <small>{f.key}</small>
                </span>
                <Badge>{f.type}</Badge>
              </label>
            ))}
          </div>
        </Dialog>
      )}
      {modal === "filter" && (
        <Dialog title="筛选数据" onClose={() => setModal(null)} wide>
          <label className="field">
            条件关系
            <select
              value={draftJoin}
              onChange={(e) => setDraftJoin(e.target.value)}
            >
              <option value="AND">满足全部条件（AND）</option>
              <option value="OR">满足任一条件（OR）</option>
            </select>
          </label>
          {draft.map((c, i) => (
            <div className="condition-row" key={i}>
              <select
                aria-label={`筛选字段 ${i + 1}`}
                value={c.field}
                onChange={(e) =>
                  setDraft(
                    draft.map((d, j) =>
                      j === i ? { ...d, field: e.target.value } : d,
                    ),
                  )
                }
              >
                {task.fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`筛选运算符 ${i + 1}`}
                value={c.op}
                onChange={(e) =>
                  setDraft(
                    draft.map((d, j) =>
                      j === i ? { ...d, op: e.target.value } : d,
                    ),
                  )
                }
              >
                {[
                  "包含",
                  "不包含",
                  "等于",
                  "不等于",
                  "大于",
                  "小于",
                  "为空",
                  "不为空",
                ].map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <input
                aria-label={`筛选值 ${i + 1}`}
                disabled={["为空", "不为空"].includes(c.op)}
                value={c.value}
                onChange={(e) =>
                  setDraft(
                    draft.map((d, j) =>
                      j === i ? { ...d, value: e.target.value } : d,
                    ),
                  )
                }
              />
              <button
                className="icon-button"
                aria-label={`删除条件 ${i + 1}`}
                onClick={() => setDraft(draft.filter((_, j) => j !== i))}
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <button
            className="text-button"
            disabled={draft.length >= 5}
            onClick={() =>
              setDraft([
                ...draft,
                { field: task.fields[0].key, op: "包含", value: "" },
              ])
            }
          >
            + 添加条件
          </button>
          <div className="form-footer">
            <button
              className="button"
              onClick={() => {
                setConditions([]);
                setModal(null);
              }}
            >
              清除筛选
            </button>
            <button
              className="button primary"
              onClick={() => {
                setConditions(draft);
                setJoin(draftJoin);
                setPage(1);
                setModal(null);
              }}
            >
              应用筛选
            </button>
          </div>
        </Dialog>
      )}
      {field && (
        <FieldDetails
          field={field}
          rows={base}
          onClose={() => setField(null)}
          onSave={(f) => {
            onFields(task.fields.map((x) => (x.key === f.key ? f : x)));
            setField(null);
          }}
        />
      )}
    </section>
  );
}
function FieldDetails({
  field,
  rows,
  onClose,
  onSave,
}: {
  field: Field;
  rows: DataRow[];
  onClose: () => void;
  onSave: (f: Field) => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [type, setType] = useState<FieldType>(field.type);
  const [width, setWidth] = useState(field.width);
  const stats = fieldStats(rows, field);
  return (
    <Dialog title={field.label + " · 字段统计"} onClose={onClose}>
      <div className="field-detail-heading">
        <span className="source-icon blue">
          <Maximize2 size={20} />
        </span>
        <div>
          <h3>{field.label}</h3>
          <code>{field.key}</code>
        </div>
        {stats.primary && <Badge tone="green">主键候选</Badge>}
        {field.sensitive && <Badge tone="amber">敏感字段</Badge>}
      </div>
      <div className="field-stat-grid">
        {[
          ["总行数", stats.total],
          ["空值", stats.missing],
          ["唯一值", stats.unique],
          ["重复率", stats.duplicateRate + "%"],
        ].map(([label, value]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <h4>值分布 Top 5</h4>
      <div className="distribution">
        {stats.top.map(([value, count]) => (
          <div key={value}>
            <span title={value}>{value}</span>
            <div>
              <i
                style={{
                  width: (count / Math.max(1, stats.total)) * 100 + "%",
                }}
              />
            </div>
            <b>{count}</b>
          </div>
        ))}
      </div>
      <div className="form-columns">
        <label className="field">
          字段显示名称
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
          />
        </label>
        <label className="field">
          字段类型
          <select
            value={type}
            onChange={(e) => setType(e.target.value as FieldType)}
          >
            {["文本", "手机号", "数值", "日期", "邮箱", "身份证"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        列宽：{width}px
        <input
          type="range"
          min="100"
          max="360"
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
        />
      </label>
      <Notice>
        这里修改字段的显示与类型定义，原始值保持不变。实际转换请使用清洗规则，入库前会再次检查类型。
      </Notice>
      <div className="form-footer">
        <button
          className="button primary"
          disabled={!label.trim()}
          onClick={() =>
            onSave({
              ...field,
              label: label.trim(),
              type,
              width,
              sensitive: ["手机号", "邮箱", "身份证"].includes(type),
            })
          }
        >
          保存字段设置
        </button>
      </div>
    </Dialog>
  );
}
