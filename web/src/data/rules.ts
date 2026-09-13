import type { Field, Rule, RuleDefinition } from "../lib/types";
export const categories = [
  "全部规则",
  "空值处理",
  "重复数据",
  "字符串清洗",
  "数字处理",
  "日期时间",
  "格式校验",
  "地址清洗",
  "字典映射",
  "异常值处理",
  "记录过滤",
  "数据脱敏",
];
export const ruleCatalog: RuleDefinition[] = [
  {
    id: "trim",
    name: "去除首尾空格",
    category: "字符串清洗",
    description: "清除字段值两端的空格，保留内容中的空格。",
    operation: "trim",
    target: "all",
    tags: ["文本", "通用"],
  },
  {
    id: "space",
    name: "删除全部空格",
    category: "字符串清洗",
    description: "删除空格、换行与 Tab，适合手机号和编码。",
    operation: "remove-space",
    target: "text",
    tags: ["文本"],
  },
  {
    id: "null",
    name: "空值标记统一为 NULL",
    category: "空值处理",
    description: "将空字符串、-、/、NA、N/A、null 统一为真正的 NULL。",
    operation: "nullify",
    target: "all",
    tags: ["所有类型", "推荐"],
  },
  {
    id: "fill",
    name: "空值填充固定值",
    category: "空值处理",
    description: "保留空值记录，使用指定内容填充。",
    operation: "fill",
    target: "text",
    params: { value: "未知", strategy: "固定值" },
    tags: ["所有类型"],
  },
  {
    id: "mean",
    name: "空值填充平均值",
    category: "空值处理",
    description: "按当前字段有效数值计算平均值，不会跨字段填充。",
    operation: "fill",
    target: "number",
    params: { strategy: "平均值" },
    tags: ["数值"],
  },
  {
    id: "median",
    name: "空值填充中位数",
    category: "空值处理",
    description: "用有效数值的中位数填充缺失数据。",
    operation: "fill",
    target: "number",
    params: { strategy: "中位数" },
    tags: ["数值"],
  },
  {
    id: "mode",
    name: "空值填充众数",
    category: "空值处理",
    description: "用当前字段出现最多的非空值填充。",
    operation: "fill",
    target: "text",
    params: { strategy: "众数" },
    tags: ["文本", "枚举"],
  },
  {
    id: "forward",
    name: "前值填充",
    category: "空值处理",
    description: "使用前一个非空值，首行空值会保留。",
    operation: "fill",
    target: "text",
    params: { strategy: "前值" },
    tags: ["所有类型"],
  },
  {
    id: "backward",
    name: "后值填充",
    category: "空值处理",
    description: "使用后一个非空值，末行空值会保留。",
    operation: "fill",
    target: "text",
    params: { strategy: "后值" },
    tags: ["所有类型"],
  },
  {
    id: "empty-exception",
    name: "空值记录进入异常集",
    category: "空值处理",
    description: "将目标字段为空的记录移入异常数据集，原始记录始终保留。",
    operation: "isolate-empty",
    target: "phone",
    tags: ["所有类型", "推荐"],
  },
  {
    id: "drop-empty",
    name: "删除空值记录",
    category: "空值处理",
    description: "从结果中移除字段为空的记录，清洗记录中保留删除明细。",
    operation: "drop-empty",
    target: "text",
    tags: ["所有类型"],
  },
  {
    id: "dedup",
    name: "删除完全重复记录",
    category: "重复数据",
    description: "按全部字段判定完全重复，默认保留第一条。",
    operation: "deduplicate",
    target: "all",
    params: { keep: "first" },
    tags: ["整行", "推荐"],
  },
  {
    id: "customer-dedup",
    name: "姓名 + 手机号联合去重",
    category: "重复数据",
    description:
      "相同姓名与手机号视为重复，按时间保留最新；缺失身份字段不合并。",
    operation: "deduplicate",
    target: "phone",
    params: { keep: "latest" },
    tags: ["联合主键"],
  },
  {
    id: "key-dedup",
    name: "指定字段组合去重",
    category: "重复数据",
    description: "自定义一个或多个唯一字段，选择保留方式。",
    operation: "deduplicate",
    target: "text",
    params: { keep: "first" },
    tags: ["自定义字段"],
  },
  {
    id: "upper",
    name: "转换为大写",
    category: "字符串清洗",
    description: "将英文字符转换为大写。",
    operation: "upper",
    target: "text",
    tags: ["文本"],
  },
  {
    id: "lower",
    name: "转换为小写",
    category: "字符串清洗",
    description: "将英文字符转换为小写。",
    operation: "lower",
    target: "text",
    tags: ["文本"],
  },
  {
    id: "replace",
    name: "指定内容替换",
    category: "字符串清洗",
    description: "按字面内容替换，不执行用户代码或正则脚本。",
    operation: "replace",
    target: "text",
    params: { from: "旧内容", to: "新内容" },
    tags: ["文本"],
  },
  {
    id: "html",
    name: "删除 HTML 标签",
    category: "字符串清洗",
    description: "移除文本中的 HTML 标签，保留文字内容。",
    operation: "html",
    target: "text",
    tags: ["网页文本"],
  },
  {
    id: "number",
    name: "金额与单位标准化",
    category: "数字处理",
    description: "移除千分位、货币符号和元，将万元换算为元，百分数换算为小数。",
    operation: "number",
    target: "number",
    tags: ["数值", "推荐"],
  },
  {
    id: "round",
    name: "小数位统一",
    category: "数字处理",
    description: "将数值四舍五入为指定小数位。",
    operation: "round",
    target: "number",
    params: { digits: "2" },
    tags: ["数值"],
  },
  {
    id: "date",
    name: "日期格式统一",
    category: "日期时间",
    description:
      "支持年月日、斜杠日期和美国月/日/年格式，统一为 YYYY-MM-DD。非法日期移入异常集。",
    operation: "date",
    target: "date",
    tags: ["日期", "推荐"],
  },
  {
    id: "phone",
    name: "手机号格式标准化",
    category: "格式校验",
    description: "去除 +86 / 86 前缀、空格和横杠，不截断或补造号码。",
    operation: "phone",
    target: "phone",
    tags: ["手机号", "推荐"],
  },
  {
    id: "validate-phone",
    name: "手机号合法性校验",
    category: "格式校验",
    description:
      "检查是否为以 1 开头、第二位 3–9 的 11 位号码；异常记录进入异常集。",
    operation: "validate-phone",
    target: "phone",
    tags: ["手机号"],
  },
  {
    id: "email",
    name: "邮箱格式校验",
    category: "格式校验",
    description: "检查邮箱基本结构，非法邮箱进入异常集。",
    operation: "validate-email",
    target: "email",
    tags: ["邮箱"],
  },
  {
    id: "id",
    name: "身份证格式校验",
    category: "格式校验",
    description: "检查 18 位长度、字符和出生日期；不包含权威身份或校验码认证。",
    operation: "validate-id",
    target: "id",
    tags: ["身份证"],
  },
  {
    id: "region",
    name: "省份名称标准化",
    category: "地址清洗",
    description: "将黑龙江、黑龍江、HLJ 等字典别名统一为黑龙江省。",
    operation: "region",
    target: "region",
    tags: ["地区", "推荐"],
  },
  {
    id: "enum",
    name: "枚举值字典映射",
    category: "字典映射",
    description: "以 JSON 字典将多个别名映射为同一标准值。",
    operation: "enum",
    target: "text",
    params: { mapping: '{"M":"男","男性":"男","F":"女","女性":"女"}' },
    tags: ["枚举"],
  },
  {
    id: "range",
    name: "数值范围校验",
    category: "异常值处理",
    description: "不在指定范围内的记录移入异常数据集，不直接删除。",
    operation: "range",
    target: "number",
    params: { min: "0", max: "1000000" },
    tags: ["数值"],
  },
  {
    id: "filter",
    name: "按条件过滤记录",
    category: "记录过滤",
    description: "支持等于、不等于、包含、不包含、大于、小于、为空及不为空。",
    operation: "filter",
    target: "text",
    params: { operator: "包含", value: "" },
    tags: ["条件"],
  },
  {
    id: "mask",
    name: "敏感字段脱敏",
    category: "数据脱敏",
    description: "保留首尾指定字符，中间替换为星号；短值全部隐藏。",
    operation: "mask",
    target: "phone",
    params: { prefix: "3", suffix: "4" },
    tags: ["敏感字段"],
  },
];
export function makeRule(def: RuleDefinition, fields: Field[]): Rule {
  const match = fields.find((f) =>
    def.target === "phone"
      ? f.type === "手机号"
      : def.target === "date"
        ? f.type === "日期"
        : def.target === "number"
          ? f.type === "数值"
          : def.target === "email"
            ? f.type === "邮箱"
            : def.target === "id"
              ? f.type === "身份证"
              : def.target === "region"
                ? /省|地区|province|region/.test(f.key + f.label)
                : f.type === "文本",
  );
  const field =
    def.target === "all" ? "*" : match?.key || fields[0]?.key || "*";
  const combo =
    def.operation !== "deduplicate"
      ? []
      : def.id === "customer-dedup"
        ? fields
            .filter(
              (f) =>
                /姓名|客户名|customer.?name|^name$/i.test(
                  f.key + " " + f.label,
                ) || f.type === "手机号",
            )
            .map((f) => f.key)
        : def.id === "dedup"
          ? []
          : [field];
  return {
    id: crypto.randomUUID(),
    catalogId: def.id,
    operation: def.operation,
    name: def.name,
    field,
    fields: combo,
    params: {
      ...def.params,
      ...(def.operation === "deduplicate"
        ? {
            orderBy:
              fields.find((f) => /更新|update/i.test(f.key + f.label))?.key ||
              fields.find((f) => f.type === "日期")?.key ||
              "",
          }
        : {}),
    },
    enabled: true,
  };
}
