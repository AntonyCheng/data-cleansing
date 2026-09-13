import { useEffect, useState } from "react";
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Film,
  Image as ImageIcon,
  Network,
  Layers3,
  ListTodo,
  Menu,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { createSeed } from "./data/seed";
import { useRemoteStore } from "./lib/useRemoteStore";
import { clearSession, getToken, getUser, type AuthUser } from "./lib/api";
import type { DataTask, MediaTask, Rule, SheetView, Store } from "./lib/types";
import type { MediaKind } from "./lib/media";
import { download } from "./lib/engine";
import { commit } from "./lib/warehouse";
import { Badge, Dialog, Empty, Notice, SearchBox } from "./components/UI";
import CreateTask from "./components/CreateTask";
import Tasks from "./pages/Tasks";
import RuleLibrary from "./pages/RuleLibrary";
import DataServices from "./pages/DataServices";
import Auth from "./pages/Auth";
import { STATUS_GUIDE } from "./lib/status";
import { saveDataService } from "./lib/services";
import Workbench from "./pages/Workbench";
import MediaWorkbench from "./pages/MediaWorkbench";

// P0 之前的版本把整个工作区存在浏览器 localStorage 里，键名如下；
// 现在数据已经搬到服务端，这个键只用来检测"是不是老用户"，提供一次性导入入口。
const LEGACY_WORKSPACE_KEY = "kdata.studio.v2";
const navigation = [
  { id: "tasks", name: "数据任务", icon: ListTodo },
  { id: "rules", name: "清洗规则", icon: Layers3 },
  { id: "services", name: "数据服务", icon: Network },
];
const MEDIA_KIND_ICON = { image: ImageIcon, audio: AudioLines, video: Film } as const;
function currentRoute() {
  const route = location.hash.slice(1) || "tasks";
  const next =
    route === "data" ? "services" : route === "connections" ? "tasks" : route;
  if (next !== route) history.replaceState(null, "", `#${next}`);
  return next;
}
export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => (getToken() ? getUser() : null));
  if (!user) return <Auth onAuthed={() => setUser(getUser())} />;
  return <Workspace user={user} onLogout={() => { clearSession(); setUser(null); }} />;
}

