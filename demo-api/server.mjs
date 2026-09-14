// 黑龙江演示 API：给「API 连接器」现场演示用的真实 HTTP 服务。
// 数据与 web/src/data/hlj2025.ts 同源（由 demo-data/generate.mts 生成 data.json，两边保证一致），
// 内容是真实的黑龙江省年度序列数据（哈尔滨海关 / 新华网 / 国资委历年公开报道）。
// 特性（均为演示 API 连接器能力而设）：
// - API Key 鉴权（X-Api-Key 请求头，密钥来自 DEMO_API_KEY，默认 hlj-demo-2026）
// - 页码翻页（page / pageSize，默认 pageSize=2，正好演示连接器翻页抓全）
// - 免鉴权的静态演示网页 /page/bulletin.html（给「URL / 网页」来源演示真实抓取解析）
// 零 npm 依赖，node server.mjs 直接跑。
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const { trade, oilfield, eco } = JSON.parse(readFileSync(join(ROOT, "data.json"), "utf8"));

const PORT = Number(process.env.PORT || 8090);
const API_KEY = process.env.DEMO_API_KEY || "hlj-demo-2026";

function paginate(list, url) {
  const page = Math.max(1, Number(url.searchParams.get("page") || 1) || 1);
  const pageSize = Math.min(20, Math.max(1, Number(url.searchParams.get("pageSize") || 2) || 2));
  return {
    page,
    pageSize,
    total: list.length,
    data: list.slice((page - 1) * pageSize, page * pageSize),
  };
}

// 自托管"统计公报摘要"网页：政府公报风格静态页，内嵌生态环境指标表格。
// 「URL / 网页」来源演示时抓这个地址（容器网内 http://demo-api:8090/page/bulletin.html，
// 本机裸跑 bff 调试时 http://localhost:8090/page/bulletin.html），真实 fetch + 解析 <table>。
function bulletinHtml() {
  const trs = eco
    .map(
      (r) =>
        `<tr><td>${r["指标"]}</td><td>${r["数值"]}</td><td>${r["说明"]}</td></tr>`,
    )
    .join("\n          ");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>黑龙江省经济社会发展公报摘要（演示页面）</title>
<style>
  body { font-family: "Songti SC", SimSun, serif; max-width: 860px; margin: 24px auto; padding: 0 16px; color: #1c2b22; }
  h1 { font-size: 22px; text-align: center; }
  .meta { text-align: center; color: #6b7a70; font-size: 13px; margin-bottom: 24px; }
  h2 { font-size: 17px; border-left: 4px solid #227f64; padding-left: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { border: 1px solid #cfdcd3; padding: 8px 10px; text-align: left; }
  th { background: #eef5ef; }
  p { line-height: 1.8; }
</style>
</head>
<body>
  <h1>黑龙江省经济社会发展公报摘要</h1>
  <p class="meta">演示用页面 · 数据来源：黑龙江省统计局、省生态环境厅新闻发布会、哈尔滨海关等公开权威发布</p>
  <p>2025 年，全省实现地区生产总值（GDP）16878.0 亿元，按不变价格计算比上年增长 4.2%。粮食生产实现"二十二连丰"，总产量 1640.06 亿斤，连续 16 年位居全国第一。2024 年货物贸易进出口总值首次突破 3000 亿元。主要指标摘录如下：</p>
  <h2>主要指标一览</h2>
  <table id="eco-indicators">
    <thead>
      <tr><th>指标</th><th>数值</th><th>说明</th></tr>
    </thead>
    <tbody>
      ${trs}
    </tbody>
  </table>
  <p style="margin-top:24px;color:#6b7a70;font-size:12px;">本页面为演示平台的内建网页，用于展示"URL / 网页"数据来源的真实抓取与表格解析能力；页面内数据均为真实公开数据。</p>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "X-Api-Key, Authorization, Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  // 静态演示网页不需要鉴权（它就是"互联网上的一个网页"）
  if (url.pathname === "/page/bulletin.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(bulletinHtml());
    return;
  }

  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify(
        {
          name: "黑龙江省演示数据 API",
          auth: { type: "X-Api-Key 请求头", 获取方式: "见 .env 的 DEMO_API_KEY（演示环境默认 hlj-demo-2026）" },
          endpoints: {
            "/api/trade": "黑龙江省货物贸易年度序列（2021-2024，哈尔滨海关），支持 page/pageSize 翻页，列表在 data 字段",
            "/api/oilfield": "大庆油田年度生产序列（2022-2024，新华网/国资委），支持 page/pageSize 翻页，列表在 data 字段",
            "/page/bulletin.html": "免鉴权的静态演示网页（生态环境公报摘要），供网页抓取演示",
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const key = req.headers["x-api-key"];
  if (key !== API_KEY) {
    res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "缺少或错误的 X-Api-Key 请求头" } }));
    return;
  }

  const datasets = { "/api/trade": trade, "/api/oilfield": oilfield };
  const list = datasets[url.pathname];
  if (!list) {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "接口不存在，GET / 查看接口列表" } }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(paginate(list, url)));
});

server.listen(PORT, () => {
  console.log(`[demo-api] listening on http://localhost:${PORT}  (X-Api-Key demo service)`);
});
