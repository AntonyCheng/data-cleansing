import type {
  Cell,
  DataRow,
  Field,
  FieldType,
  Issue,
  Profile,
  Rule,
  Run,
  Validation,
} from "./types";
import { makeRule, ruleCatalog } from "../data/rules";
export function isEmpty(v: Cell | undefined): boolean {
  return (
    v == null ||
    ["", "-", "/", "na", "n/a", "null"].includes(v.trim().toLowerCase())
  );
}
export function normalizePhone(v: string) {
  const digits = v.trim().replace(/[\s-]/g, "");
  return digits.startsWith("+86")
    ? digits.slice(3)
    : digits.length === 13 && digits.startsWith("86")
      ? digits.slice(2)
      : digits;
}
export function parseNumber(v: Cell | undefined): number | null {
  if (isEmpty(v)) return null;
  let s = String(v)
    .trim()
    .replace(/[,，¥￥$\s]/g, "");
  let multiplier = 1;
  if (s.endsWith("%")) {
    s = s.slice(0, -1);
    multiplier = 0.01;
  } else if (/万元?$/.test(s)) {
    s = s.replace(/万元?$/, "");
    multiplier = 10000;
  } else s = s.replace(/元$/, "");
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s) * multiplier;
  return Number.isFinite(n) ? n : null;
}
export function normalizeDate(v: string): string | null {
  const s = v.trim();
  let y = 0,
    m = 0,
    d = 0;
  let match = s.match(
    /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/,
  );
  if (match) [, y, m, d] = match.map(Number);
  else {
    match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) {
      m = Number(match[1]);
      d = Number(match[2]);
      y = Number(match[3]);
    } else return null;
  }
  const time = s.match(/[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (
    time &&
    (Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] || 0) > 59)
  )
    return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    y < 1000 ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const aliases: Record<string, string> = {
  cust_phone: "手机号",
  mobile: "手机号",
  phone: "手机号",
  customer_name: "客户姓名",
  cust_name: "客户姓名",
  name: "姓名",
  province: "省份",
  region: "地区",
  amount: "金额",
  order_amount: "订单金额",
  email: "邮箱",
  update_time: "更新时间",
  created_at: "创建日期",
  id_card: "身份证",
  customer_id: "客户编号",
  gender: "性别",
};
export function inferFields(rows: DataRow[]): Field[] {
  return Object.keys(rows[0]?.values || {}).map((key) => {
    const values = rows
      .slice(0, 100)
      .map((r) => r.values[key])
      .filter((v) => !isEmpty(v)) as string[];
    let type: FieldType = "文本";
    if (/phone|mobile|手机|电话/i.test(key)) type = "手机号";
    else if (/身份证|id_card/i.test(key)) type = "身份证";
    else if (/email|邮箱/i.test(key)) type = "邮箱";
    else if (/date|time|日期|时间/i.test(key)) type = "日期";
    else if (
      /amount|price|金额|营收|数量|年龄|库存|单价|销售额/i.test(key) ||
      (values.length > 0 &&
        !/编号|编码|id|code/i.test(key) &&
        values.every((v) => parseNumber(v) !== null))
    )
      type = "数值";
    else if (values.length && values.every((v) => normalizeDate(v) !== null))
      type = "日期";
    return {
      key,
      label: aliases[key] || key,
      type,
      sensitive: ["手机号", "身份证", "邮箱"].includes(type),
      width:
        type === "日期"
          ? 166
          : type === "手机号"
            ? 170
            : type === "邮箱"
              ? 215
              : 140,
      hidden: false,
    };
  });
}
export function fieldStats(rows: DataRow[], field: Field) {
  const values = rows.map((r) => r.values[field.key]);
  const valid = values.filter((v) => !isEmpty(v));
  const unique = new Set(valid).size;
  const counts = new Map<string, number>();
  valid.forEach((v) => counts.set(String(v), (counts.get(String(v)) || 0) + 1));
  return {
    total: rows.length,
    missing: values.length - valid.length,
    unique,
    duplicateRate: valid.length
      ? (((valid.length - unique) / valid.length) * 100).toFixed(1)
      : "0.0",
    top: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    primary:
      rows.length > 0 && valid.length === rows.length && unique === rows.length,
  };
}
function dateOrder(value: Cell | undefined) {
  const s = String(value ?? "");
  const date = normalizeDate(s);
  const time = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return date
    ? date +
        " " +
        (time
          ? time[1].padStart(2, "0") + ":" + time[2] + ":" + (time[3] || "00")
          : "00:00:00")
    : "";
}
function rowKey(row: DataRow, fields: string[]) {
  return JSON.stringify(fields.map((k) => row.values[k] ?? null));
}
export function analyze(rows: DataRow[], fields: Field[]): Profile {
  const issues: Issue[] = [];
  const bad = new Set<string>();
  const keys = fields.map((f) => f.key);
  const seen = new Set<string>();
  const duplicateIds: string[] = [];
  rows.forEach((r) => {
    const key = rowKey(r, keys);
    if (seen.has(key)) duplicateIds.push(r.id);
    else seen.add(key);
  });
  if (duplicateIds.length)
    issues.push({
      id: "duplicates",
      category: "重复数据",
      field: "*",
      title: "发现完全重复记录",
      description: "所有字段完全相同，建议保留第一条。",
      rows: duplicateIds,
      severity: "warning",
    });
  let missing = 0;
  for (const f of fields) {
    const empty: string[] = [],
      format: string[] = [],
      invalid: string[] = [];
    for (const r of rows) {
      const v = r.values[f.key];
      if (isEmpty(v)) {
        empty.push(r.id);
        missing++;
        continue;
      }
      const s = String(v);
      let formatting = s !== s.trim();
      if (f.type === "手机号") {
        const normalized = normalizePhone(s);
        if (!/^1[3-9]\d{9}$/.test(normalized)) invalid.push(r.id);
        else if (normalized !== s) formatting = true;
      }
      if (f.type === "数值") {
        const n = parseNumber(s);
        if (n === null) invalid.push(r.id);
        else if (String(n) !== s) formatting = true;
      }
      if (f.type === "日期") {
        const normalized = normalizeDate(s);
        if (!normalized) invalid.push(r.id);
        else if (!/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(s)) formatting = true;
      }
      if (f.type === "邮箱" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
        invalid.push(r.id);
      if (
        /省|地区|province|region/.test(f.label + f.key) &&
        ["HLJ", "黑龍江", "黑龙江"].includes(s)
      )
        formatting = true;
      if (formatting) format.push(r.id);
    }
    if (empty.length)
      issues.push({
        id: f.key + "-empty",
        category: "缺失值",
        field: f.key,
        title: f.label + "存在缺失值",
        description: "建议统一空值标记，重要字段可移入异常数据集。",
        rows: empty,
        severity: "warning",
      });
    if (format.length)
      issues.push({
        id: f.key + "-format",
        category: "格式问题",
        field: f.key,
        title: f.label + "格式不统一",
        description: "建议按字段语义统一格式，执行前可预览影响。",
        rows: format,
        severity: "warning",
      });
    if (invalid.length)
      issues.push({
        id: f.key + "-invalid",
        category: "非法值",
        field: f.key,
        title: f.label + "存在非法值",
        description: "无法安全转换的记录建议保留到异常数据集。",
        rows: invalid,
        severity: "danger",
      });
  }
  issues.forEach((i) => i.rows.forEach((id) => bad.add(id)));
  const cells = rows.length * fields.length;
  const problemCells = issues.reduce((n, i) => n + i.rows.length, 0);
  const score = rows.length
    ? Math.max(
        0,
        Math.min(
          100,
          Math.round(
            100 -
              (problemCells / Math.max(1, cells)) * 125 -
              (duplicateIds.length / rows.length) * 25,
          ),
        ),
      )
    : 0;
  return {
    score,
    issues,
    problemRows: bad.size,
    cells,
    missing,
    duplicates: duplicateIds.length,
    sensitive: fields.filter((f) => f.sensitive).length,
  };
}
export function recommend(rows: DataRow[], fields: Field[]): Rule[] {
  const p = analyze(rows, fields);
  const defs = [
    "trim",
    "null",
    ...(fields.some((f) => f.type === "手机号") ? ["phone"] : []),
    ...(fields.some((f) => /省|地区|province|region/.test(f.label + f.key))
      ? ["region"]
      : []),
    ...(fields.some((f) => f.type === "日期") ? ["date"] : []),
    ...(fields.some((f) => f.type === "数值") ? ["number"] : []),
    ...(p.duplicates ? ["dedup"] : []),
    ...(fields.some((f) => f.type === "手机号")
      ? ["empty-exception", "validate-phone"]
      : []),
  ];
  return defs.flatMap((id) => {
    const def = ruleCatalog.find((x) => x.id === id)!;
    const targets =
      def.target === "date"
        ? fields.filter((f) => f.type === "日期")
        : def.target === "number"
          ? fields.filter((f) => f.type === "数值")
          : [];
    return targets.length
      ? targets.map((f) => ({ ...makeRule(def, fields), field: f.key }))
      : [makeRule(def, fields)];
  });
}
export function validateRules(rules: Rule[], fields: Field[]) {
  const keys = fields.map((f) => f.key);
  const allowed = new Set(ruleCatalog.map((r) => r.operation));
  for (const r of rules.filter((r) => r.enabled)) {
    if (!allowed.has(r.operation))
      throw new Error("规则操作不在允许执行的列表中。");
    if (r.field !== "*" && !keys.includes(r.field))
      throw new Error(`规则“${r.name}”的目标字段不存在，请重新选择。`);
    if (
      r.operation === "deduplicate" &&
      r.fields.some((k) => !keys.includes(k))
    )
      throw new Error(`规则“${r.name}”引用的联合字段不存在。`);
    if (
      r.operation === "range" &&
      (!Number.isFinite(Number(r.params.min)) ||
        !Number.isFinite(Number(r.params.max)) ||
        Number(r.params.min) > Number(r.params.max))
    )
      throw new Error("请填写有效的数值范围，最小值不能大于最大值。");
    if (
      r.operation === "round" &&
      (!Number.isInteger(Number(r.params.digits)) ||
        Number(r.params.digits) < 0 ||
        Number(r.params.digits) > 8)
    )
      throw new Error("小数位必须为 0–8 的整数。");
    if (r.operation === "enum") {
      let dictionary: unknown;
      try {
        dictionary = JSON.parse(r.params.mapping);
      } catch {
        throw new Error("字典映射必须是有效的 JSON 对象。");
      }
      if (
        !dictionary ||
        Array.isArray(dictionary) ||
        typeof dictionary !== "object" ||
        Object.values(dictionary).some((v) => typeof v !== "string")
      )
        throw new Error("字典的键和值都必须是文本。");
    }
    if (r.operation === "replace" && !r.params.from)
      throw new Error("请填写要替换的原内容。");
    if (
      r.operation === "deduplicate" &&
      r.params.keep === "latest" &&
      (!r.params.orderBy || !keys.includes(r.params.orderBy))
    )
      throw new Error("按最新记录去重时，请指定有效的排序时间字段。");
    if (
      r.operation === "deduplicate" &&
      r.params.suffix &&
      (!Number.isInteger(Number(r.params.suffix)) ||
        Number(r.params.suffix) < 1 ||
        Number(r.params.suffix) > 20)
    )
      throw new Error("手机号后缀长度必须为 1–20 的整数。");
  }
}
function validate(
  before: DataRow[],
  after: DataRow[],
  fields: Field[],
): Validation {
  const metrics = fields
    .filter((f) => /金额|营收|销售额|amount|revenue/i.test(f.key + f.label))
    .map((f) => {
      const sum = (rows: DataRow[]) =>
        rows.reduce((n, r) => n + (parseNumber(r.values[f.key]) || 0), 0);
      const b = sum(before),
        a = sum(after);
      return {
        field: f.label,
        before: b,
        after: a,
        loss: b !== 0 ? (b - a) / Math.abs(b) : 0,
      };
    });
  const messages = metrics
    .filter((m) => m.loss > 0.1)
    .map(
      (m) =>
        `${m.field}合计减少 ${(m.loss * 100).toFixed(1)}%，超过 10% 阈值。请检查去重、过滤和异常分流规则。`,
    );
  if (before.length > 0 && !after.length)
    messages.push("清洗后没有有效数据，请调整方案后重新执行。");
  return { blocked: messages.length > 0, messages, metrics };
}
export function execute(rows: DataRow[], fields: Field[], rules: Rule[]): Run {
  validateRules(rules, fields);
  let result = rows.map((r) => ({ id: r.id, values: { ...r.values } }));
  const deleted: DataRow[] = [];
  const exceptions: Run["exceptions"] = [];
  const impacts: Run["impacts"] = [];
  for (const rule of rules.filter((r) => r.enabled)) {
    let affected = 0;
    const kind =
      rule.operation === "deduplicate" ||
      rule.operation === "drop-empty" ||
      rule.operation === "filter"
        ? "删除"
        : [
              "isolate-empty",
              "validate-phone",
              "validate-email",
              "validate-id",
              "range",
            ].includes(rule.operation)
          ? "异常"
          : "修改";
    if (rule.operation === "deduplicate") {
      const selected = rule.fields.length
        ? rule.fields
        : fields.map((f) => f.key);
      const seen = new Map<string, DataRow>();
      const next: DataRow[] = [];
      const missingRows: DataRow[] = [];
      for (const row of result) {
        if (
          rule.fields.length &&
          selected.some((f) => isEmpty(row.values[f]))
        ) {
          missingRows.push(row);
          continue;
        }
        const key = JSON.stringify(
          selected.map((k) => {
            const v = row.values[k];
            return rule.params.suffix &&
              fields.find((f) => f.key === k)?.type === "手机号" &&
              !isEmpty(v)
              ? normalizePhone(String(v)).slice(-Number(rule.params.suffix))
              : v;
          }),
        );
        const prev = seen.get(key);
        if (!prev) seen.set(key, row);
        else {
          const newest =
            rule.params.keep === "last" ||
            (rule.params.keep === "latest" &&
              dateOrder(row.values[rule.params.orderBy]) >=
                dateOrder(prev.values[rule.params.orderBy]));
          if (newest) {
            deleted.push(prev);
            seen.set(key, row);
          } else deleted.push(row);
          affected++;
        }
      }
      next.push(...seen.values(), ...missingRows);
      const ids = new Set(next.map((r) => r.id));
      result = result.filter((r) => ids.has(r.id));
    } else {
      const targets =
        rule.field === "*" ? fields.map((f) => f.key) : [rule.field];
      let fillValue = rule.params.value || "";
      if (rule.operation === "fill") {
        const valid = result
          .map((r) => r.values[rule.field])
          .filter((v) => !isEmpty(v));
        const nums = valid
          .map((v) => parseNumber(v))
          .filter((v) => v !== null)
          .sort((a, b) => a - b);
        if (rule.params.strategy === "平均值" && nums.length)
          fillValue = String(
            Number((nums.reduce((n, v) => n + v, 0) / nums.length).toFixed(4)),
          );
        if (rule.params.strategy === "中位数" && nums.length) {
          const mid = Math.floor(nums.length / 2);
          fillValue = String(
            nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2,
          );
        }
        if (rule.params.strategy === "众数" && valid.length) {
          const count = new Map<Cell, number>();
          valid.forEach((v) => count.set(v, (count.get(v) || 0) + 1));
          fillValue = String([...count].sort((a, b) => b[1] - a[1])[0][0]);
        }
      }
      let previous: Cell = null;
      const working =
        rule.operation === "fill" && rule.params.strategy === "后值"
          ? [...result].reverse()
          : result;
      const retained: DataRow[] = [];
      for (const row of working) {
        let changed = false;
        let remove = false;
        let exception = false;
        const reasons: string[] = [];
        for (const key of targets) {
          const value = row.values[key];
          const s = value ?? "";
          let next: Cell = value;
          const empty = isEmpty(value);
          switch (rule.operation) {
            case "trim":
              if (value !== null) next = s.trim();
              break;
            case "remove-space":
              if (value !== null) next = s.replace(/\s/g, "");
              break;
            case "nullify":
              if (empty) next = null;
              break;
            case "fill":
              if (empty) {
                if (["前值", "后值"].includes(rule.params.strategy)) {
                  if (previous !== null) next = previous;
                } else if (fillValue) next = fillValue;
              } else previous = value;
              break;
            case "drop-empty":
              if (empty) remove = true;
              break;
            case "isolate-empty":
              if (empty) {
                exception = true;
                reasons.push(`${key}为空`);
              }
              break;
            case "phone":
              if (!empty) next = normalizePhone(s);
              break;
            case "date":
              if (!empty) {
                const normalized = normalizeDate(s);
                if (normalized) {
                  next =
                    /时间|time/i.test(key) && /\d{1,2}:\d{2}/.test(s)
                      ? normalized +
                        " " +
                        s.match(/\d{1,2}:\d{2}(?::\d{2})?/)![0]
                      : normalized;
                } else {
                  exception = true;
                  reasons.push(`${key}不是有效日期`);
                }
              }
              break;
            case "number":
              if (!empty) {
                const n = parseNumber(s);
                if (n !== null) next = String(n);
                else {
                  exception = true;
                  reasons.push(`${key}无法转换为数值`);
                }
              }
              break;
            case "region":
              if (["黑龙江", "黑龍江", "HLJ", "黑龙江省"].includes(s.trim()))
                next = "黑龙江省";
              else if (["浙江", "江苏", "广东", "山东"].includes(s.trim()))
                next = s.trim() + "省";
              break;
            case "enum": {
              const map = JSON.parse(rule.params.mapping) as Record<
                string,
                string
              >;
              if (Object.hasOwn(map, s)) next = map[s];
              break;
            }
            case "validate-phone":
              if (!empty && !/^1[3-9]\d{9}$/.test(s)) {
                exception = true;
                reasons.push(`${key}手机号格式非法`);
              }
              break;
            case "validate-email":
              if (!empty && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
                exception = true;
                reasons.push(`${key}邮箱格式非法`);
              }
              break;
            case "validate-id":
              if (
                !empty &&
                (!/^\d{17}[\dXx]$/.test(s) ||
                  !normalizeDate(
                    `${s.slice(6, 10)}-${s.slice(10, 12)}-${s.slice(12, 14)}`,
                  ))
              ) {
                exception = true;
                reasons.push(`${key}身份证格式非法`);
              }
              break;
            case "range":
              if (!empty) {
                const n = parseNumber(s);
                if (
                  n === null ||
                  n < Number(rule.params.min) ||
                  n > Number(rule.params.max)
                ) {
                  exception = true;
                  reasons.push(
                    `${key}超出范围 ${rule.params.min}–${rule.params.max}`,
                  );
                }
              }
              break;
            case "mask":
              if (!empty) {
                const start = Math.max(0, Number(rule.params.prefix) || 0),
                  end = Math.max(0, Number(rule.params.suffix) || 0);
                next =
                  s.length > start + end
                    ? s.slice(0, start) + "****" + (end ? s.slice(-end) : "")
                    : "****";
              }
              break;
            case "upper":
              if (!empty) next = s.toUpperCase();
              break;
            case "lower":
              if (!empty) next = s.toLowerCase();
              break;
            case "replace":
              if (!empty)
                next = s.split(rule.params.from).join(rule.params.to || "");
              break;
            case "html":
              if (!empty) next = s.replace(/<[^>]*>/g, "");
              break;
            case "round":
              if (!empty) {
                const n = parseNumber(s);
                if (n !== null) next = n.toFixed(Number(rule.params.digits));
              }
              break;
            case "filter": {
              const target = rule.params.value || "",
                n = parseNumber(s),
                other = parseNumber(target);
              const keep = {
                等于: s === target,
                不等于: s !== target,
                包含: s.includes(target),
                不包含: !s.includes(target),
                大于: n !== null && other !== null && n > other,
                小于: n !== null && other !== null && n < other,
                为空: empty,
                不为空: !empty,
              }[rule.params.operator];
              if (!keep) remove = true;
              break;
            }
          }
          if (next !== value) {
            changed = true;
            row.values[key] = next;
          }
        }
        if (exception) {
          exceptions.push({ row, reasons });
          affected++;
        } else if (remove) {
          deleted.push(row);
          affected++;
        } else {
          retained.push(row);
          if (changed) affected++;
        }
      }
      result =
        rule.operation === "fill" && rule.params.strategy === "后值"
          ? retained.reverse()
          : retained;
    }
    impacts.push({ ruleId: rule.id, name: rule.name, affected, kind });
  }
  const originals = new Map(rows.map((r) => [r.id, r]));
  const changed = result
    .filter(
      (r) =>
        JSON.stringify(r.values) !==
        JSON.stringify(originals.get(r.id)?.values),
    )
    .map((r) => r.id);
  return {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    rules: structuredClone(rules.filter((r) => r.enabled)),
    rows: result,
    deleted,
    exceptions,
    changed,
    impacts,
    beforeScore: analyze(rows, fields).score,
    afterScore: analyze(result, fields).score,
    validation: validate(rows, result, fields),
  };
}
export function parseInstruction(
  text: string,
  fields: Field[],
): {
  rules: Rule[];
  custom: boolean;
  name: string;
  explanation: string;
} | null {
  const get = (id: string) =>
    makeRule(
      ruleCatalog.find((r) => r.id === id)!,
      fields,
    );
  const phone = fields.find((f) => f.type === "手机号");
  const named = fields.find(
    (f) => text.includes(f.label) || text.includes(f.key),
  );
  let rules: Rule[] = [];
  let custom = false;
  if (/手机号.*空|空.*手机号/.test(text) && /异常/.test(text)) {
    if (!phone) return null;
    rules = [get("empty-exception")];
  } else if (/重复|去重|同一个客户|(?:一样|相同).*保留/.test(text)) {
    const composite = /姓名|客户名称|客户名/.test(text) && /手机/.test(text);
    if (composite && !phone) return null;
    const rule = get(composite ? "customer-dedup" : "dedup");
    if (/最新|更新/.test(text)) {
      rule.params.keep = "latest";
      if (!rule.params.orderBy) return null;
    } else if (/最后/.test(text)) rule.params.keep = "last";
    const suffix = text.match(/后\s*(\d+)\s*位/);
    if (suffix && phone) {
      rule.params.suffix = suffix[1];
      rule.name = `客户手机号后${suffix[1]}位联合去重`;
      custom = true;
    }
    rules = [rule];
  } else if (/黑龙江|HLJ|黑龍江/.test(text)) {
    if (!fields.some((f) => /省|地区|province|region/.test(f.key + f.label)))
      return null;
    rules = [get("region")];
  } else if (/空格/.test(text)) {
    const rule = get(
      /所有|全部|去掉空格|去除空格/.test(text) ? "space" : "trim",
    );
    rule.field = phone && /手机/.test(text) ? phone.key : named?.key || "*";
    rules = [rule];
  } else if (/脱敏|隐藏.*手机/.test(text)) {
    const rule = get("mask");
    rule.field = named?.key || phone?.key || fields[0].key;
    rules = [rule];
  } else if (/手机号/.test(text)) {
    if (!phone) return null;
    rules = [get("phone"), get("validate-phone")];
  } else if (/日期|年月日/.test(text)) {
    if (!fields.some((f) => f.type === "日期")) return null;
    rules = [get("date")];
  } else if (/金额|千分位|货币/.test(text)) {
    if (!fields.some((f) => f.type === "数值")) return null;
    rules = [get("number")];
  } else if (/空值|缺失/.test(text)) {
    const rule = get(/填充/.test(text) ? "fill" : "null");
    if (named) rule.field = named.key;
    const value = text.match(/填充(?:为|成)?[“"']?([^”"'，。]+)[”"']?/);
    if (value) rule.params.value = value[1].trim();
    rules = [rule];
  }
  if (!rules.length) return null;
  return {
    rules,
    custom,
    name: rules[0].name,
    explanation: custom
      ? "已组合字段截取与联合去重，形成新的可复用规则。请检查字段和参数后执行。"
      : "已匹配系统已有规则，查看影响范围并确认后才会执行。",
  };
}
export function csv(rows: DataRow[], fields: Field[]) {
  const esc = (v: Cell) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@\t\r]/, "'$&")
      .replace(/"/g, '""') +
    '"';
  return (
    "\ufeff" +
    [
      fields.map((f) => esc(f.label)).join(","),
      ...rows.map((r) => fields.map((f) => esc(r.values[f.key])).join(",")),
    ].join("\r\n")
  );
}
export function download(name: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function sqlType(type: FieldType) {
  return {
    文本: "VARCHAR(255)",
    手机号: "VARCHAR(32)",
    数值: "DECIMAL(18,4)",
    日期: "DATETIME",
    邮箱: "VARCHAR(255)",
    身份证: "VARCHAR(32)",
  }[type];
}
