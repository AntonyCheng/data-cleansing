import { useState } from "react";
import type { Field, Rule } from "../lib/types";
import { Dialog, Notice } from "./UI";
import { validateRules } from "../lib/engine";
export default function RuleEditor({
  rule,
  fields,
  onSave,
  onClose,
}: {
  rule: Rule;
  fields: Field[];
  onSave: (r: Rule) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Rule>(structuredClone(rule));
  const [error, setError] = useState("");
  const param = (key: string, value: string) =>
    setDraft({ ...draft, params: { ...draft.params, [key]: value } });
  return (
    <Dialog title="配置清洗规则" onClose={onClose}>
      <label className="field">
        规则名称
        <input
          maxLength={60}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      {draft.operation !== "deduplicate" && (
        <label className="field">
          目标字段
          <select
            value={draft.field}
            onChange={(e) => setDraft({ ...draft, field: e.target.value })}
          >
            {[
              "trim",
              "nullify",
              "remove-space",
              "upper",
              "lower",
              "html",
            ].includes(draft.operation) && <option value="*">全部字段</option>}
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label} · {f.type}
              </option>
            ))}
          </select>
        </label>
      )}
      {draft.operation === "deduplicate" && (
        <>
          <label className="field">
            判定方式
            <select
              value={draft.fields.length ? "fields" : "all"}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  fields: e.target.value === "all" ? [] : [fields[0].key],
                })
              }
            >
              <option value="all">整行完全相同</option>
              <option value="fields">指定字段组合</option>
            </select>
          </label>
          {draft.fields.length > 0 && (
            <div className="inline-checks">
              {fields.map((f) => (
                <label key={f.key}>
                  <input
                    type="checkbox"
                    checked={draft.fields.includes(f.key)}
                    disabled={
                      draft.fields.length === 1 && draft.fields[0] === f.key
                    }
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        fields: e.target.checked
                          ? [...draft.fields, f.key]
                          : draft.fields.filter((k) => k !== f.key),
                      })
                    }
                  />
                  {f.label}
                </label>
              ))}
            </div>
          )}
          <label className="field">
            保留方式
            <select
              value={draft.params.keep}
              onChange={(e) => param("keep", e.target.value)}
            >
              <option value="first">保留第一条</option>
              <option value="last">保留最后一条</option>
              <option value="latest">按时间保留最新记录</option>
            </select>
          </label>
          {draft.params.keep === "latest" && (
            <label className="field">
              排序时间字段
              <select
                value={draft.params.orderBy}
                onChange={(e) => param("orderBy", e.target.value)}
              >
                <option value="">请选择</option>
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {draft.params.suffix && (
            <label className="field">
              手机号取后几位
              <input
                type="number"
                min="1"
                max="20"
                value={draft.params.suffix}
                onChange={(e) => param("suffix", e.target.value)}
              />
            </label>
          )}
        </>
      )}
      {draft.operation === "fill" && (
        <>
          <label className="field">
            填充方式
            <select
              value={draft.params.strategy}
              onChange={(e) => param("strategy", e.target.value)}
            >
              {["固定值", "平均值", "中位数", "众数", "前值", "后值"].map(
                (s) => (
                  <option key={s}>{s}</option>
                ),
              )}
            </select>
          </label>
          {draft.params.strategy === "固定值" && (
            <label className="field">
              填充值
              <input
                value={draft.params.value || ""}
                onChange={(e) => param("value", e.target.value)}
              />
            </label>
          )}
        </>
      )}
      {draft.operation === "replace" && (
        <div className="form-columns">
          <label className="field">
            原内容
            <input
              value={draft.params.from || ""}
              onChange={(e) => param("from", e.target.value)}
            />
          </label>
          <label className="field">
            替换为
            <input
              value={draft.params.to || ""}
              onChange={(e) => param("to", e.target.value)}
            />
          </label>
        </div>
      )}
      {draft.operation === "enum" && (
        <label className="field">
          映射字典（JSON）
          <textarea
            rows={5}
            value={draft.params.mapping}
            onChange={(e) => param("mapping", e.target.value)}
          />
        </label>
      )}
      {draft.operation === "range" && (
        <div className="form-columns">
          <label className="field">
            最小值
            <input
              type="number"
              value={draft.params.min}
              onChange={(e) => param("min", e.target.value)}
            />
          </label>
          <label className="field">
            最大值
            <input
              type="number"
              value={draft.params.max}
              onChange={(e) => param("max", e.target.value)}
            />
          </label>
        </div>
      )}
      {draft.operation === "round" && (
        <label className="field">
          保留小数位数
          <input
            type="number"
            min="0"
            max="8"
            value={draft.params.digits}
            onChange={(e) => param("digits", e.target.value)}
          />
        </label>
      )}
      {draft.operation === "mask" && (
        <div className="form-columns">
          <label className="field">
            保留前几位
            <input
              type="number"
              min="0"
              max="10"
              value={draft.params.prefix}
              onChange={(e) => param("prefix", e.target.value)}
            />
          </label>
          <label className="field">
            保留后几位
            <input
              type="number"
              min="0"
              max="10"
              value={draft.params.suffix}
              onChange={(e) => param("suffix", e.target.value)}
            />
          </label>
        </div>
      )}
      {draft.operation === "filter" && (
        <>
          <label className="field">
            保留符合以下条件的记录
            <select
              value={draft.params.operator}
              onChange={(e) => param("operator", e.target.value)}
            >
              {[
                "等于",
                "不等于",
                "包含",
                "不包含",
                "大于",
                "小于",
                "为空",
                "不为空",
              ].map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
          </label>
          {!["为空", "不为空"].includes(draft.params.operator) && (
            <label className="field">
              比较值
              <input
                value={draft.params.value || ""}
                onChange={(e) => param("value", e.target.value)}
              />
            </label>
          )}
        </>
      )}
      <Notice>保存参数只修改待执行方案。清洗前仍需预览影响并确认。</Notice>
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
          onClick={() => {
            try {
              if (!draft.name.trim()) throw new Error("请填写规则名称。");
              validateRules([{ ...draft, enabled: true }], fields);
              onSave(draft);
            } catch (e) {
              setError(e instanceof Error ? e.message : "配置无效");
            }
          }}
        >
          保存参数
        </button>
      </div>
    </Dialog>
  );
}
