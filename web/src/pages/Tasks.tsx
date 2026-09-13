import { useState } from "react";
import {
  ArrowRight,
  ListTodo,
  Activity,
  Database,
  Rows3,
  ShieldCheck,
  Clock3,
  Settings2,
  ArrowUpRight,
  CheckCircle2,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import type { DataTask, MediaTask } from "../lib/types";
import { MEDIA_KIND_LABEL } from "../lib/media";
import { TableHeading } from "../components/TableHeading";
import { PROCESSING_STATUS, taskStatus, importStatus } from "../lib/status";
import { analyze } from "../lib/engine";
import {
  Badge,
  Empty,
  SearchBox,
  SourceIcon,
  formatTime,
} from "../components/UI";
import { sourceOptions } from "../components/CreateTask";
import TaskProgress from "../components/TaskProgress";
const MEDIA_STATUS_TONE = {
  running: "blue",
  succeeded: "green",
  failed: "red",
} as const;
const MEDIA_STATUS_TEXT = {
  running: "处理中",
  succeeded: "已完成",
  failed: "处理失败",
} as const;
export default function Tasks({
  tasks,
  mediaTasks,
  onCreate,
  onOpen,
  onOpenMedia,
}: {
  tasks: DataTask[];
  mediaTasks: MediaTask[];
  onCreate: (type?: string) => void;
  onOpen: (id: string) => void;
  onOpenMedia: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("全部任务");
  const [page, setPage] = useState(1);
  const statusCounts: Record<string, number> = { 全部任务: tasks.length };
  for (const task of tasks) {
    const status = taskStatus(task).text;
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  const filtered = tasks.filter(
    (t) =>
      (t.name + t.source).toLowerCase().includes(search.toLowerCase()) &&
      (filter === "全部任务" || taskStatus(t).text === filter),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 8)),
    current = Math.min(page, pages);
  return (
    <div className="page tasks-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">DATA TASKS</div>
          <h1>数据任务</h1>
          <p>选择接入方式，AI 帮你完成解析、清洗与入库。</p>
        </div>
        <button className="button primary" onClick={() => onCreate()}>
          <Plus size={16} />
          创建数据任务
        </button>
      </div>
      <section className="task-start" aria-label="数据接入方式">
        <div className="start-sources">
          {sourceOptions.map((s) => (
            <button
              key={s.name}
              disabled={s.later}
              onClick={() => onCreate(s.name)}
            >
              <s.icon size={22} />
              <strong>{s.name}</strong>
              <span>{s.later ? "即将支持" : s.description}</span>
              {!s.later && <ArrowUpRight size={14} />}
            </button>
          ))}
        </div>
      </section>
      <section className="card" aria-label="数据任务列表">
        <div className="list-filters">
          <div className="pill-tabs" role="group" aria-label="任务状态筛选">
            {[
              "全部任务",
              ...Object.values(PROCESSING_STATUS).map((status) => status.text),
            ].map((s) => (
              <button
                className={filter === s ? "active" : ""}
                aria-pressed={filter === s}
                key={s}
                onClick={() => {
                  setFilter(s);
                  setPage(1);
                }}
              >
                {s}（{statusCounts[s] ?? 0}）
              </button>
            ))}
          </div>
          <div className="task-list-actions">
            <span className="task-sort-note">
              <SlidersHorizontal size={13} />
              按最近更新排列
            </span>
            <SearchBox
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="搜索任务名称或来源…"
            />
          </div>
        </div>
        <div className="table-scroll">
          <table className="task-table">
            <thead>
              <tr>
                <th scope="col">
                  <TableHeading icon={ListTodo}>任务名称 / 来源</TableHeading>
                </th>
                <th scope="col">
                  <TableHeading icon={Activity}>处理状态</TableHeading>
                </th>
                <th scope="col">
                  <TableHeading icon={Database}>入库状态</TableHeading>
                </th>
                <th scope="col">
                  <TableHeading icon={Rows3}>数据量</TableHeading>
                </th>
                <th scope="col">
                  <TableHeading icon={ShieldCheck}>质量评分</TableHeading>
                </th>
                <th scope="col">
                  <TableHeading icon={Clock3}>最近更新</TableHeading>
                </th>
                <th scope="col">
                  <TableHeading icon={Settings2}>操作</TableHeading>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...filtered]
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice((current - 1) * 8, current * 8)
                .map((t) => {
                  const status = taskStatus(t),
                    storageStatus = importStatus(t),
                    r = t.runs[0];
                  return (
                    <tr key={t.id}>
                      <td>
                        <div className="task-name">
                          <SourceIcon type={t.sourceType} />
                          <div>
                            <button onClick={() => onOpen(t.id)}>
                              {t.name}
                            </button>
                            <small>{t.source}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge tone={status.tone}>{status.text}</Badge>
                        <TaskProgress task={t} />
                      </td>
                      <td>
                        {storageStatus ? (
                          <Badge tone={storageStatus.tone}>
                            {storageStatus.text}
                          </Badge>
                        ) : (
                          <span
                            className="secondary"
                            title="清洗完成后可确认入库"
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td>
                        <strong className="number">
                          {t.raw.length.toLocaleString()}
                        </strong>
                        <small> 行</small>
                      </td>
                      <td>
                        <span className="quality-value">
                          {r?.afterScore ?? analyze(t.raw, t.fields).score}
                          <small> / 100</small>
                        </span>
                      </td>
                      <td className="secondary">{formatTime(t.updatedAt)}</td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => onOpen(t.id)}
                        >
                          打开工作台
                          <ArrowRight size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {!filtered.length && (
          <Empty
            title="没有匹配的任务"
            description="调整筛选条件，或创建一个数据任务。"
          />
        )}
        <div className="list-footer">
          <span>共 {filtered.length} 个任务</span>
          <div>
            <button
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              上一页
            </button>
            <span>
              {current} / {pages}
            </span>
            <button
              disabled={current === pages}
              onClick={() => setPage(current + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      </section>
      {mediaTasks.length > 0 && (
        <section className="card media-task-list" aria-label="媒体任务列表">
          <div className="list-filters">
            <strong>媒体任务</strong>
            <span className="task-sort-note">图片 / 音频 / 视频，按最近更新排列</span>
          </div>
          <div className="table-scroll">
            <table className="task-table">
              <thead>
                <tr>
                  <th scope="col">
                    <TableHeading icon={ListTodo}>任务名称 / 文件</TableHeading>
                  </th>
                  <th scope="col">
                    <TableHeading icon={Activity}>处理状态</TableHeading>
                  </th>
                  <th scope="col">
                    <TableHeading icon={Clock3}>最近更新</TableHeading>
                  </th>
                  <th scope="col">
                    <TableHeading icon={Settings2}>操作</TableHeading>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...mediaTasks]
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="task-name">
                          <SourceIcon type={MEDIA_KIND_LABEL[t.kind]} />
                          <div>
                            <button onClick={() => onOpenMedia(t.id)}>{t.name}</button>
                            <small>{t.filename}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge tone={MEDIA_STATUS_TONE[t.status]}>{MEDIA_STATUS_TEXT[t.status]}</Badge>
                      </td>
                      <td className="secondary">{formatTime(t.updatedAt)}</td>
                      <td>
                        <button className="text-button" onClick={() => onOpenMedia(t.id)}>
                          打开工作台
                          <ArrowRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="page-note">
        <ShieldIcon />
        原始数据、清洗方案、执行记录和入库结果，始终关联到同一个任务。
      </p>
    </div>
  );
}
function ShieldIcon() {
  return <CheckCircle2 size={13} />;
}
