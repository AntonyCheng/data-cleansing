import type { DataServiceConfig, DataTask, Store } from "./types";
import { isCleanComplete, SERVICE_STATUS } from "./status";

export type ServiceStatus =
  (typeof SERVICE_STATUS)[keyof typeof SERVICE_STATUS]["text"];

export function serviceStatus(
  task: DataTask,
  config?: DataServiceConfig,
): ServiceStatus | null {
  const run = task.runs[0];
  if (!isCleanComplete(task)) return null;
  if (!config) return SERVICE_STATUS.unconfigured.text;
  if (
    config.runId !== run.id ||
    config.fields.some((key) => !task.fields.some((f) => f.key === key))
  )
    return SERVICE_STATUS.outdated.text;
  return SERVICE_STATUS.pending.text;
}

export function listServiceDatasets(store: Store) {
  return store.tasks
    .filter(isCleanComplete)
    .map((task) => {
      const config = store.services?.find(
        (service) => service.taskId === task.id,
      );
      return {
        task,
        run: task.runs[0],
        config,
        status: serviceStatus(task, config)!,
      };
    })
    .sort((a, b) => b.run.time.localeCompare(a.run.time));
}

export function saveDataService(store: Store, draft: DataServiceConfig): Store {
  const task = store.tasks.find((task) => task.id === draft.taskId);
  const run = task?.runs[0];
  if (!task || !run || !isCleanComplete(task))
    throw new Error("请先完成清洗并通过校验，再配置数据服务。");
  if (draft.runId !== run.id)
    throw new Error("清洗结果已更新，请重新打开配置并确认最新版本。");
  const name = draft.name.trim(),
    slug = draft.slug.trim();
  if (!name || name.length > 60)
    throw new Error("服务名称请填写 1–60 个字符。");
  if (!/^[a-z][a-z0-9-]{1,47}$/.test(slug))
    throw new Error("接口标识需为 2–48 位小写字母、数字或连字符，以字母开头。");
  if (
    store.services?.some(
      (service) => service.taskId !== task.id && service.slug === slug,
    )
  )
    throw new Error("接口标识已被使用，请更换一个。");
  const fields = [...new Set(draft.fields)];
  if (
    !fields.length ||
    fields.some((key) => !task.fields.some((field) => field.key === key))
  )
    throw new Error("请至少选择一个有效的输出字段。");
  if (![10, 20, 50, 100].includes(draft.pageSize))
    throw new Error("请选择有效的每页条数。");
  const config = {
    ...draft,
    name,
    slug,
    fields,
    description: draft.description.trim(),
    updatedAt: new Date().toISOString(),
  };
  return {
    ...store,
    services: [
      ...(store.services || []).filter((service) => service.taskId !== task.id),
      config,
    ],
  };
}

// Documentation examples use the configured clean run, never raw or exception data.
export function serviceResponse(
  task: DataTask,
  config: DataServiceConfig,
  page = 1,
) {
  const run = task.runs.find((run) => run.id === config.runId);
  if (
    task.id !== config.taskId ||
    !run ||
    run.validation.blocked ||
    !run.rows.length
  )
    throw new Error("配置关联的清洗结果不可用，请重新配置。");
  if (!Number.isInteger(page) || page < 1)
    throw new Error("页码必须是大于 0 的整数。");
  return {
    page,
    pageSize: config.pageSize,
    total: run.rows.length,
    data: run.rows
      .slice((page - 1) * config.pageSize, page * config.pageSize)
      .map((row) =>
        Object.fromEntries(
          config.fields.map((key) => [key, row.values[key] ?? null]),
        ),
      ),
  };
}

export function serviceDefinition(task: DataTask, config: DataServiceConfig) {
  return {
    name: config.name,
    description: config.description,
    status: "live",
    method: "GET",
    path: `/api/data-services/${config.slug}`,
    source: { taskId: task.id, runId: config.runId },
    fields: config.fields.map((key) => ({
      key,
      label: task.fields.find((field) => field.key === key)?.label || key,
    })),
    pagination: { parameter: "page", default: 1, pageSize: config.pageSize },
    exampleResponse: serviceResponse(task, config),
  };
}
