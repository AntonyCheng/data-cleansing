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
  // 别名是必须的：下面 import 的页面组件也叫 Settings
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { createEmptyStore } from "./data/seed";
import { useRemoteStore } from "./lib/useRemoteStore";
import {
  clearSession,
  getToken,
  getUser,
  me,
  saveUser,
  setUnauthorizedHandler,
  UnauthorizedError,
  type AuthUser,
} from "./lib/api";
import type { DataTask, MediaTask, Rule, SheetView, Store } from "./lib/types";
import type { MediaKind } from "./lib/media";
import { download } from "./lib/engine";
import { commit } from "./lib/warehouse";
import { Badge, Dialog, Empty, Notice, SearchBox } from "./components/UI";
import CreateTask from "./components/CreateTask";
import Tasks from "./pages/Tasks";
import RuleLibrary from "./pages/RuleLibrary";
import DataServices from "./pages/DataServices";
import Settings from "./pages/Settings";
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
// 会话三态：checking 只在"本地有 token"时出现，是一次真实的服务端校验，
// 不是"未登录"——所以不能直接渲染 <Auth>，否则每次刷新都会闪一下登录页。
type Session =
  | { status: "checking" }
  | { status: "anon"; notice?: string }
  | { status: "authed"; user: AuthUser };

/** 启动校验最多等这么久。后端不可达时，nginx 要等自己的 proxy_connect_timeout（15 秒）
 *  才会返回 504，不能让人对着"正在校验登录状态…"干等——超时就按"拿不到服务端答复"处理，
 *  用缓存的用户信息进工作区（真正的失败会在随后同步工作区时以"同步失败"提示出来）。 */
const SESSION_CHECK_TIMEOUT_MS = 4000;

export default function App() {
  const [session, setSession] = useState<Session>(() => (getToken() ? { status: "checking" } : { status: "anon" }));

  // 统一登出通道：任何一路请求（含 WebSocket）发现 401 都会调到这里。
  // 这是"token 失效自动回登录页、不再卡在同步失败"的全部实现——全应用只有这一处清会话。
  // 必须声明在校验 effect 之前，保证校验返回前回调已就位。
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      setSession({ status: "anon", notice: "登录状态已失效，请重新登录。" });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // 启动校验：localStorage 里的 token 可能早就过期、或被换过 JWT_SECRET 作废，问一次服务端才算数
  useEffect(() => {
    if (session.status !== "checking") return;
    let cancelled = false;
    const settle = (next: Session) => {
      if (!cancelled) setSession(next);
    };
    // 网络不通 / 服务未启动 / 超过上面的闸门：用本地缓存的 user 继续进入工作区（离线容忍）。
    // 不能因为一次网络抖动或后端重启就把人踢回登录页——真正的失败会在同步时以"同步失败"提示出来。
    const fallback = () => {
      const cached = getUser();
      settle(cached ? { status: "authed", user: cached } : { status: "anon", notice: "无法连接服务端，请稍后重试。" });
    };
    const timer = setTimeout(fallback, SESSION_CHECK_TIMEOUT_MS);
    me()
      .then((u) => {
        clearTimeout(timer);
        saveUser(u); // 顺手刷新缓存的角色：绕过登录直接改库的角色在这里生效
        settle({ status: "authed", user: u });
      })
      .catch((e: unknown) => {
        clearTimeout(timer);
        if (e instanceof UnauthorizedError) {
          // 401：全局回调已经切成 anon，这里再兜一次，保证不会卡在 checking
          clearSession();
          settle({ status: "anon", notice: "登录状态已失效，请重新登录。" });
          return;
        }
        fallback();
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session.status]);

  if (session.status === "checking") return <SessionChecking />;
  if (session.status === "anon") {
    return (
      <Auth
        notice={session.notice}
        onAuthed={(user) => setSession({ status: "authed", user })}
      />
    );
  }
  return (
    <Workspace
      user={session.user}
      onLogout={() => {
        clearSession();
        setSession({ status: "anon" });
      }}
    />
  );
}

/** 启动校验的过渡态。只在本地有 token 时出现、通常几十毫秒，
 *  复用登录页的样式（不新增 CSS），避免"校验中"被误认成"已登出"。 */
function SessionChecking() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <span className="brand">
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
        </span>
        <h1>正在校验登录状态…</h1>
        <p className="auth-lede">马上就好。</p>
      </div>
    </div>
  );
}

