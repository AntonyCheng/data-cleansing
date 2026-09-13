import type { DataRow, DataTask, Store } from "../lib/types";
import { execute, inferFields, recommend } from "../lib/engine";
import { makeRule, ruleCatalog } from "./rules";
import { heilongjiangCityRows } from "./heilongjiang";
const names = [
  "陈雨桐",
  "王子轩",
  "李沐阳",
  "张欣怡",
  "刘思远",
  "赵一诺",
  "周亦然",
  "吴星辰",
  "郑予安",
  "孙嘉宁",
  "徐知夏",
  "林书言",
];
export function sampleRows(): DataRow[] {
  const rows: DataRow[] = Array.from({ length: 48 }, (_, i) => ({
    id: `row-${i + 1}`,
    values: {
      customer_id: `CUS${String(i + 1001)}`,
      customer_name: (i % 11 === 0 ? " " : "") + names[i % 12],
      cust_phone:
        i === 5
          ? "-"
          : i === 17
            ? "138000"
            : "138" +
              String(12340000 + i * 2417).replace(
                /(\d{4})(\d{4})/,
                (all, a, b) => (i % 6 === 0 ? `-${a}-${b}` : all),
              ),
      province: ["黑龙江", "黑龙江省", "HLJ", "浙江省", "黑龍江", "广东省"][
        i % 6
      ],
      amount:
        i % 4 === 0
          ? (1500 + i * 250).toLocaleString("en-US") + "元"
          : String(1500 + i * 250),
      created_at:
        i % 3 === 0 ? "2026/9/1" : i % 3 === 1 ? "2026年9月2日" : "2026-09-03",
      email: `customer${i + 1}@example.com`,
      gender: ["男", "女", "M", "F"][i % 4],
      update_time: `2026-09-${String((i % 10) + 1).padStart(2, "0")} 10:30:00`,
    },
  }));
  rows.push(
    { id: "row-49", values: { ...rows[0].values } },
    { id: "row-50", values: { ...rows[1].values } },
  );
  return rows;
}
export function makeTask(
  name: string,
  source: string,
  sourceType: string,
  raw: DataRow[],
  demo = false,
): DataTask {
  const fields = inferFields(raw);
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    source,
    sourceType,
    raw,
    fields,
    plan: recommend(raw, fields),
    runs: [],
    createdAt: now,
    updatedAt: now,
    demo,
  };
}
export function createSeed(): Store {
  const task = makeTask(
    "客户数据标准化",
    "客户数据_2026年9月.xlsx",
    "Excel",
    sampleRows(),
    true,
  );
  task.id = "customers";
  const orders = makeTask(
    "电商订单数据整理",
    "订单中心 · 每日订单",
    "MySQL",
    Array.from({ length: 24 }, (_, i) => ({
      id: `order-${i}`,
      values: {
        order_id: `ORD${2026001 + i}`,
        商品: ["桌面收纳盒", "便携咖啡杯", "无线键盘"][i % 3],
        订单金额: i % 3 === 0 ? "1,200元" : "380",
        下单日期: "2026/9/10",
        状态: "已支付",
      },
    })),
    true,
  );
  orders.id = "orders";
  orders.runs = [execute(orders.raw, orders.fields, orders.plan)];
  const products = makeTask(
    "商品主数据同步",
    "商品开放接口",
    "API",
    Array.from({ length: 16 }, (_, i) => ({
      id: `product-${i}`,
      values: {
        sku: `SKU${10001 + i}`,
        商品名称: ["桌面收纳盒", "便携咖啡杯", "无线键盘"][i % 3],
        库存: String(i * 12 + 32),
        单价: String(i * 20 + 120),
      },
    })),
    true,
  );
  products.id = "products";
  products.runs = [execute(products.raw, products.fields, products.plan)];
  const dest = {
    connection: "本地演示数仓",
    database: "standard",
    table: "dim_products",
    mode: "新建表" as const,
    primaryKey: "sku",
    mappings: Object.fromEntries(
      products.fields.map((f, i) => [
        f.key,
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.key) ? f.key : "field_" + (i + 1),
      ]),
    ),
    types: Object.fromEntries(
      products.fields.map((f) => [
        f.key,
        f.type === "数值" ? "DECIMAL(18,4)" : "VARCHAR(255)",
      ]),
    ),
  };
  products.storedRunId = products.runs[0].id;
  products.destination = dest;
  products.storedAt = new Date().toISOString();
  const customerDedup = makeRule(
    ruleCatalog.find((r) => r.id === "customer-dedup")!,
    task.fields,
  );
  // 黑龙江省地市经济与人口指标：真实数据（黑龙江统计年鉴2025 + 第七次全国人口普查公报），
  // 见 data/heilongjiang.ts 顶部注释的完整来源说明；保持"待清洗"状态，供现场演示地区别名规则和去重。
  const heilongjiang = makeTask(
    "黑龙江省地市经济与人口指标",
    "黑龙江省统计局 · 黑龙江统计年鉴2025 / 第七次全国人口普查公报",
    "Excel",
    heilongjiangCityRows(),
    true,
  );
  heilongjiang.id = "heilongjiang";
  return {
    tasks: [task, orders, products, heilongjiang],
    mediaTasks: [],
    services: [],
    savedRules: [
      {
        id: "enterprise-1",
        name: "企业客户唯一性检查",
        description: "按客户姓名与手机号联合去重，保留更新时间最新的记录。",
        scope: "企业规则",
        rules: [customerDedup],
        fieldTypes: ["文本", "手机号", "日期"],
        createdBy: "数据管理组",
        method: "手工创建",
        createdAt: new Date().toISOString(),
        uses: 6,
        version: 1,
      },
    ],
    templates: [
      {
        id: "template-customer",
        name: "客户数据标准清洗模板",
        description: "去空格、标准化、去重与异常分流，适合客户主数据。",
        rules: task.plan,
        createdAt: new Date().toISOString(),
        uses: 12,
      },
    ],
    warehouses: [
      {
        id: "standard.dim_products",
        destination: dest,
        rows: products.runs[0].rows.map((row) => ({
          id: row.id,
          values: Object.fromEntries(
            Object.entries(dest.mappings).map(([key, target]) => [
              target,
              row.values[key],
            ]),
          ),
        })),
        taskId: products.id,
        runId: products.runs[0].id,
        updatedAt: products.storedAt,
      },
    ],
  };
}
