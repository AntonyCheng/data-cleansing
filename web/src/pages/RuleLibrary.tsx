import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookCopy,
  ChevronRight,
  Copy,
  FileCode2,
  FolderHeart,
  Layers3,
  Plus,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import type {
  DataTask,
  Rule,
  RuleDefinition,
  SavedRule,
  Store,
  Template,
} from "../lib/types";
import { categories, makeRule, ruleCatalog } from "../data/rules";
import {
  Badge,
  Dialog,
  Empty,
  Notice,
  SearchBox,
  formatTime,
} from "../components/UI";
export function bindRules(rules: Rule[], task: DataTask) {
  return rules.map((rule) => {
    const def = ruleCatalog.find((d) => d.id === rule.catalogId);
    const fallback = def ? makeRule(def, task.fields) : rule;
    const has = (key: string) => task.fields.some((f) => f.key === key);
    return {
      ...rule,
      id: crypto.randomUUID(),
      field:
        rule.field === "*" || has(rule.field) ? rule.field : fallback.field,
      fields: rule.fields.every(has) ? rule.fields : fallback.fields,
      params: {
        ...rule.params,
        orderBy: has(rule.params.orderBy)
          ? rule.params.orderBy
          : fallback.params.orderBy || "",
      },
      enabled: true,
    };
  });
}
export default function RuleLibrary({
  store,
  onApply,
  onSave,
  onShare,
  notify,
}: {
  store: Store;
  onApply: (
    task: DataTask,
    rules: Rule[],
    id?: string,
    template?: boolean,
  ) => void;
  onSave: (rule: SavedRule) => void;
  onShare: (id: string) => void;
  notify: (message: string) => void;
}) {
  const [scope, setScope] = useState("系统规则");
  const [category, setCategory] = useState("全部规则");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<
    RuleDefinition | SavedRule | Template | null
  >(null);
  const [apply, setApply] = useState<{
    rules: Rule[];
    id?: string;
    template?: boolean;
  } | null>(null);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const [baseId, setBaseId] = useState("trim");
  const [createTaskId, setCreateTaskId] = useState(store.tasks[0]?.id || "");
  const [share, setShare] = useState<SavedRule | null>(null);
  const saved = store.savedRules.filter(
    (r) => r.scope === scope && (r.name + r.description).includes(search),
  );
  const defs = ruleCatalog.filter(
    (r) =>
      (category === "全部规则" || r.category === category) &&
      (r.name + r.description).includes(search),
  );
  const templates = store.templates.filter((t) =>
    (t.name + t.description).includes(search),
  );
  const baseTask = store.tasks[0];
  function rulesFor(r: RuleDefinition | SavedRule | Template) {
    return "operation" in r ? [makeRule(r, baseTask.fields)] : r.rules;
  }
  return (
    <div className="page rules-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">CLEANING RULES</div>
          <h1>清洗规则</h1>
          <p>一次定义，反复复用。把数据整理经验，变成你的规则库。</p>
        </div>
        <button
          className="button primary"
          disabled={!baseTask}
          onClick={() => {
            setName("");
            setCreate(true);
          }}
        >
          <Plus size={16} />
          创建我的规则
        </button>
      </div>
      <div className="library-tabs">
        {[
          { name: "系统规则", icon: Layers3, count: ruleCatalog.length },
          {
            name: "我的清洗规则",
            icon: FolderHeart,
            count: store.savedRules.filter((r) => r.scope === "我的清洗规则")
              .length,
          },
          {
            name: "企业规则",
            icon: ShieldCheck,
            count: store.savedRules.filter((r) => r.scope === "企业规则")
              .length,
          },
          { name: "清洗模板", icon: BookCopy, count: store.templates.length },
        ].map((t) => (
          <button
            className={scope === t.name ? "active" : ""}
            key={t.name}
            onClick={() => {
              setScope(t.name);
              setSearch("");
            }}
          >
            <t.icon size={17} />
            {t.name}
            <span>{t.count}</span>
          </button>
        ))}
      </div>
      <div className="library-layout">
        {scope === "系统规则" && (
          <aside className="rule-categories">
            <h4>规则分类</h4>
            {categories.map((c) => (
              <button
                key={c}
                className={category === c ? "active" : ""}
                onClick={() => setCategory(c)}
              >
                {c}
                <span>
                  {c === "全部规则"
                    ? ruleCatalog.length
                    : ruleCatalog.filter((r) => r.category === c).length}
                </span>
              </button>
            ))}
          </aside>
        )}
        <div className="library-content">
          <div className="section-toolbar">
            <SearchBox
              value={search}
              onChange={setSearch}
              placeholder="搜索规则、字段类型或用途…"
            />
            <span className="secondary">
              {scope === "系统规则"
                ? defs.length
                : scope === "清洗模板"
                  ? templates.length
                  : saved.length}{" "}
              项
            </span>
          </div>
          <div className="rule-card-grid">
            {scope === "系统规则"
              ? defs.map((d) => (
                  <section className="card rule-card" key={d.id}>
                    <div className="rule-card-header">
                      <span className="rule-icon">
                        <WandSparkles size={16} />
                      </span>
                      <button
                        className="rule-card-title"
                        title={d.name}
                        onClick={() => setDetail(d)}
                      >
                        {d.name}
                      </button>
                      <Badge>{d.category}</Badge>
                    </div>
                    <p title={d.description}>{d.description}</p>
                    <div className="rule-tags">
                      {d.tags.map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    <div className="card-actions">
                      <button
                        className="text-button secondary"
                        onClick={() => setDetail(d)}
                      >
                        查看规则
                      </button>
                      <button
                        className="text-button"
                        disabled={!baseTask}
                        onClick={() =>
                          setApply({ rules: [makeRule(d, baseTask.fields)] })
                        }
                      >
                        添加到任务
                        <Plus size={14} />
                      </button>
                    </div>
                  </section>
                ))
              : scope === "清洗模板"
                ? templates.map((t) => (
                    <section className="card rule-card" key={t.id}>
                      <div className="rule-card-header">
                        <span className="rule-icon">
                          <Layers3 size={16} />
                        </span>
                        <button
                          className="rule-card-title"
                          title={t.name}
                          onClick={() => setDetail(t)}
                        >
                          {t.name}
                        </button>
                        <Badge tone="green">{t.rules.length} 条规则</Badge>
                      </div>
                      <p title={t.description}>{t.description}</p>
                      <div className="template-sequence">
                        {t.rules.slice(0, 3).map((r, i) => (
                          <span key={r.id}>
                            {i > 0 && <ChevronRight size={12} />}
                            <b>{r.name}</b>
                          </span>
                        ))}
                        {t.rules.length > 3 && (
                          <small>+{t.rules.length - 3}</small>
                        )}
                      </div>
                      <div className="card-actions">
                        <span className="secondary">已使用 {t.uses} 次</span>
                        <button
                          className="text-button"
                          onClick={() =>
                            setApply({
                              rules: t.rules,
                              id: t.id,
                              template: true,
                            })
                          }
                        >
                          使用模板
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </section>
                  ))
                : saved.map((r) => (
                    <section className="card rule-card" key={r.id}>
                      <div className="rule-card-header">
                        <span className="rule-icon">
                          <FileCode2 size={16} />
                        </span>
                        <button
                          className="rule-card-title"
                          title={r.name}
                          onClick={() => setDetail(r)}
                        >
                          {r.name}
                        </button>
                        <Badge
                          tone={r.method === "AI 生成" ? "green" : "neutral"}
                        >
                          {r.method}
                        </Badge>
                      </div>
                      <p title={r.description}>{r.description}</p>
                      <div className="rule-tags">
                        {r.fieldTypes.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                        <span>v{r.version}</span>
                      </div>
                      <div className="card-actions">
                        <span className="secondary">已使用 {r.uses} 次</span>
                        <button
                          className="text-button"
                          onClick={() => setApply({ rules: r.rules, id: r.id })}
                        >
                          添加到任务
                          <Plus size={14} />
                        </button>
                      </div>
                      {r.scope === "我的清洗规则" && (
                        <button
                          className="share-rule"
                          onClick={() => setShare(r)}
                        >
                          发布为企业规则
                          <ArrowUpRight size={12} />
                        </button>
                      )}
                    </section>
                  ))}
          </div>
          {((scope === "系统规则" && !defs.length) ||
            (scope === "清洗模板" && !templates.length) ||
            (!["系统规则", "清洗模板"].includes(scope) && !saved.length)) && (
            <Empty
              title={
                scope === "我的清洗规则"
                  ? "你的规则库，等待第一条经验"
                  : "暂无匹配内容"
              }
              description={
                scope === "我的清洗规则"
                  ? "在工作台用自然语言生成并保存规则，或复制系统规则。"
                  : "试试其他关键词。"
              }
              action={
                scope === "我的清洗规则" ? (
                  <button className="button" onClick={() => setCreate(true)}>
                    <Plus size={15} />
                    创建一条规则
                  </button>
                ) : undefined
              }
            />
          )}
        </div>
      </div>
      <div className="inline-banner">
        <Sparkles size={22} />
        <div>
          <h3>想不到规则名称？直接描述你想要的结果</h3>
          <p>
            在工作台 AI 对话中输入需求，已有规则直接匹配，新规则可以保存复用。
          </p>
        </div>
      </div>
      {detail && (
        <Dialog title={detail.name} onClose={() => setDetail(null)} wide>
          <p className="detail-description">{detail.description}</p>
          {"scope" in detail && (
            <dl className="definition-list">
              <dt>创建方式</dt>
              <dd>{detail.method}</dd>
              <dt>创建人</dt>
              <dd>{detail.createdBy}</dd>
              <dt>创建时间</dt>
              <dd>{formatTime(detail.createdAt)}</dd>
              <dt>最后使用</dt>
              <dd>
                {detail.lastUsed ? formatTime(detail.lastUsed) : "尚未使用"}
              </dd>
              <dt>使用次数 / 版本</dt>
              <dd>
                {detail.uses} / v{detail.version}
              </dd>
            </dl>
          )}
          <h4>Rule DSL</h4>
          <pre>
            {JSON.stringify(
              rulesFor(detail).map(({ operation, field, fields, params }) => ({
                operation,
                field,
                fields,
                params,
              })),
              null,
              2,
            )}
          </pre>
          <Notice>
            应用到新任务时会匹配可用字段，请在工作台复核参数与影响范围。
          </Notice>
          <div className="form-footer">
            {"operation" in detail && (
              <button
                className="button"
                onClick={() => {
                  onSave({
                    id: crypto.randomUUID(),
                    name: detail.name + "（副本）",
                    description: detail.description,
                    scope: "我的清洗规则",
                    rules: rulesFor(detail),
                    fieldTypes: detail.tags,
                    createdBy: "林晓",
                    method: "系统复制",
                    createdAt: new Date().toISOString(),
                    uses: 0,
                    version: 1,
                  });
                  setDetail(null);
                  setScope("我的清洗规则");
                  notify("已复制到我的清洗规则");
                }}
              >
                <Copy size={14} />
                复制到我的规则
              </button>
            )}
            <button
              className="button primary"
              onClick={() => {
                setApply({
                  rules: rulesFor(detail),
                  ...("uses" in detail
                    ? { id: detail.id, template: !("scope" in detail) }
                    : {}),
                });
                setDetail(null);
              }}
            >
              添加到任务
              <ArrowRight size={15} />
            </button>
          </div>
        </Dialog>
      )}
      {apply && (
        <Dialog
          title={apply.template ? "选择任务并加载模板" : "选择要添加规则的任务"}
          onClose={() => setApply(null)}
        >
          <Notice>
            {apply.template
              ? "模板将替换该任务当前待执行方案，历史清洗结果仍保留。"
              : "规则会加入待执行方案，不会自动运行。"}
          </Notice>
          <div className="task-picker">
            {store.tasks.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  onApply(
                    t,
                    bindRules(apply.rules, t),
                    apply.id,
                    apply.template,
                  );
                  setApply(null);
                }}
              >
                <FileCode2 size={19} />
                <span>
                  <strong>{t.name}</strong>
                  <small>
                    {t.raw.length} 行 · {t.fields.length} 个字段
                  </small>
                </span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {create && (
        <Dialog title="创建我的清洗规则" onClose={() => setCreate(false)}>
          <label className="field">
            规则名称
            <input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：客户手机号规整"
            />
          </label>
          <label className="field">
            基于内置操作
            <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
              {ruleCatalog.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.category} / {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            参考任务字段
            <select
              value={createTaskId}
              onChange={(e) => setCreateTaskId(e.target.value)}
            >
              {store.tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <Notice>先创建可复用规则，添加到任务后可修改目标字段和参数。</Notice>
          <div className="form-footer">
            <button
              className="button primary"
              disabled={!name.trim() || !createTaskId}
              onClick={() => {
                const task = store.tasks.find((t) => t.id === createTaskId)!;
                const def = ruleCatalog.find((r) => r.id === baseId)!;
                onSave({
                  id: crypto.randomUUID(),
                  name: name.trim(),
                  description: def.description,
                  scope: "我的清洗规则",
                  rules: [{ ...makeRule(def, task.fields), name: name.trim() }],
                  fieldTypes: def.tags,
                  createdBy: "林晓",
                  method: "手工创建",
                  createdAt: new Date().toISOString(),
                  uses: 0,
                  version: 1,
                });
                setCreate(false);
                setScope("我的清洗规则");
                notify("我的清洗规则已创建");
              }}
            >
              创建规则
            </button>
          </div>
        </Dialog>
      )}
      {share && (
        <Dialog title="发布企业规则" onClose={() => setShare(null)}>
          <Notice>
            将“{share.name}
            ”复制到企业规则库，工作区中的其他任务可复用同一份规则配置。当前为本地演示。
          </Notice>
          <div className="form-footer">
            <button className="button" onClick={() => setShare(null)}>
              取消
            </button>
            <button
              className="button primary"
              onClick={() => {
                onShare(share.id);
                setShare(null);
                setScope("企业规则");
                notify("规则已发布到企业规则库");
              }}
            >
              确认发布
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