function Workspace({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  // 服务端 data 为 null（新账号）时用空白工作区起步并立刻回写——不再灌演示种子。
  // useRemoteStore 的契约没变，hook 和后端都不用动；演示账号的 data 非 null，不受影响。
  const [store, setStore, storageError] = useRemoteStore<Store>(createEmptyStore);
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
  // 设置页不在 navigation 里（它只对管理员可见，塞进 navigation 会连带出现在
  // 侧边栏主导航和 Cmd+K 搜索里），所以单独认一下——否则 section 会退化成 "tasks"，
  // 侧边栏高亮会在设置页上亮着"数据任务"。
  const section = selected || selectedMedia
    ? "tasks"
    : navigation.some((n) => n.id === parts[0])
      ? parts[0]
      : parts[0] === "settings"
        ? "settings"
        : "tasks";
  const canManage = user.role === "admin";
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
  // 侧边栏删除任务：两步确认（第一次点变成"确认"，再点一次才删），避免演示现场误触
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  useEffect(() => {
    if (!confirmingDelete) return;
    const id = setTimeout(() => setConfirmingDelete(null), 3000);
    return () => clearTimeout(id);
  }, [confirmingDelete]);
  function deleteTask(id: string) {
    // 连带清掉指向该任务的服务配置和入库记录，不留孤儿数据
    setStore((s) => ({
      ...s,
      tasks: s.tasks.filter((t) => t.id !== id),
      services: (s.services ?? []).filter((svc) => svc.taskId !== id),
      warehouses: (s.warehouses ?? []).filter((w) => w.taskId !== id),
    }));
    if (selected?.id === id) go("tasks");
    setConfirmingDelete(null);
    setToast("任务已删除");
  }
  function deleteMediaTask(id: string) {
    setStore((s) => ({ ...s, mediaTasks: (s.mediaTasks ?? []).filter((t) => t.id !== id) }));
    if (selectedMedia?.id === id) go("tasks");
    setConfirmingDelete(null);
    setToast("任务已删除");
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
          <span className="nav-section-label">全部任务</span>
          {[
            ...store.tasks.map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt, media: false as const })),
            ...mediaTasks.map((t) => ({ id: t.id, name: t.name, updatedAt: t.updatedAt, media: true as const, kind: t.kind })),
          ]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((t) => {
              const isSelected = t.media ? selectedMedia?.id === t.id : selected?.id === t.id;
              const Icon = t.media ? MEDIA_KIND_ICON[t.kind] : FileSpreadsheet;
              const confirming = confirmingDelete === t.id;
              return (
                <div key={(t.media ? "media-" : "data-") + t.id} className="recent-task-row">
                  <button
                    className={isSelected ? "selected" : ""}
                    onClick={() => {
                      setConfirmingDelete(null);
                      t.media ? openMedia(t.id) : open(t.id);
                    }}
                  >
                    <Icon size={14} />
                    <span>{t.name}</span>
                    {isSelected && <i />}
                  </button>
                  <button
                    className={`row-delete${confirming ? " confirming" : ""}`}
                    aria-label={confirming ? `确认删除${t.name}` : `删除${t.name}`}
                    title={confirming ? "再点一次确认删除" : "删除任务"}
                    onClick={() => {
                      if (confirming) t.media ? deleteMediaTask(t.id) : deleteTask(t.id);
                      else setConfirmingDelete(t.id);
                    }}
                  >
                    {confirming ? <Check size={13} /> : <Trash2 size={13} />}
                    {confirming && "确认"}
                  </button>
                </div>
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
          {canManage && (
            // 仅管理员可见。刻意不进 navigation——那份配置同时驱动侧边栏主导航和
            // Cmd+K 搜索，不进它就自动满足"只有管理员能看到"，也不用给搜索做权限过滤。
            <button
              className={`sidebar-help${section === "settings" ? " active" : ""}`}
              onClick={() => go("settings")}
            >
              <SettingsIcon size={17} />
              设置
              <ArrowRight size={13} />
            </button>
          )}
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
              createdBy={user.displayName}
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
          ) : section === "settings" ? (
            canManage ? (
              <Settings currentUser={user} notify={setToast} />
            ) : (
              // 非管理员直接敲 #settings：给一个明确的"无权访问"页。
              // 不做重定向是因为渲染期改 hash 会闪，而且说清楚比悄悄弹回更诚实。
              // 真正的闸门是服务端的 requireAdmin（这里点进去也拿不到任何数据）。
              <div className="page">
                <Empty
                  title="需要管理员权限"
                  description="「设置」只对管理员开放。请联系管理员开通账号，或回到数据任务继续工作。"
                  action={
                    <button className="button primary" onClick={() => go("tasks")}>
                      返回数据任务
                      <ArrowRight size={14} />
                    </button>
                  }
                />
              </div>
            )
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
