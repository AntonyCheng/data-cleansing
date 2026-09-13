// 对外数据服务：把用户在「数据服务」页配置好的清洗成果，按接口标识（slug）真实对外提供。
// 不接 requireAuth——这条路由本来就是给外部系统调用的公开只读接口，
// 谁能看到哪些字段、哪份数据，由用户保存配置时勾选的内容决定，不是这里放行了不该放行的东西。
import express from "express";
import { db } from "../db.js";

const router = express.Router();

type ServiceRow = { id: string | null; values: Record<string, string | null> };
type ServiceRun = {
  id: string;
  rows: ServiceRow[];
  validation: { blocked: boolean };
};
type ServiceTask = {
  id: string;
  runs: ServiceRun[];
};
type ServiceConfig = {
  taskId: string;
  runId: string;
  slug: string;
  fields: string[];
  pageSize: number;
};
type WorkspaceData = {
  tasks?: ServiceTask[];
  services?: ServiceConfig[];
} | null;

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { code: "BAD_REQUEST", status: 400 });
}

router.get("/:slug", async (req, res, next) => {
  try {
    const { slug } = req.params;
    const page = Number(req.query.page ?? "1");
    if (!Number.isInteger(page) || page < 1) badRequest("页码必须是大于 0 的整数");

    // 服务配置随整坨工作区 JSON 存放（见 db.ts 的取舍说明），slug 又是跨用户全局的对外标识，
    // 只能扫全表找——demo 规模的账号数量下没有性能问题，真要多租户上量再拆专表建索引。
    const rows = await db.selectFrom("workspaces").select(["data"]).execute();
    let found: { task: ServiceTask; config: ServiceConfig } | undefined;
    for (const row of rows) {
      const data = row.data as WorkspaceData;
      const config = data?.services?.find((s) => s.slug === slug);
      const task = config && data?.tasks?.find((t) => t.id === config.taskId);
      if (config && task) {
        found = { task, config };
        break;
      }
    }
    if (!found) throw Object.assign(new Error("接口不存在"), { code: "NOT_FOUND", status: 404 });

    const { task, config } = found;
    const run = task.runs.find((r) => r.id === config.runId);
    if (!run || run.validation.blocked || !run.rows.length)
      throw Object.assign(new Error("服务对应的清洗结果不可用"), { code: "SERVICE_UNAVAILABLE", status: 409 });

    const data = run.rows
      .slice((page - 1) * config.pageSize, page * config.pageSize)
      .map((r) => Object.fromEntries(config.fields.map((key) => [key, r.values[key] ?? null])));

    res.json({ page, pageSize: config.pageSize, total: run.rows.length, data });
  } catch (e) {
    next(e);
  }
});

export default router;
