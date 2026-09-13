import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Menu,
  Save,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import type {
  DataTask,
  Rule,
  Run,
  SheetView,
  Store,
  Destination,
} from "../lib/types";
import {
  taskStatus,
  runStatus,
  isCleanComplete,
  PROCESSING_STATUS,
  IMPORT_STATUS,
} from "../lib/status";
import { analyze } from "../lib/engine";
import { Badge, Dialog, Notice } from "../components/UI";
import Sheet from "../components/Sheet";
import ResizableWorkspace from "../components/ResizableWorkspace";
import type { RowFilter } from "../components/Sheet";
import Copilot from "../components/Copilot";
import RuleEditor from "../components/RuleEditor";
import RulePicker from "../components/RulePicker";
import PlanPreview from "../components/PlanPreview";
import ImportDialog from "../components/ImportDialog";
export default function Workbench({
  task,
  store,
  onUpdate,
  onImport,
  onSaveRule,
  onTemplate,
  onBack,
  onOpenNav,
  notify,
  initialView = "raw",
}: {
  task: DataTask;
  store: Store;
  onUpdate: (task: DataTask) => void;
  onImport: (destination: Destination) => void;
  onSaveRule: (
    rules: Rule[],
    name: string,
    method: "AI 生成" | "手工创建",
  ) => void;
  onTemplate: (rules: Rule[], name: string) => void;
  onBack: () => void;
  onOpenNav: () => void;
  notify: (s: string) => void;
  initialView?: SheetView;
}) {
  const [view, setView] = useState<SheetView>(initialView);
  const [copilotOpen, setCopilotOpen] = useState(() => window.innerWidth > 900);
  const [copilotTab, setCopilotTab] = useState<
    "数据质量" | "一键清洗" | "清洗规则" | "AI 对话"
  >("数据质量");
  const [issueFilter, setIssueFilter] = useState<RowFilter>(null);
  const [editor, setEditor] = useState<Rule | null>(null);
  const [picker, setPicker] = useState(false);
  const [preview, setPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [save, setSave] = useState<{
    rules: Rule[];
    name: string;
    kind: "rule" | "template";
    method: "AI 生成" | "手工创建";
  } | null>(null);
  const [saveName, setSaveName] = useState("");
  const status = taskStatus(task),
    run = task.runs[0],
    p = analyze(task.raw, task.fields);
  const stage = !run ? 2 : task.storedRunId === run.id ? 4 : 3;
  function plan(rules: Rule[]) {
    onUpdate({ ...task, plan: rules, updatedAt: new Date().toISOString() });
  }
  function runComplete(r: Run) {
    onUpdate({ ...task, runs: [r, ...task.runs], updatedAt: r.time });
    setPreview(false);
    setView("cleaned");
    setIssueFilter(null);
    setCopilotTab("数据质量");
    notify(
      runStatus(r) === PROCESSING_STATUS.invalid
        ? "校验异常，请检查清洗报告"
        : "清洗完成，可预览、确认入库或配置数据服务",
    );
  }
  function openSave(
    rules: Rule[],
    name: string,
    kind: "rule" | "template",
    method: "AI 生成" | "手工创建",
  ) {
    setSave({ rules, name, kind, method });
    setSaveName(name);
  }
  return (
    <div className="workbench-page">
      <div className="workbench-heading">
        <div className="workbench-heading-title">
          <button
            className="icon-button workbench-nav-toggle"
            aria-label="打开导航"
            onClick={onOpenNav}
          >
            <Menu size={20} />
          </button>
          <button
            className="icon-button"
            aria-label="返回数据任务"
            onClick={onBack}
          >
            <ArrowLeft size={19} />
          </button>
          <span className="document-icon">
            <FileSpreadsheet size={23} />
          </span>
          <div>
            <div>
              <h1 title={task.name}>{task.name}</h1>
              <Badge tone={status.tone}>{status.text}</Badge>
            </div>
            <p className="workbench-meta">
              <span className="task-source" title={task.source}>
                {task.source}
              </span>
              <span>·</span>
              <span>{task.demo ? "示例数据" : "本地上传"}</span>
              {run && task.storedRunId === run.id ? (
                <span
                  className="stored-inline"
                  title={`本地演示入库：${task.destination?.database}.${task.destination?.table} · ${run.rows.length} 行；原始数据只读保留`}
                >
                  <Check size={12} />
                  <span>
                    已写入 {task.destination?.database}.
                    {task.destination?.table} · {run.rows.length} 行
                  </span>
                </span>
              ) : (
                <span className="source-preservation">· 原始数据只读保留</span>
              )}
            </p>
          </div>
        </div>
        <div className="workbench-actions">
          <button
            className="button"
            onClick={() => {
              setSaveName(task.name + "清洗模板");
              openSave(
                task.plan,
                task.name + "清洗模板",
                "template",
                "手工创建",
              );
            }}
          >
            <Save size={15} />
            <span>存为模板</span>
          </button>
          <button
            className="button primary"
            disabled={!isCleanComplete(task) || task.storedRunId === run?.id}
            onClick={() => setImporting(true)}
          >
            <Database size={15} />
            {run && task.storedRunId === run.id
              ? IMPORT_STATUS.stored.text
              : "确认入库"}
          </button>
        </div>
      </div>
      <div className="workflow-strip">
        <div className="workflow-progress">
          {["数据接入", "解析与分析", "清洗与预览", "确认入库"].map((s, i) => (
            <div
              key={s}
              className={
                i + 1 < stage ? "done" : i + 1 === stage ? "current" : ""
              }
            >
              <span>{i + 1 < stage ? <Check size={12} /> : i + 1}</span>
              {s}
              {i < 3 && <ChevronRight size={14} />}
            </div>
          ))}
        </div>
        <div className="dataset-facts">
          <span>
            <b>{task.raw.length.toLocaleString()}</b> 行数据
          </span>
          <i />
          <span>
            <b>{task.fields.length}</b> 个字段
          </span>
          <i />
          <span>
            <ShieldCheck size={14} />
            <b>{run?.afterScore ?? p.score}</b> 分
          </span>
        </div>
      </div>
      <ResizableWorkspace
        copilot={
          copilotOpen ? (
            <Copilot
              task={task}
              onPlan={plan}
              onPreview={() => setPreview(true)}
              onFilter={(name, ids) => {
                setView("raw");
                setIssueFilter({ name, ids });
              }}
              onEdit={setEditor}
              onAdd={() => setPicker(true)}
              onSaveRule={(rules, name, method) =>
                openSave(rules, name, "rule", method)
              }
              onSaveTemplate={() =>
                openSave(
                  task.plan,
                  task.name + "清洗模板",
                  "template",
                  "手工创建",
                )
              }
              onClose={() => setCopilotOpen(false)}
              tab={copilotTab}
              setTab={setCopilotTab}
            />
          ) : null
        }
      >
        <Sheet
          task={task}
          view={view}
          setView={setView}
          onFields={(fields) => onUpdate({ ...task, fields })}
          issueFilter={issueFilter}
          setIssueFilter={setIssueFilter}
        />
      </ResizableWorkspace>
      {!copilotOpen && (
        <button
          className="floating-copilot"
          onClick={() => setCopilotOpen(true)}
        >
          <Sparkles size={19} />
          <span>AI 副驾驶</span>
        </button>
      )}
      {editor && (
        <RuleEditor
          rule={editor}
          fields={task.fields}
          onClose={() => setEditor(null)}
          onSave={(rule) => {
            plan(task.plan.map((r) => (r.id === rule.id ? rule : r)));
            setEditor(null);
            notify("规则参数已更新，执行前可预览影响");
          }}
        />
      )}
      {picker && (
        <RulePicker
          fields={task.fields}
          onClose={() => setPicker(false)}
          onAdd={(rule) => {
            plan([...task.plan, rule]);
            setPicker(false);
            setCopilotTab("清洗规则");
            notify("已加入清洗方案");
          }}
        />
      )}
      {preview && (
        <PlanPreview
          task={task}
          onPlan={plan}
          onRun={runComplete}
          onClose={() => setPreview(false)}
        />
      )}
      {importing && run && (
        <ImportDialog
          task={task}
          store={store}
          onClose={() => setImporting(false)}
          onConfirm={(destination) => {
            onImport(destination);
            setImporting(false);
            notify("入库完成，已保存到本地演示数据表");
          }}
        />
      )}
      {save && (
        <Dialog
          title={save.kind === "rule" ? "保存到我的清洗规则" : "保存清洗模板"}
          onClose={() => setSave(null)}
        >
          <Notice>
            {save.kind === "rule"
              ? "保存后可在“我的清洗规则”中复用，当前任务仍需确认执行。"
              : "将当前规则顺序与参数一起保存，下次可一键加载。"}
          </Notice>
          <label className="field">
            {save.kind === "rule" ? "规则名称" : "模板名称"}
            <input
              maxLength={60}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
            />
          </label>
          <div className="save-rule-summary">
            {save.rules.map((r) => (
              <div key={r.id}>
                <WandSparkles size={14} />
                {r.name}
              </div>
            ))}
          </div>
          <div className="form-footer">
            <button className="button" onClick={() => setSave(null)}>
              取消
            </button>
            <button
              className="button primary"
              disabled={!saveName.trim() || !save.rules.length}
              onClick={() => {
                if (save.kind === "rule") {
                  onSaveRule(save.rules, saveName.trim(), save.method);
                  plan([...task.plan, ...save.rules]);
                } else onTemplate(save.rules, saveName.trim());
                setSave(null);
                notify(
                  save.kind === "rule"
                    ? "已保存规则并加入当前方案"
                    : "清洗模板已保存",
                );
              }}
            >
              确认保存
              <ArrowRight size={15} />
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
