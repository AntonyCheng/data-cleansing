import { useMemo, useState } from "react";
import { Play, ShieldCheck, ArrowRight } from "lucide-react";
import type { DataTask, Rule, Run } from "../lib/types";
import { execute } from "../lib/engine";
import { Dialog, Notice } from "./UI";
export default function PlanPreview({
  task,
  onPlan,
  onRun,
  onClose,
}: {
  task: DataTask;
  onPlan: (rules: Rule[]) => void;
  onRun: (run: Run) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showDsl, setShowDsl] = useState(false);
  const calculation = useMemo(() => {
    try {
      return { run: execute(task.raw, task.fields, task.plan), error: "" };
    } catch (e) {
      return {
        run: null,
        error: e instanceof Error ? e.message : "规则配置无效",
      };
    }
  }, [task.raw, task.fields, task.plan]);
  const preview = calculation.run;
  return (
    <Dialog
      title="清洗方案与影响预览"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="plan-preview-intro">
        <span className="ai-icon">
          <ShieldCheck size={23} />
        </span>
        <div>
          <h3>先看清变化，再开始清洗</h3>
          <p>基于全部 {task.raw.length} 行数据计算，原始数据始终保留。</p>
        </div>
      </div>
      {preview && (
        <>
          <div className="impact-grid">
            {[
              ["修改", preview.changed.length, "amber"],
              ["删除", preview.deleted.length, "red"],
              ["进入异常集", preview.exceptions.length, "orange"],
              ["预计保留", preview.rows.length, "green"],
            ].map(([label, value, color]) => (
              <div key={label} className={String(color)}>
                <strong>
                  {value}
                  <small> 行</small>
                </strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="preview-rule-list">
            {task.plan.map((r) => {
              const impact = preview.impacts.find((i) => i.ruleId === r.id);
              return (
                <label key={r.id}>
                  <input
                    type="checkbox"
                    disabled={busy}
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
                        : task.fields.find((f) => f.key === r.field)
                            ?.label}{" "}
                      {r.operation === "deduplicate" &&
                        "· " + (r.fields.length ? "联合去重" : "整行去重")}
                    </small>
                  </span>
                  <span>
                    {impact
                      ? `${impact.kind} ${impact.affected} 行`
                      : "本次不执行"}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="quality-compare">
            <span>预计质量评分</span>
            <strong>{preview.beforeScore}</strong>
            <ArrowRight size={17} />
            <strong className="green-text">
              {preview.afterScore}
              <small> / 100</small>
            </strong>
          </div>
          {preview.validation.blocked ? (
            <Notice warning>
              {preview.validation.messages.join(" ")}
              可以执行以检查结果，但校验通过前不能入库。
            </Notice>
          ) : (
            <Notice>
              未发现超过阈值的金额损失。清洗完成后，请检查异常集与业务指标，再确认入库。
            </Notice>
          )}
        </>
      )}
      {calculation.error && (
        <p className="form-error" role="alert">
          {calculation.error}
        </p>
      )}
      <button className="text-button" onClick={() => setShowDsl(!showDsl)}>
        {showDsl ? "收起" : "查看"} Rule DSL
      </button>
      {showDsl && (
        <pre>
          {JSON.stringify(
            {
              version: 1,
              pipeline: task.plan
                .filter((r) => r.enabled)
                .map(({ operation, field, fields, params }) => ({
                  operation,
                  field,
                  fields,
                  params,
                })),
            },
            null,
            2,
          )}
        </pre>
      )}
      <div className="form-footer">
        <button className="button" disabled={busy} onClick={onClose}>
          返回调整
        </button>
        <button
          className="button primary"
          disabled={!preview || !task.plan.some((r) => r.enabled) || busy}
          onClick={() => {
            if (!preview) return;
            setBusy(true);
            setTimeout(
              () => onRun({ ...preview, time: new Date().toISOString() }),
              650,
            );
          }}
        >
          <Play size={16} />
          {busy
            ? "正在清洗并校验…"
            : `开始清洗 · ${task.plan.filter((r) => r.enabled).length} 条规则`}
        </button>
      </div>
    </Dialog>
  );
}
