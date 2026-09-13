import { useState } from "react";
import {
  ArrowRight,
  Database,
  Rows3,
  ShieldCheck,
  Clock3,
  ListOrdered,
  Download,
  FileJson,
  Network,
  Settings2,
  Check,
  Copy,
} from "lucide-react";
import type {
  DataServiceConfig,
  DataTask,
  SheetView,
  Store,
} from "../lib/types";
import { TableHeading, fieldIcon } from "../components/TableHeading";
import { PROCESSING_STATUS, SERVICE_STATUS } from "../lib/status";
import { csv, download } from "../lib/engine";
import {
  listServiceDatasets,
  serviceDefinition,
  serviceStatus,
} from "../lib/services";
import {
  Badge,
  Dialog,
  Empty,
  formatTime,
  Notice,
  SearchBox,
  SourceIcon,
} from "../components/UI";

const serviceFilters = Object.values(SERVICE_STATUS).map(
  (status) => status.text,
);
type Filter = "全部服务状态" | (typeof serviceFilters)[number];

export default function DataServices({
  store,
  onOpen,
  onTasks,
  onSave,
}: {
  store: Store;
  onOpen: (id: string, view: SheetView) => void;
  onTasks: () => void;
  onSave: (config: DataServiceConfig) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("全部服务状态");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [modal, setModal] = useState<{
    taskId: string;
    kind: "preview" | "config" | "docs";
  } | null>(null);
  const datasets = listServiceDatasets(store);
  const filtered = datasets.filter(
    (dataset) =>
      (filter === "全部服务状态" || dataset.status === filter) &&
      [
        dataset.task.name,
        dataset.task.source,
        dataset.config?.name,
        dataset.config?.slug,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const selected = datasets.find(
    (dataset) => dataset.task.id === modal?.taskId,
  );

  return (
    <div className="page services-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DATA SERVICES</div>
          <h1>数据服务</h1>
          <p>
            仅展示清洗完成且校验通过的数据，可预览、导出和配置对外接口——保存后接口立即生效，可直接被外部系统调用。
          </p>
        </div>
      </div>
      <section className="card" aria-label="数据服务列表">
        <div className="list-filters services-toolbar">
          <span className="service-complete-label">
            <ShieldCheck size={15} aria-hidden="true" />
            {PROCESSING_STATUS.complete.text}（{datasets.length}）
          </span>
          <label className="service-config-filter">
            服务配置
            <select
              aria-label="服务配置状态筛选"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as Filter);
                setPage(1);
              }}
            >
              <option value="全部服务状态">
                全部服务状态（{datasets.length}）
              </option>
              {serviceFilters.map((status) => (
                <option key={status} value={status}>
                  {status}（
                  {
                    datasets.filter((dataset) => dataset.status === status)
                      .length
                  }
                  ）
                </option>
              ))}
            </select>
          </label>
          <SearchBox
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="搜索数据、服务名称或接口标识…"
          />
        </div>
        <div className="table-scroll">
          <table className="service-table">
            <thead>
              <tr>
                <th scope="col">
                  <TableHeading icon={Database}>
                    清洗数据 / 来源任务
                  </TableHeading>
                </th>
                <th scope="col">
                  <TableHeading icon={Rows3}>数据规模</TableHeading>
                </th>
                <th scope="col">
                  <TableHeading icon={ShieldCheck}>质量评分</TableHeading>
                </th>
                <th scope="col">
                  <TableHeading icon={Network}>服务配置状态</TableHeading>
                </th>
                <th scope="col">
                  <TableHeading icon={Clock3}>最近清洗</TableHeading>
                </th>
                <th scope="col">
                  <TableHeading icon={Settings2}>操作</TableHeading>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered
                .slice((current - 1) * pageSize, current * pageSize)
                .map((dataset) => {
                  const { task, run, config, status } = dataset;
                  return (
                    <tr key={task.id}>
                      <td>
                        <div className="task-name">
                          <SourceIcon type={task.sourceType} />
                          <div>
                            <button
                              onClick={() =>
                                setModal({ taskId: task.id, kind: "preview" })
                              }
                            >
                              {config?.name || task.name}
                            </button>
                            <small title={config ? task.name : task.source}>
                              {config ? `来源任务：${task.name}` : task.source}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <strong className="number">
                          {run.rows.length.toLocaleString()}
                        </strong>{" "}
                        行
                        <small className="service-subline">
                          {task.fields.length} 个字段
                        </small>
                      </td>
                      <td>
                        <span className="quality-value">
                          {run.afterScore}
                          <small> / 100</small>
                        </span>
                      </td>
                      <td>
                        <Badge
                          tone={
                            Object.values(SERVICE_STATUS).find(
                              (item) => item.text === status,
                            )!.tone
                          }
                        >
                          {status}
                        </Badge>
                        {config && (
                          <small
                            className="service-subline service-slug"
                            title={`/api/data-services/${config.slug}`}
                          >
                            {config.slug}
                          </small>
                        )}
                      </td>
                      <td className="secondary">{formatTime(run.time)}</td>
                      <td>
                        <div className="service-row-actions">
                          <button
                            className="text-button"
                            onClick={() =>
                              setModal({ taskId: task.id, kind: "preview" })
                            }
                          >
                            预览数据
                          </button>
                          <button
                            className="text-button"
                            onClick={() =>
                              setModal({ taskId: task.id, kind: "config" })
                            }
                          >
                            {!config
                              ? "配置服务"
                              : status === SERVICE_STATUS.outdated.text
                                ? "更新配置"
                                : "编辑配置"}
                          </button>
                          {config && (
                            <button
                              className="text-button"
                              onClick={() =>
                                setModal({ taskId: task.id, kind: "docs" })
                              }
                            >
                              接口文档
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <Empty
            title={datasets.length ? "没有匹配的数据" : "暂无清洗成果"}
            description={
              datasets.length
                ? "调整状态或搜索条件后重试。"
                : "在数据任务中完成清洗并通过校验后，有效结果会自动出现在这里。"
            }
            action={
              !datasets.length && (
                <button className="button primary" onClick={onTasks}>
                  前往数据任务
                  <ArrowRight size={14} />
                </button>
              )
            }
          />
        )}
        <div className="list-footer">
          <span>
            共 {filtered.length} 份清洗数据
            {filtered.length > 0 &&
              ` · 当前 ${(current - 1) * pageSize + 1}–${Math.min(current * pageSize, filtered.length)}`}
          </span>
          <div>
            <select
              aria-label="数据服务每页数量"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {[10, 20, 50].map((size) => (
                <option key={size} value={size}>
                  {size} 条/页
                </option>
              ))}
            </select>
            <button
              aria-label="数据服务上一页"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              上一页
            </button>
            <span>
              {current} / {pages}
            </span>
            <button
              aria-label="数据服务下一页"
              disabled={current === pages}
              onClick={() => setPage(current + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      </section>
      {selected && modal && (
        <Dialog
          key={`${selected.task.id}-${modal.kind}`}
          wide
          title={
            modal.kind === "preview"
              ? `${selected.task.name} · 清洗后数据`
              : modal.kind === "config"
                ? "配置数据服务"
                : "数据服务接口文档"
          }
          onClose={() => setModal(null)}
        >
          {modal.kind === "preview" ? (
            <CleanPreview
              task={selected.task}
              onOpen={() => {
                setModal(null);
                onOpen(selected.task.id, "cleaned");
              }}
            />
          ) : modal.kind === "config" ? (
            <ServiceForm
              task={selected.task}
              config={selected.config}
              onCancel={() => setModal(null)}
              onSave={(config) => {
                onSave(config);
                setModal({ taskId: selected.task.id, kind: "docs" });
              }}
            />
          ) : (
            selected.config && (
              <ServiceDocs
                task={selected.task}
                config={selected.config}
                onEdit={() =>
                  setModal({ taskId: selected.task.id, kind: "config" })
                }
              />
            )
          )}
        </Dialog>
      )}
    </div>
  );
}

function EndpointLine({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${path}`;
  const copyable = !path.includes("…");
  return (
    <div className="service-endpoint">
      <b>GET</b>
      <code>{url}</code>
      {copyable && (
        <button
          type="button"
          className="text-button service-endpoint-copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // 剪贴板不可用（如非安全上下文）时静默忽略，用户仍可手动选中复制
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "已复制" : "复制"}
        </button>
      )}
    </div>
  );
}

function CleanPreview({
  task,
  onOpen,
}: {
  task: DataTask;
  onOpen: () => void;
}) {
  const [page, setPage] = useState(1);
  const run = task.runs[0];
  const pages = Math.max(1, Math.ceil(run.rows.length / 10));
  const exportData = (format: "csv" | "json") =>
    download(
      `${task.name}-清洗后数据.${format}`,
      format === "csv"
        ? csv(run.rows, task.fields)
        : JSON.stringify(
            run.rows.map((row) =>
              Object.fromEntries(
                task.fields.map((field) => [
                  field.key,
                  row.values[field.key] ?? null,
                ]),
              ),
            ),
            null,
            2,
          ),
      format === "csv" ? "text/csv;charset=utf-8" : "application/json",
    );
  return (
    <div className="service-preview">
      <div className="service-preview-toolbar">
        <span>
          {run.rows.length} 行 · {task.fields.length} 个字段 · 质量{" "}
          {run.afterScore} 分
        </span>
        <div>
          <button
            className="button small"
            disabled={!run.rows.length}
            onClick={() => exportData("csv")}
          >
            <Download size={14} />
            导出 CSV
          </button>
          <button
            className="button small"
            disabled={!run.rows.length}
            onClick={() => exportData("json")}
          >
            <FileJson size={14} />
            导出 JSON
          </button>
        </div>
      </div>
      {run.validation.blocked && (
        <Notice warning>
          {run.validation.messages.join("；") ||
            "清洗结果未通过校验，请返回工作台处理。"}
        </Notice>
      )}
      <div className="table-scroll service-preview-table">
        <table>
          <thead>
            <tr>
              <th scope="col">
                <TableHeading icon={ListOrdered}>序号</TableHeading>
              </th>
              {task.fields.map((field) => (
                <th scope="col" key={field.key}>
                  <TableHeading icon={fieldIcon(field.type)}>
                    {field.label}
                  </TableHeading>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {run.rows.slice((page - 1) * 10, page * 10).map((row, index) => (
              <tr key={row.id}>
                <td>{(page - 1) * 10 + index + 1}</td>
                {task.fields.map((field) => (
                  <td key={field.key} title={row.values[field.key] ?? "NULL"}>
                    {row.values[field.key] ?? (
                      <span className="null-value">NULL</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!run.rows.length && (
        <Empty
          title="本次清洗没有保留数据"
          description="返回工作台检查清洗规则和异常数据。"
        />
      )}
      <div className="list-footer">
        <button className="text-button" onClick={onOpen}>
          查看来源任务
          <ArrowRight size={14} />
        </button>
        <div>
          <button disabled={page === 1} onClick={() => setPage(page - 1)}>
            上一页
          </button>
          <span>
            {page} / {pages}
          </span>
          <button disabled={page === pages} onClick={() => setPage(page + 1)}>
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}

function ServiceForm({
  task,
  config,
  onSave,
  onCancel,
}: {
  task: DataTask;
  config?: DataServiceConfig;
  onSave: (config: DataServiceConfig) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<DataServiceConfig>(() => ({
    taskId: task.id,
    runId: task.runs[0].id,
    name: config?.name || task.name,
    slug:
      config?.slug ||
      `dataset-${task.id.replace(/[^a-z0-9-]/g, "").slice(0, 32) || "data"}`,
    description: config?.description || "",
    fields: config
      ? config.fields.filter((key) =>
          task.fields.some((field) => field.key === key),
        )
      : task.fields
          .filter((field) => !field.sensitive)
          .map((field) => field.key),
    pageSize: config?.pageSize || 20,
    updatedAt: config?.updatedAt || "",
  }));
  const [error, setError] = useState("");
  return (
    <form
      className="service-form"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onSave(draft);
        } catch (error) {
          setError(
            error instanceof Error ? error.message : "保存失败，请重试。",
          );
        }
      }}
    >
      <div className="service-source-line">
        <Network size={16} />
        <span>
          {task.name} · {task.runs[0].rows.length} 行 ·{" "}
          {formatTime(task.runs[0].time)} 清洗
        </span>
        <Badge tone={PROCESSING_STATUS.complete.tone}>
          {PROCESSING_STATUS.complete.text}
        </Badge>
      </div>
      {config && config.runId !== task.runs[0].id && (
        <Notice>
          保存后，服务配置将使用本次最新清洗结果，接口立即生效返回最新数据。
        </Notice>
      )}
      <div className="form-columns">
        <label className="field">
          服务名称
          <input
            required
            maxLength={60}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="field">
          每页返回条数
          <select
            value={draft.pageSize}
            onChange={(e) =>
              setDraft({ ...draft, pageSize: Number(e.target.value) })
            }
          >
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size} 条
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        接口标识
        <input
          required
          maxLength={48}
          value={draft.slug}
          onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
          placeholder="例如 customer-data"
        />
        <small>2–48 位小写字母、数字或连字符，以字母开头。</small>
      </label>
      <EndpointLine path={`/api/data-services/${draft.slug || "…"}`} />
      <label className="field">
        服务说明
        <textarea
          maxLength={500}
          rows={2}
          placeholder="说明数据内容和适用场景（选填）"
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </label>
      <fieldset className="service-fields">
        <legend>
          输出字段（{draft.fields.length} / {task.fields.length}）
        </legend>
        <p>选择接口返回的字段。敏感字段默认不选，可按需勾选。</p>
        <div>
          {task.fields.map((field) => (
            <label key={field.key}>
              <input
                type="checkbox"
                checked={draft.fields.includes(field.key)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    fields: e.target.checked
                      ? [...draft.fields, field.key]
                      : draft.fields.filter((key) => key !== field.key),
                  })
                }
              />
              <span>{field.label}</span>
              {field.sensitive && <small>敏感</small>}
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <div role="alert">
          <Notice warning>{error}</Notice>
        </div>
      )}
      <p className="service-deployment-note">
        保存后接口立即生效，上方地址即可被外部系统直接调用，无需额外部署。
      </p>
      <div className="form-footer">
        <button type="button" className="button" onClick={onCancel}>
          取消
        </button>
        <button className="button primary" type="submit">
          <Settings2 size={15} />
          保存配置
        </button>
      </div>
    </form>
  );
}

function ServiceDocs({
  task,
  config,
  onEdit,
}: {
  task: DataTask;
  config: DataServiceConfig;
  onEdit: () => void;
}) {
  let definition: ReturnType<typeof serviceDefinition>;
  try {
    definition = serviceDefinition(task, config);
  } catch {
    return (
      <Notice warning>
        配置关联的清洗结果不可用，请返回列表处理数据并重新配置。
      </Notice>
    );
  }
  const status = serviceStatus(task, config);
  const current = task.runs.find((run) => run.id === config.runId)!;
  return (
    <div className="service-docs">
      <div className="service-docs-heading">
        <div>
          <h3>{config.name}</h3>
          {config.description && <p>{config.description}</p>}
        </div>
        <Badge
          tone={
            Object.values(SERVICE_STATUS).find((item) => item.text === status)
              ?.tone
          }
        >
          {status}
        </Badge>
      </div>
      <p className="service-deployment-note">
        接口已生效，可直接对外调用；以下响应示例为当前清洗结果的真实数据。
      </p>
      {status === SERVICE_STATUS.outdated.text && (
        <Notice warning>
          已产生新的清洗结果。接口地址不变，但目前仍返回下方这份旧版本数据，更新配置后立即切换为最新数据。
        </Notice>
      )}
      <EndpointLine path={`${definition.path}?page=1`} />
      <dl className="definition-list service-definition">
        <dt>来源任务</dt>
        <dd>{task.name}</dd>
        <dt>数据版本</dt>
        <dd>
          {formatTime(current.time)} · {current.rows.length} 行
        </dd>
        <dt>分页参数</dt>
        <dd>page：页码，从 1 开始；每页 {config.pageSize} 条</dd>
        <dt>输出字段</dt>
        <dd>{definition.fields.map((field) => field.label).join("、")}</dd>
        <dt>数据更新</dt>
        <dd>重新清洗后，更新配置即切换为最新数据，接口地址不变。</dd>
      </dl>
      <h4>响应示例 · 第 1 页</h4>
      <pre className="service-response" tabIndex={0}>
        {JSON.stringify(definition.exampleResponse, null, 2)}
      </pre>
      <div className="form-footer">
        <button className="button" onClick={onEdit}>
          编辑配置
        </button>
        <button
          className="button primary"
          onClick={() =>
            download(
              `${config.slug}-service.json`,
              JSON.stringify(definition, null, 2),
              "application/json",
            )
          }
        >
          <Download size={15} />
          导出服务配置
        </button>
      </div>
    </div>
  );
}
