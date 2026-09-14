// 演示数据生成脚本：从 web/src/data 的 TS 数据源（唯一真源）生成
//  1. demo-data/heilongjiang-init.sql —— demo-db 容器的初始化 SQL（4 张表）
//  2. demo-api/data.json            —— demo-api 演示接口内嵌的年度序列数据
// 运行：npx tsx demo-data/generate.mts（在仓库根目录执行）
// 手改生成文件没有意义，改 web/src/data 里的源数据后重新跑本脚本即可。
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { heilongjiangCityRows } from "../web/src/data/heilongjiang.ts";
import {
  hljGdp2025Rows,
  hljGrainRows,
  hljTourismRows,
  hljTradeSeries,
  hljOilfieldSeries,
  hljEcoRows,
} from "../web/src/data/hlj2025.ts";
import { hljScenicRows } from "../web/src/data/hljScenic.ts";
import { hljScenicAllRows } from "../web/src/data/hljScenicExtra.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function sqlText(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function createTable(tableName: string, rows: Record<string, unknown>[]) {
  const columns = Object.keys(rows[0]);
  const colList = columns.map((c) => `"${c}" text`).join(",\n  ");
  const values = rows
    .map(
      (r) =>
        `(${columns.map((c) => sqlText(r[c])).join(", ")})`,
    )
    .join(",\n");
  return `CREATE TABLE ${tableName} (\n  ${colList}\n);\n\nINSERT INTO ${tableName} (${columns.map((c) => `"${c}"`).join(", ")}) VALUES\n${values};\n`;
}

function rowsToRecords(rows: { values: Record<string, unknown> }[]) {
  // DataRow -> 纯 record（去掉 id），并保留 null（生成 NULL 列）
  return rows.map((r) => ({ ...r.values }));
}

const gdp = rowsToRecords(hljGdp2025Rows());
const grain = rowsToRecords(hljGrainRows());
const tourism = rowsToRecords(hljTourismRows());
const scenic = rowsToRecords(hljScenicAllRows());
const cities = rowsToRecords(heilongjiangCityRows());

const sql = `-- 演示用数据库：黑龙江省多维度真实数据，共 5 张表。
-- 由 demo-data/generate.mts 从 web/src/data/{heilongjiang,hlj2025,hljScenic}.ts 生成（唯一数据真源），勿手改。
-- 数据来源（均为权威公开数据，字段口径见 TS 源文件顶部注释）：
--   heilongjiang_cities  经济指标 2024（统计年鉴2025）+ 人口指标 2020（第七次全国人口普查公报）
--   hlj_gdp_2025         各地市 2025 年 GDP（各地市 2025 年统计公报 + 省统计局 2025 年公报）
--   hlj_grain_2024       各地市 2024 年粮食产量（各地市公报 + 新华社"二十二连丰"报道）
--   hlj_tourism          哈尔滨 2022-2025 三个冰雪季游客量与花费（哈尔滨市文广旅局）
--   hlj_scenic_spots     全省 438 家 A 级旅游景区（省文旅厅《2023年全省A级旅游景区名录》官方原件）
-- 供"数据库"连接器现场演示：真实连接、列表选表、抓取黑龙江真实数据。
-- 故意保留的"脏数据"（配合清洗规则演示）：省份别名混写（黑龙江/黑龍江/HLJ）、千分位格式不一、
-- 重复报送行（cities 表佳木斯、grain 表绥化）、未披露数值留空（NULL）。

${createTable("heilongjiang_cities", cities)}
${createTable("hlj_gdp_2025", gdp)}
${createTable("hlj_grain_2024", grain)}
${createTable("hlj_tourism", tourism)}
${createTable("hlj_scenic_spots", scenic)}
`;

writeFileSync(join(ROOT, "demo-data", "heilongjiang-init.sql"), sql);
writeFileSync(
  join(ROOT, "demo-api", "data.json"),
  JSON.stringify({ trade: hljTradeSeries, oilfield: hljOilfieldSeries, eco: hljEcoRows }, null, 2) + "\n",
);
console.log(
  `已生成 demo-data/heilongjiang-init.sql（5 表：${cities.length}+${gdp.length}+${grain.length}+${tourism.length}+${scenic.length} 行）和 demo-api/data.json`,
);