function Workspace({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [store, setStore, storageError] = useRemoteStore<Store>(createSeed);
  const [route, setRoute] = useState(currentRoute);
  const [navOpen, setNavOpen] = useState(false);
  const [create, setCreate] = useState<{
    type?: string;
  } | null>(null);
  const [modal, setModal] = useState<"help" | "search" | "workspace" | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  useEffect(() => {
    const listener = () => {
      setRoute(currentRoute());
      window.scrollTo(0, 0);
      setNavOpen(false);
    };
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setModal("search");
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const mediaTasks = store.mediaTasks ?? [];
  const parts = route.split("/"),
    selected =
      parts[0] === "workbench"
        ? store.tasks.find((t) => t.id === parts[1])
        : undefined,
    selectedMedia =
      parts[0] === "media"
        ? mediaTasks.find((t) => t.id === parts[1])
        : undefined;
  const section = selected || selectedMedia
    ? "tasks"
    : navigation.some((n) => n.id === parts[0])
      ? parts[0]
      : "tasks";
  const go = (path: string) => {
    location.hash = path;
    setNavOpen(false);
  };
  const open = (id: string, view: SheetView = "raw") =>
    go(`workbench/${id}/${view}`);
  const openMedia = (id: string) => go(`media/${id}`);
  function updateTask(task: DataTask) {
    setStore((s) => ({
      ...s,
      tasks: s.tasks.map((t) => (t.id === task.id ? task : t)),
    }));
  }
  function updateMediaTask(task: MediaTask) {
    setStore((s) => ({
      ...s,
      mediaTasks: (s.mediaTasks ?? []).map((t) => (t.id === task.id ? task : t)),
    }));
  }
  function createMediaTask(kind: MediaKind, taskId: string, name: string, filename: string) {
    const record: MediaTask = {
      id: taskId,
      kind,
      name,
      filename,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "running",
    };
    setStore((s) => ({ ...s, mediaTasks: [record, ...(s.mediaTasks ?? [])] }));
    setCreate(null);
    openMedia(record.id);
    setToast("已提交，正在后台处理");
  }
  function saveRules(
    rules: Rule[],
    name: string,
    method: "AI 生成" | "手工创建",
  ) {
    setStore((s) => ({
      ...s,
      savedRules: [
        ...s.savedRules,
        {
          id: crypto.randomUUID(),
          name,
          description: rules.map((r) => r.name).join(" → "),
          scope: "我的清洗规则",
          rules: structuredClone(rules),
          fieldTypes: [
            ...new Set(
              selected?.fields
                .filter((f) =>
                  rules.some(
                    (r) =>
                      r.field === "*" ||
                      r.field === f.key ||
                      r.fields.includes(f.key),
                  ),
                )
                .map((f) => f.type) || ["文本"],
            ),
          ],
          createdBy: user.displayName,
          method,
          createdAt: new Date().toISOString(),
          uses: 0,
          version: 1,
        },
      ],
    }));
  }
  return (
    <div className={`app ${selected ? "is-workbench" : ""}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        跳到主要内容
      </a>
      {navOpen && (
        <button
          className="nav-overlay"
          aria-label="关闭导航"
          onClick={() => setNavOpen(false)}
        />
      )}
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <a className="brand" href="#tasks">
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <path
                d="M8 7v18M24 7L13 16l11 9M13 11v10"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span>
            KData<small>STUDIO</small>
          </span>
        </a>
        <button
          className="button primary sidebar-create"
          onClick={() => setCreate({})}
        >
          <Plus size={17} />
          创建数据任务
        </button>
        <span className="nav-section-label">工作空间</span>
        <nav aria-label="主导航">
          {navigation.map((n) => (
            <a
              key={n.id}
              href={"#" + n.id}
              className={section === n.id ? "active" : ""}
              onClick={() => setNavOpen(false)}
              aria-current={section === n.id ? "page" : undefined}
            >
              <n.icon size={19} strokeWidth={1.7} />
              <span>{n.name}</span>
              {n.id === "tasks" && <b>{store.tasks.length + mediaTasks.length}</b>}
            </a>
          ))}
        </nav>
        <div className="recent-tasks-nav">
          <span className="nav-section-label">最近任务</span>
          {[
            ...store.tasks.map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt, media: false as const })),
            ...mediaTasks.map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt, media: true as const, kind: t.kind })),
          ]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 3)
            .map((t) => {
              const isSelected = t.media ? selectedMedia?.id === t.id : selected?.id === t.id;
              const Icon = t.media ? MEDIA_KIND_ICON[t.kind] : FileSpreadsheet;
              return (
                <button
                  key={(t.media ? "media-" : "data-") + t.id}
                  className={isSelected ? "selected" : ""}
                  onClick={() => (t.media ? openMedia(t.id) : open(t.id))}
                >
                  <Icon size={14} />
                  <span>{t.name}</span>
                  {isSelected && <i />}
                </button>
              );
            })}
        </div>
        <div className="sidebar-bottom">
          <div className="local-data-note">
            <span>
              <ShieldCheck size={18} />
            </span>
            <div>
              <strong>安心整理每一份数据</strong>
              <p>原始数据保留，变更可追溯</p>
            </div>
          </div>
          <button className="sidebar-help" onClick={() => setModal("help")}>
            <BookOpen size={17} />
            使用指南
            <ArrowRight size={13} />
          </button>
          <div className="user-card">
            <span>{user.displayName.slice(0, 1)}</span>
            <div>
              <strong>{user.displayName}</strong>
              <small>{user.email}</small>
            </div>
            <button
              className="icon-button"
              aria-label="工作区信息"
              onClick={() => setModal("workspace")}
            >
              <ChevronDown size={15} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <main id="main-content" tabIndex={-1}>
          {!selected && (
            <button
              className="icon-button page-nav-toggle"
              aria-label="打开导航"
              aria-expanded={navOpen}
              onClick={() => setNavOpen(true)}
            >
              <Menu size={20} />
            </button>
          )}
          {storageError && (
            <div className="storage-error">
              <Notice warning>
                与服务端同步失败，更改暂时只保存在当前页面，请检查网络后刷新重试；建议先导出工作区备份。
              </Notice>
            </div>
          )}
          {selected ? (
            <Workbench
              key={selected.id + "-" + (parts[2] || "raw")}
              task={selected}
              store={store}
              onUpdate={updateTask}
              onImport={(d) => {
                const next = commit(store, selected, d);
                setStore(next);
              }}
              onSaveRule={saveRules}
              onTemplate={(rules, name) =>
                setStore((s) => ({
                  ...s,
                  templates: [
                    ...s.templates,
                    {
                      id: crypto.randomUUID(),
                      name,
                      description: rules
                        .filter((r) => r.enabled)
                        .map((r) => r.name)
                        .join(" → "),
                      rules: structuredClone(rules.filter((r) => r.enabled)),
                      createdAt: new Date().toISOString(),
                      uses: 0,
                    },
                  ],
                }))
              }
              onBack={() => go("tasks")}
              onOpenNav={() => setNavOpen(true)}
              notify={setToast}
              initialView={
                (["raw", "cleaned", "exceptions", "history"].includes(parts[2])
                  ? parts[2]
                  : "raw") as SheetView
              }
            />
          ) : selectedMedia ? (
            <MediaWorkbench
              key={selectedMedia.id}
              task={selectedMedia}
              onUpdate={updateMediaTask}
              onBack={() => go("tasks")}
              onOpenNav={() => setNavOpen(true)}
            />
          ) : section === "tasks" ? (
            <Tasks
              tasks={store.tasks}
              mediaTasks={mediaTasks}
              onCreate={(type) => setCreate({ type })}
              onOpen={open}
              onOpenMedia={openMedia}
            />
          ) : section === "rules" ? (
            <RuleLibrary
              store={store}
              onApply={(task, rules, id, template) => {
                setStore((s) => ({
                  ...s,
                  tasks: s.tasks.map((t) =>
                    t.id === task.id
                      ? {
                          ...t,
                          plan: template ? rules : [...t.plan, ...rules],
                          updatedAt: new Date().toISOString(),
                        }
                      : t,
                  ),
                  savedRules: s.savedRules.map((r) =>
                    r.id === id
                      ? {
                          ...r,
                          uses: r.uses + 1,
                          lastUsed: new Date().toISOString(),
                        }
                      : r,
                  ),
                  templates: s.templates.map((t) =>
                    t.id === id ? { ...t, uses: t.uses + 1 } : t,
                  ),
                }));
                open(task.id);
                setToast(
                  template
                    ? "模板已加载，请复核规则后执行"
                    : "规则已加入当前任务",
                );
              }}
              onSave={(rule) =>
                setStore((s) => ({ ...s, savedRules: [...s.savedRules, rule] }))
              }
              onShare={(id) =>
                setStore((s) => {
                  const rule = s.savedRules.find((r) => r.id === id)!;
                  return {
                    ...s,
                    savedRules: [
                      ...s.savedRules,
                      {
                        ...structuredClone(rule),
                        id: crypto.randomUUID(),
                        scope: "企业规则",
                        createdAt: new Date().toISOString(),
                        uses: 0,
                        lastUsed: undefined,
                      },
                    ],
                  };
                })
              }
              notify={setToast}
            />
          ) : (
            <DataServices
              store={store}
              onOpen={open}
              onTasks={() => go("tasks")}
              onSave={(config) => {
                const next = saveDataService(store, config);
                setStore(next);
                setToast("服务配置已保存，接口已生效可对外调用");
              }}
            />
          )}
        </main>
      </div>
      {create && (
        <Dialog title="创建数据任务" onClose={() => setCreate(null)} wide>
          <CreateTask
            initialType={create.type}
            onClose={() => setCreate(null)}
            onCreateMedia={createMediaTask}
            onCreate={(task) => {
              setStore((s) => ({
                ...s,
                tasks: [task, ...s.tasks],
              }));
              setCreate(null);
              open(task.id);
              setToast("数据解析完成，已进入工作台");
            }}
          />
        </Dialog>
      )}
      {modal && (
        <Dialog
          title={
            modal === "help"
              ? "从原始数据到数据服务"
              : modal === "workspace"
                ? "默认工作空间"
                : "搜索工作区"
          }
          onClose={() => setModal(null)}
          wide={modal === "help"}
        >
          {modal === "help" ? (
            <>
              <div className="guide-intro">
                <span className="ai-icon">
                  <Sparkles size={26} />
                </span>
                <div>
                  <h3>数据整理，在一个工作台完成</h3>
                  <p>你负责确认，AI 副驾驶帮你选择和解释处理方式。</p>
                </div>
              </div>
              <div className="guide-steps">
                {[
                  [
                    "接入数据",
                    "在创建任务中上传 CSV / XLSX，或连接真实数据库 / API 抓取数据（URL / 网页来源仍是样例）。",
                  ],
                  [
                    "查看数据与质量",
                    "在表格中搜索筛选、点击字段查看统计，在副驾驶定位具体问题。",
                  ],
                  [
                    "确认清洗方案",
                    "选择系统规则、一键推荐或自然语言规则，检查影响再开始执行。",
                  ],
                  [
                    "使用清洗成果",
                    "检查清洗报告并确认入库；在数据服务中预览、导出清洗结果，选择输出字段并保存服务配置。",
                  ],
                ].map(([title, desc], i) => (
                  <div key={title}>
                    <b>{i + 1}</b>
                    <span>
                      <h3>{title}</h3>
                      <p>{desc}</p>
                    </span>
                  </div>
                ))}
              </div>
              <section className="status-guide" aria-label="状态说明">
                <h3>状态说明</h3>
                {STATUS_GUIDE.map((group) => (
                  <section key={group.title}>
                    <h4>{group.title}</h4>
                    <p>{group.description}</p>
                    <dl>
                      {group.items.map((status) => (
                        <div key={status.text}>
                          <dt>
                            <Badge tone={status.tone}>{status.text}</Badge>
                          </dt>
                          <dd>{status.description}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
                <p>
                  只看最新一次清洗结果；若重新清洗后出现校验异常，该任务会从数据服务中移除，不回退展示旧结果。原始数据、异常数据和历史记录仍保留在任务工作台中。
                </p>
              </section>
              <Notice>
                数据库 / API 连接器为真实接入（只读查询，凭证加密存储）；AI
                对话本地规则优先匹配，未命中时由大模型理解并生成规则；数据服务保存配置后由服务端提供真实的对外接口，可直接调用。入库写入本地演示表，为本地演示。
              </Notice>
              <div className="form-footer">
                <button
                  className="button primary"
                  onClick={() => {
                    setModal(null);
                    setCreate({});
                  }}
                >
                  创建数据任务
                  <ArrowRight size={15} />
                </button>
              </div>
            </>
          ) : modal === "workspace" ? (
            <>
              <dl className="definition-list">
                <dt>工作区名称</dt>
                <dd>默认工作空间</dd>
                <dt>当前用户</dt>
                <dd>
                  {user.displayName} · {user.email}
                </dd>
                <dt>任务与规则</dt>
                <dd>
                  {store.tasks.length} 个任务 · {store.savedRules.length}{" "}
                  条自建及企业规则
                </dd>
                <dt>已入库数据表</dt>
                <dd>{store.warehouses.length} 张本地演示表</dd>
                <dt>数据保存位置</dt>
                <dd>服务端账号（登录后跨设备同步）</dd>
              </dl>
              <Notice>
                改动会在你停手约 800ms 后自动同步到服务端；此处导出的是当前工作区快照。
              </Notice>
              {typeof localStorage !== "undefined" && localStorage.getItem(LEGACY_WORKSPACE_KEY) && (
                <Notice warning>
                  检测到浏览器里还留着旧版（登录前）的本地工作区数据。
                  <div className="form-footer">
                    <button
                      className="button"
                      onClick={() => {
                        try {
                          const raw = localStorage.getItem(LEGACY_WORKSPACE_KEY);
                          if (!raw) return;
                          setStore(JSON.parse(raw) as Store);
                          localStorage.removeItem(LEGACY_WORKSPACE_KEY);
                          setToast("已导入本地历史工作区");
                        } catch {
                          setToast("导入失败，本地数据格式不正确");
                        }
                      }}
                    >
                      导入到当前账号
                    </button>
                  </div>
                </Notice>
              )}
              <div className="form-footer">
                <button
                  className="button"
                  onClick={() => {
                    download(
                      "kdata-studio-workspace.json",
                      JSON.stringify(store, null, 2),
                      "application/json",
                    );
                    setToast("工作区快照已导出");
                  }}
                >
                  <Download size={15} />
                  导出工作区
                </button>
                <button className="button" onClick={onLogout}>
                  退出登录
                </button>
              </div>
            </>
          ) : (
            <>
              <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="搜索任务或页面…"
              />
              <div className="task-picker">
                {navigation
                  .filter((n) => n.name.includes(search))
                  .map((n) => (
                    <button
                      key={n.id}
                      onClick={() => {
                        go(n.id);
                        setModal(null);
                      }}
                    >
                      <n.icon size={18} />
                      <strong>{n.name}</strong>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                {store.tasks
                  .filter((t) => t.name.includes(search))
                  .map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        open(t.id);
                        setModal(null);
                      }}
                    >
                      <FileSpreadsheet size={18} />
                      <span>
                        <strong>{t.name}</strong>
                        <small>{t.source}</small>
                      </span>
                      <ArrowRight size={15} />
                    </button>
                  ))}
                {!navigation.some((n) => n.name.includes(search)) &&
                  !store.tasks.some((t) => t.name.includes(search)) && (
                    <Empty
                      title="没有匹配结果"
                      description="试试其他任务名称。"
                    />
                  )}
              </div>
            </>
          )}
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
