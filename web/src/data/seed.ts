import type { DataServiceConfig, DataRow, DataTask, Store } from "../lib/types";
import { execute, inferFields, recommend } from "../lib/engine";
import { makeRule, ruleCatalog } from "./rules";
import { heilongjiangCityRows } from "./heilongjiang";
import {
  hljGdp2025Rows,
  hljGrainRows,
  hljTourismRows,
  hljTradeSeries,
} from "./hlj2025";
import { hljScenicAllRows } from "./hljScenicExtra";
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
// 演示账号的初始工作区：全部为黑龙江省真实数据任务（见各数据文件顶部注释的来源说明）。
// 「黑龙江省地市经济与人口指标」预执行清洗并入库、预配置好对外服务——部署开箱即有
// “清洗完成 + 已入库 + 服务已生效”的完整状态可讲；其余 3 个保持待清洗，供现场演示完整流程。
// sampleRows()（客户数据样例）只作为创建任务向导里的“使用样例”按钮数据，不再进种子。
export function createSeed(): Store {
  const now = new Date().toISOString();
  const heilongjiang = makeTask(
    "黑龙江省地市经济与人口指标",
    "黑龙江省统计局 · 黑龙江统计年鉴2025 / 第七次全国人口普查公报",
    "Excel",
    heilongjiangCityRows(),
    true,
  );
  heilongjiang.id = "heilongjiang";
  heilongjiang.runs = [
    execute(heilongjiang.raw, heilongjiang.fields, heilongjiang.plan),
  ];
  const dest = {
    connection: "本地演示数仓",
    database: "standard",
    table: "dim_hlj_cities",
    mode: "新建表" as const,
    primaryKey: heilongjiang.fields[0].key,
    mappings: Object.fromEntries(
      heilongjiang.fields.map((f, i) => [
        f.key,
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(f.key) ? f.key : "field_" + (i + 1),
      ]),
    ),
    types: Object.fromEntries(
      heilongjiang.fields.map((f) => [
        f.key,
        f.type === "数值" ? "DECIMAL(18,4)" : "VARCHAR(255)",
      ]),
    ),
  };
  heilongjiang.storedRunId = heilongjiang.runs[0].id;
  heilongjiang.destination = dest;
  heilongjiang.storedAt = now;

  // —— 以下三个任务保持“待清洗”，是现场演示清洗全流程的素材 ——
  const gdp2025 = makeTask(
    "黑龙江省2025年各地市生产总值",
    "各地市2025年统计公报 · 黑龙江省统计局2025年公报",
    "Excel",
    hljGdp2025Rows(),
    true,
  );
  gdp2025.id = "hlj-gdp-2025";
  const grain = makeTask(
    "黑龙江省各地市粮食产量",
    "各地市2024年统计公报 · 新华社（二十二连丰）",
    "Excel",
    hljGrainRows(),
    true,
  );
  grain.id = "hlj-grain";
  const tourism = makeTask(
    "哈尔滨冰雪季旅游数据",
    "哈尔滨市文化广电和旅游局",
    "数据库",
    hljTourismRows(),
    true,
  );
  tourism.id = "hlj-tourism";
  // A 级景区名录：438 条官方原件 + 14 条注入的演示脏数据（见 hljScenicExtra.ts），
  // 既是"大数据表"（分页/AI 问答/对外服务），一键清洗也能看出真实效果。
  const scenic = makeTask(
    "黑龙江省A级旅游景区名录",
    "黑龙江省文化和旅游厅 · 2023年全省A级旅游景区名录",
    "Excel",
    hljScenicAllRows(),
    true,
  );
  scenic.id = "hlj-scenic";
  // 对俄贸易序列：API 来源的示例任务（数据来自 demo-api 的 /api/trade，哈尔滨海关历年发布），
  // 与"创建数据任务 → API"入口的演示数据源同源——现场实时抓取的结果和这个任务一致，可互为印证。
  // 2023 年出口/进口、非 2024 年份的对俄值公报未披露，留空正好演示空值处理。
  const trade = makeTask(
    "黑龙江省对俄贸易年度序列",
    "黑龙江省演示数据API · 哈尔滨海关历年发布",
    "API",
    hljTradeSeries.map((row, i) => ({
      id: `hlj-trade-${i + 1}`,
      values: { ...row },
    })),
    true,
  );
  trade.id = "hlj-trade";

  // 预置已生效的数据服务：部署后 GET /api/data-services/hlj-city-indicators
  // 无需任何配置即可现场调用，返回的是清洗后的真实黑龙江数据。
  const services: DataServiceConfig[] = [
    {
      taskId: "heilongjiang",
      runId: heilongjiang.runs[0].id,
      name: "黑龙江省地市指标服务",
      slug: "hlj-city-indicators",
      description: "清洗后的黑龙江省 13 地市经济与人口指标（演示）",
      fields: [
        "地市",
        "所属省份",
        "地区生产总值_亿元",
        "人均GDP_元",
        "常住人口_2020年七普",
        "城镇化率_百分比",
      ],
      pageSize: 20,
      updatedAt: now,
    },
  ];
  const regionRule = makeRule(
    ruleCatalog.find((r) => r.id === "region")!,
    heilongjiang.fields,
  );
  return {
    tasks: [heilongjiang, gdp2025, grain, tourism, scenic, trade],
    // 媒体任务不再预置占位样例——上传图片/音频/视频创建的媒体任务会进入这个列表
    mediaTasks: [],
    services,
    savedRules: [
      {
        id: "enterprise-region",
        name: "地区名称标准化",
        description: "将黑龙江 / 黑龍江 / HLJ 等地区别名统一为标准写法“黑龙江省”。",
        scope: "企业规则",
        rules: [regionRule],
        fieldTypes: ["文本"],
        createdBy: "数据管理组",
        method: "手工创建",
        createdAt: now,
        uses: 6,
        version: 1,
      },
    ],
    templates: [
      {
        id: "template-hlj-cities",
        name: "地区指标清洗模板",
        description: "地区别名标准化、数值格式统一与去重，适合地区统计指标类数据。",
        rules: heilongjiang.plan,
        createdAt: now,
        uses: 12,
      },
    ],
    warehouses: [
      {
        id: "standard.dim_hlj_cities",
        destination: dest,
        rows: heilongjiang.runs[0].rows.map((row) => ({
          id: row.id,
          values: Object.fromEntries(
            Object.entries(dest.mappings).map(([key, target]) => [
              target,
              row.values[key],
            ]),
          ),
        })),
        taskId: heilongjiang.id,
        runId: heilongjiang.runs[0].id,
        updatedAt: heilongjiang.storedAt,
      },
    ],
  };
}
