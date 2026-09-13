export type Cell = string | null;
export type DataRow = { id: string; values: Record<string, Cell> };
export type FieldType = "文本" | "手机号" | "数值" | "日期" | "邮箱" | "身份证";
export type Field = {
  key: string;
  label: string;
  type: FieldType;
  sensitive: boolean;
  width: number;
  hidden: boolean;
};
export type Operation =
  | "trim"
  | "remove-space"
  | "nullify"
  | "fill"
  | "drop-empty"
  | "isolate-empty"
  | "deduplicate"
  | "phone"
  | "date"
  | "number"
  | "region"
  | "enum"
  | "validate-phone"
  | "validate-email"
  | "validate-id"
  | "range"
  | "mask"
  | "upper"
  | "lower"
  | "replace"
  | "html"
  | "round"
  | "filter";
export type Rule = {
  id: string;
  catalogId: string;
  operation: Operation;
  name: string;
  field: string;
  fields: string[];
  params: Record<string, string>;
  enabled: boolean;
};
export type RuleDefinition = {
  id: string;
  name: string;
  category: string;
  description: string;
  operation: Operation;
  target:
    "all" | "text" | "phone" | "date" | "number" | "region" | "email" | "id";
  params?: Record<string, string>;
  tags: string[];
};
export type Issue = {
  id: string;
  category: string;
  field: string;
  title: string;
  description: string;
  rows: string[];
  severity: "warning" | "danger";
};
export type Profile = {
  score: number;
  issues: Issue[];
  problemRows: number;
  cells: number;
  missing: number;
  duplicates: number;
  sensitive: number;
};
export type ExceptionRow = { row: DataRow; reasons: string[] };
export type Impact = {
  ruleId: string;
  name: string;
  affected: number;
  kind: "修改" | "删除" | "异常";
};
export type Validation = {
  blocked: boolean;
  messages: string[];
  metrics: { field: string; before: number; after: number; loss: number }[];
};
export type Run = {
  id: string;
  time: string;
  rules: Rule[];
  rows: DataRow[];
  deleted: DataRow[];
  exceptions: ExceptionRow[];
  changed: string[];
  impacts: Impact[];
  beforeScore: number;
  afterScore: number;
  validation: Validation;
};
export type Destination = {
  connection: string;
  database: string;
  table: string;
  mode: "新建表" | "覆盖表" | "追加数据" | "增量更新";
  primaryKey: string;
  mappings: Record<string, string>;
  types: Record<string, string>;
};
export type DataTask = {
  id: string;
  name: string;
  source: string;
  sourceType: string;
  sourceSchedule?: string;
  createdAt: string;
  updatedAt: string;
  fields: Field[];
  raw: DataRow[];
  plan: Rule[];
  runs: Run[];
  storedRunId?: string;
  destination?: Destination;
  storedAt?: string;
  demo: boolean;
};
export type SavedRule = {
  id: string;
  name: string;
  description: string;
  scope: "我的清洗规则" | "企业规则";
  rules: Rule[];
  fieldTypes: string[];
  createdBy: string;
  method: "AI 生成" | "系统复制" | "手工创建";
  createdAt: string;
  uses: number;
  lastUsed?: string;
  version: number;
};
export type Template = {
  id: string;
  name: string;
  description: string;
  rules: Rule[];
  createdAt: string;
  uses: number;
};
export type DataServiceConfig = {
  taskId: string;
  runId: string;
  name: string;
  slug: string;
  description: string;
  fields: string[];
  pageSize: number;
  updatedAt: string;
};
export type Warehouse = {
  id: string;
  destination: Destination;
  rows: DataRow[];
  taskId: string;
  runId: string;
  updatedAt: string;
};
export type MediaTaskStatus = "running" | "succeeded" | "failed";
export type MediaTask = {
  id: string;
  kind: "image" | "audio" | "video";
  name: string;
  filename: string;
  mediaUrl?: string;
  createdAt: string;
  updatedAt: string;
  status: MediaTaskStatus;
  error?: string;
  // 完成后缓存的结构化结果（已去除大体积缩略图），刷新页面 / 重新打开任务时直接渲染
  envelope?: import("./media").TaskEnvelope;
};
export type Store = {
  tasks: DataTask[];
  mediaTasks: MediaTask[];
  services?: DataServiceConfig[];
  savedRules: SavedRule[];
  templates: Template[];
  warehouses: Warehouse[];
};
export type SheetView = "raw" | "cleaned" | "exceptions" | "history";
