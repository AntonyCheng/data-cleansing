// 「URL / 网页」数据来源：服务端真实抓取网页并解析静态表格。
// 浏览器直接 fetch 外部页面会被 CORS 拦住，所以抓取放在 bff 做；
// 只支持静态 HTML 表格（不做无头浏览器），够覆盖政府统计公报类页面和演示页。
import { createHash } from "node:crypto";
import express from "express";
import * as cheerio from "cheerio";

const router = express.Router();

const MAX_BYTES = 2 * 1024 * 1024; // 页面大小上限
const TIMEOUT_MS = 12_000;

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { code: "BAD_REQUEST", status: 400 });
}

router.post("/parse", async (req, res, next) => {
  try {
    const { url } = req.body as { url?: unknown };
    if (typeof url !== "string" || !url.trim()) badRequest("请填写网页地址");
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      badRequest("请填写有效的 HTTP / HTTPS 地址");
    }
    if (!["http:", "https:"].includes(target.protocol)) badRequest("仅支持 HTTP / HTTPS 地址");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let html: string;
    try {
      const resp = await fetch(target, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; KDataStudio/1.0; data-cleansing-demo)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!resp.ok) throw Object.assign(new Error(`网页返回 ${resp.status}`), { code: "FETCH_FAILED", status: 502 });
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) badRequest("页面超过 2MB，暂不支持抓取");
      html = buf.toString("utf8");
    } catch (e) {
      if ((e as Error).name === "AbortError")
        throw Object.assign(new Error("抓取超时（12 秒），请确认地址可访问"), { code: "TIMEOUT", status: 504 });
      if ((e as { code?: string }).code === "FETCH_FAILED") throw e;
      throw Object.assign(new Error(`抓取失败：${(e as Error).message}`), { code: "FETCH_FAILED", status: 502 });
    } finally {
      clearTimeout(timer);
    }

    const $ = cheerio.load(html);
    const title = $("title").text().trim() || target.hostname;
    const tables: { rows: string[][] }[] = [];
    $("table").each((_, el) => {
      const rows: string[][] = [];
      $(el)
        .find("tr")
        .each((__, tr) => {
          const cells: string[] = [];
          $(tr)
            .find("th, td")
            .each((___, cell) => {
              // colspan/rowspan 的合并单元格直接按原文本放到起始位置，不做网格展开——
              // 公报类页面很少跨行跨列，遇到时宁可少列也不生成错位的假数据
              cells.push(
                $(cell)
                  .text()
                  .replace(/\s+/g, " ")
                  .trim(),
              );
            });
          if (cells.some((c) => c)) rows.push(cells);
        });
      // 至少 2 行 2 列才算数据表（布局用的单行小表格跳过）
      if (rows.length >= 2 && rows[0].length >= 2) tables.push({ rows });
    });

    if (!tables.length)
      throw Object.assign(
        new Error("页面里没有找到数据表格（仅支持静态 HTML 表格，不含需要执行脚本渲染的内容）"),
        { code: "NO_TABLE", status: 422 },
      );

    res.json({
      title,
      url: target.toString(),
      fetchedAt: new Date().toISOString(),
      contentHash: createHash("sha256").update(html).digest("hex").slice(0, 16),
      tables,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
