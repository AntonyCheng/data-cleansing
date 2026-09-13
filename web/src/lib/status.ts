import type { DataTask, Run } from "./types";

export const PROCESSING_STATUS = {
  pending: {
    text: "待清洗",
    tone: "amber",
    description: "数据已解析，尚未执行清洗。",
  },
  complete: {
    text: "清洗完成",
    tone: "green",
    description:
      "最新清洗结果非空且校验通过，可预览、导出、入库和配置数据服务。",
  },
  invalid: {
    text: "校验异常",
    tone: "red",
    description:
      "最新清洗结果未通过校验或无可用数据，需在任务工作台处理，不展示在数据服务中。",
  },
} as const;

export const IMPORT_STATUS = {
  pending: {
    text: "待入库",
    tone: "blue",
    description: "最新数据已清洗完成，尚未确认写入目标表；仍可进入数据服务。",
  },
  stored: {
    text: "已入库",
    tone: "green",
    description: "最新清洗版本已确认写入目标表；再次清洗后需重新确认入库。",
  },
} as const;

export const SERVICE_STATUS = {
  unconfigured: {
    text: "待配置",
    tone: "neutral",
    description: "数据已清洗完成，尚未保存接口标识、输出字段等服务配置。",
  },
  pending: {
    text: "已生效",
    tone: "green",
    description:
      "服务配置已保存且对应最新清洗版本，接口地址已可直接对外调用。",
  },
  outdated: {
    text: "待更新",
    tone: "amber",
    description:
      "清洗版本或字段已变化；接口仍按原地址提供旧版本数据，更新配置后生效使用最新数据。",
  },
} as const;

export function runStatus(run?: Run) {
  if (!run) return PROCESSING_STATUS.pending;
  return run.validation.blocked || !run.rows.length
    ? PROCESSING_STATUS.invalid
    : PROCESSING_STATUS.complete;
}

export function taskStatus(task: DataTask) {
  return runStatus(task.runs[0]);
}

export function isCleanComplete(task: DataTask) {
  return taskStatus(task) === PROCESSING_STATUS.complete;
}

export function importStatus(task: DataTask) {
  if (!isCleanComplete(task)) return null;
  return task.storedRunId === task.runs[0].id
    ? IMPORT_STATUS.stored
    : IMPORT_STATUS.pending;
}

export const STATUS_GUIDE = [
  {
    title: "数据处理状态",
    description: "数据任务、工作台、清洗报告和数据服务使用同一套处理状态。",
    items: Object.values(PROCESSING_STATUS),
  },
  {
    title: "入库状态",
    description:
      "仅在清洗完成后显示。它描述最新版本是否写入目标表，不改变数据处理状态。",
    items: Object.values(IMPORT_STATUS),
  },
  {
    title: "服务配置状态",
    description:
      "数据服务只展示清洗完成的数据。以下状态描述接口配置进度，不是清洗进度。",
    items: Object.values(SERVICE_STATUS),
  },
];
