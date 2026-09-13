import { runStatus } from "../lib/status";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  ListChecks,
  MessageSquare,
  Plus,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import type { DataTask, Rule, Run } from "../lib/types";
import { analyze, parseInstruction } from "../lib/engine";
import { Badge, Notice } from "./UI";
type Tab = "数据质量" | "一键清洗" | "清洗规则" | "AI 对话";
type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  match?: ReturnType<typeof parseInstruction>;
  done?: boolean;
};
export default function Copilot({
  task,
  onPlan,
  onPreview,
  onFilter,
  onEdit,
  onAdd,
  onSaveRule,
  onSaveTemplate,
  onClose,
  tab,
  setTab,
}: {
  task: DataTask;
  onPlan: (rules: Rule[]) => void;
  onPreview: () => void;
  onFilter: (name: string, ids: string[]) => void;
  onEdit: (rule: Rule) => void;
  onAdd: () => void;
  onSaveRule: (
    rules: Rule[],
    name: string,
    method: "AI 生成" | "手工创建",
  ) => void;
  onSaveTemplate: () => void;
  onClose: () => void;
  tab: Tab;
  setTab: (tab: Tab) => void;
}) {
  const profile = analyze(task.raw, task.fields);
  const run = task.runs[0];
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [allIssues, setAllIssues] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (messages.length) bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);
  function send(input: string) {
    if (!input.trim() || busy) return;
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", text: input },
    ]);
    setText("");
    setBusy(true);
    setTimeout(() => {
      const match = parseInstruction(input, task.fields);
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: match
            ? match.explanation
            : /质量|问题|分析/.test(input)
              ? `已检查 ${task.raw.length} 行数据，发现 ${profile.issues.length} 项问题，涉及 ${profile.problemRows} 行。你可以在“数据质量”中定位问题，或生成清洗方案。`
              : "这条需求暂未匹配到本地规则。当前支持空值分流、去重、空格处理、手机号、地区、日期、金额及脱敏。更复杂的语义处理需接入模型后使用。",
          match,
        },
      ]);
      setBusy(false);
    }, 550);
  }
  function addMatch(m: Message, save: boolean) {
    if (!m.match) return;
    if (save) onSaveRule(m.match.rules, m.match.name, "AI 生成");
    else onPlan([...task.plan, ...m.match.rules]);
    if (!save)
      setMessages((all) =>
        all.map((x) => (x.id === m.id ? { ...x, done: true } : x)),
      );
  }
  function move(index: number, offset: number) {
    const plan = [...task.plan];
    [plan[index], plan[index + offset]] = [plan[index + offset], plan[index]];
    onPlan(plan);
  }
  return (
    <aside className="copilot">
      <div className="copilot-title">
        <span className="ai-icon">
          <Sparkles size={17} />
        </span>
        <div>
          <h3>
            AI 副驾驶 <span>Copilot</span>
          </h3>
        </div>
        <button
          className="icon-button"
          aria-label="收起副驾驶"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="copilot-tabs" role="tablist" aria-label="副驾驶功能">
        {(
          [
            { name: "数据质量", icon: ShieldCheck },
            { name: "一键清洗", icon: WandSparkles },
            { name: "清洗规则", icon: ListChecks },
            { name: "AI 对话", icon: MessageSquare },
          ] as const
        ).map((t) => (
          <button
            role="tab"
            aria-selected={tab === t.name}
            key={t.name}
            className={tab === t.name ? "active" : ""}
            onClick={() => setTab(t.name)}
          >
            <t.icon size={16} />
            {t.name}
          </button>
        ))}
      </div>
      <div className="copilot-content">
        {tab === "数据质量" && (
          <>
            <section className="quality-score-card">
              <div className="quality-score-summary">
                <span>数据质量评分</span>
                <strong>
                  {run?.afterScore ?? profile.score}
                  <small> / 100</small>
                </strong>
                <Badge
                  tone={
                    (run?.afterScore ?? profile.score) >= 90 ? "green" : "amber"
                  }
                >
                  {(run?.afterScore ?? profile.score) >= 90
                    ? "格式良好"
                    : "建议优化"}
                </Badge>
              </div>
              <div className="quality-score-foot">
                {run
                  ? `清洗前 ${run.beforeScore} 分 → 清洗后 ${run.afterScore} 分`
                  : `已分析 ${task.raw.length} 行 · ${task.fields.length} 个字段`}
                <span className="live-dot" />
                {runStatus(run).text}
              </div>
            </section>
            {run && <RunReport run={run} />}
            <div className="copilot-section-title">
              <h4>发现 {profile.issues.length} 项原始问题</h4>
              <span>{profile.problemRows} 行受影响</span>
            </div>
            <div className="quality-problems">
              {(allIssues ? profile.issues : profile.issues.slice(0, 5)).map(
                (issue) => (
                  <button
                    key={issue.id}
                    title={`${issue.title} · ${issue.category} · 点击定位数据`}
                    onClick={() => onFilter(issue.title, issue.rows)}
                  >
                    <span
                      className={`problem-symbol ${issue.severity === "danger" ? "danger" : ""}`}
                    >
                      {issue.category === "缺失值"
                        ? "∅"
                        : issue.category === "重复数据"
                          ? "≋"
                          : "!"}
                    </span>
                    <span>
                      <strong>{issue.title}</strong>
                    </span>
                    <b>
                      {issue.rows.length}
                      <small> 行</small>
                    </b>
                    <ChevronRight size={14} />
                  </button>
                ),
              )}
            </div>
            {profile.issues.length > 5 && (
              <button
                className="show-more"
                onClick={() => setAllIssues(!allIssues)}
              >
                {allIssues
                  ? "收起问题"
                  : `查看全部 ${profile.issues.length} 项问题`}
                <ChevronRight size={13} />
              </button>
            )}
            {!profile.issues.length && (
              <Notice>未发现当前检查规则覆盖的质量问题。</Notice>
            )}
            <div className="privacy-note">
              <ShieldCheck size={16} />
              <span>
                识别到 {profile.sensitive} 个敏感字段
                <br />
                <small>可按需加入脱敏规则</small>
              </span>
              <button className="text-button" onClick={onAdd}>
                查看
              </button>
            </div>
            <div className="ai-tip">
              <Sparkles size={16} />
              <p>
                建议先统一格式，再处理重复与异常。每一步都可以预览，你确认后才会执行。
              </p>
            </div>
          </>
        )}
        {(tab === "一键清洗" || tab === "清洗规则") && (
          <>
            <div className="plan-summary">
              <span className="ai-icon">
                <ListChecks size={21} />
              </span>
              <div>
                <h4>
                  {tab === "一键清洗"
                    ? "AI 已为你准备好清洗方案"
                    : "当前清洗 Pipeline"}
                </h4>
                <p>
                  {task.plan.filter((r) => r.enabled).length} 条已选规则 ·
                  按下方顺序执行
                </p>
              </div>
            </div>
            <div className="plan-list-controls">
              <label>
                <input
                  type="checkbox"
                  checked={
                    task.plan.length > 0 && task.plan.every((r) => r.enabled)
                  }
                  onChange={(e) =>
                    onPlan(
                      task.plan.map((r) => ({
                        ...r,
                        enabled: e.target.checked,
                      })),
                    )
                  }
                />
                全选
              </label>
              <button className="text-button" onClick={onAdd}>
                <Plus size={14} />
                添加规则
              </button>
            </div>
            <div className="plan-list">
              {task.plan.map((r, index) => (
                <div
                  className={`plan-rule ${!r.enabled ? "disabled" : ""}`}
                  key={r.id}
                >
                  <label>
                    <input
                      aria-label={"启用 " + r.name}
                      type="checkbox"
                      checked={r.enabled}
                      onChange={(e) =>
                        onPlan(
                          task.plan.map((x) =>
                            x.id === r.id
                              ? { ...x, enabled: e.target.checked }
                              : x,
                          ),
                        )
                      }
                    />
                    <span>
                      <strong>{r.name}</strong>
                      <small>
                        {r.field === "*"
                          ? "全部字段"
                          : task.fields.find((f) => f.key === r.field)?.label ||
                            r.field}
                        {r.operation === "deduplicate"
                          ? " · " +
                            (r.params.keep === "latest"
                              ? "保留最新"
                              : "保留首条")
                          : ""}
                      </small>
                    </span>
                  </label>
                  <div className="plan-rule-actions">
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <button
                      aria-label={"上移 " + r.name}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      aria-label={"下移 " + r.name}
                      disabled={index === task.plan.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      aria-label={"配置 " + r.name}
                      onClick={() => onEdit(r)}
                    >
                      <Settings2 size={14} />
                    </button>
                    <button
                      aria-label={"移除 " + r.name}
                      onClick={() =>
                        onPlan(task.plan.filter((x) => x.id !== r.id))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {!task.plan.length && (
              <Notice>还没有清洗规则，请添加规则或用 AI 对话描述需求。</Notice>
            )}
            <div className="template-actions">
              <button
                className="button"
                disabled={!task.plan.length}
                onClick={onSaveTemplate}
              >
                <Save size={14} />
                保存为清洗模板
              </button>
            </div>
            <div className="ai-tip">
              <ShieldCheck size={16} />
              <p>
                原始数据不会被覆盖。空值与非法值可以进入异常集，避免静默丢失数据。
              </p>
            </div>
          </>
        )}
        {tab === "AI 对话" && (
          <>
            <div className="chat-welcome">
              <span className="ai-icon">
                <Sparkles size={26} />
              </span>
              <h3>告诉我，你想怎么整理？</h3>
              <p>描述规则，预览方案，再确认执行。</p>
            </div>
            {!messages.length && (
              <div className="chat-suggestions">
                {[
                  "手机号为空的数据放到异常表",
                  "姓名和手机号一样，保留更新时间最新的记录",
                  "将 HLJ 和黑龙江统一成黑龙江省",
                  "客户名称一样且手机号后8位一样，保留最新记录",
                ].map((t) => (
                  <button key={t} onClick={() => send(t)}>
                    {t}
                    <ArrowRight size={13} />
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) => (
              <div className={`message ${m.role}`} key={m.id}>
                {m.role === "assistant" && (
                  <span className="small-ai">
                    <Sparkles size={13} />
                  </span>
                )}
                <div>
                  <p>{m.text}</p>
                  {m.match && (
                    <div className="matched-rule">
                      <Badge tone={m.match.custom ? "amber" : "green"}>
                        {m.match.custom ? "新规则" : "已匹配系统规则"}
                      </Badge>
                      <h4>{m.match.name}</h4>
                      <small>
                        {m.match.rules
                          .map((r) =>
                            r.field === "*"
                              ? "全部字段"
                              : task.fields.find((f) => f.key === r.field)
                                  ?.label,
                          )
                          .join("、")}
                      </small>
                      <details>
                        <summary>查看 Rule DSL</summary>
                        <pre>
                          {JSON.stringify(
                            m.match.rules.map(
                              ({ operation, field, fields, params }) => ({
                                operation,
                                field,
                                fields,
                                params,
                              }),
                            ),
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                      {m.done ||
                      m.match.rules.every((r) =>
                        task.plan.some((p) => p.id === r.id),
                      ) ? (
                        <span className="added-rule">
                          <Check size={13} />
                          已处理该建议
                        </span>
                      ) : (
                        <div className="match-actions">
                          {m.match.custom && (
                            <button
                              className="button primary"
                              onClick={() => addMatch(m, true)}
                            >
                              保存并加入
                            </button>
                          )}
                          <button
                            className={
                              m.match.custom ? "text-button" : "button primary"
                            }
                            onClick={() => addMatch(m, false)}
                          >
                            {m.match.custom ? "仅本次使用" : "加入清洗方案"}
                            <Plus size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="thinking" role="status">
                <Sparkles size={14} />
                正在匹配规则…
              </div>
            )}
            <div ref={bottom} />
          </>
        )}
      </div>
      <div className="copilot-bottom">
        {tab === "AI 对话" ? (
          <form
            className="chat-composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <textarea
              aria-label="描述清洗需求"
              placeholder="例如：手机号去掉空格…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send(text);
                }
              }}
            />
            <div>
              <span>Enter 发送 · Shift + Enter 换行</span>
              <button aria-label="发送需求" disabled={!text.trim() || busy}>
                <ArrowUp size={17} />
              </button>
            </div>
          </form>
        ) : (
          <button
            className="button primary smart-clean"
            disabled={!task.plan.some((r) => r.enabled)}
            onClick={onPreview}
          >
            <WandSparkles size={17} />
            {tab === "数据质量" ? "一键智能清洗" : "预览影响并清洗"}
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </aside>
  );
}
function RunReport({ run }: { run: Run }) {
  return (
    <div className="run-report">
      <div className="copilot-section-title">
        <h4>本次清洗报告</h4>
        <Badge tone={runStatus(run).tone}>{runStatus(run).text}</Badge>
      </div>
      <div className="report-grid">
        {[
          ["修改记录", run.changed.length],
          ["删除重复/过滤", run.deleted.length],
          ["异常数据", run.exceptions.length],
          ["清洗后保留", run.rows.length],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
      {run.validation.metrics.map((m) => (
        <div className="business-metric" key={m.field}>
          <span>{m.field}合计</span>
          <p>
            {m.before.toLocaleString()} <ArrowRight size={12} />{" "}
            {m.after.toLocaleString()}
          </p>
        </div>
      ))}
      <Notice warning={run.validation.blocked}>
        {run.validation.blocked
          ? run.validation.messages.join(" ")
          : "未发现明显业务指标异常，可以预览结果并确认入库。"}
      </Notice>
    </div>
  );
}
