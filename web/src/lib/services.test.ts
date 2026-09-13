import { describe, expect, it } from "vitest";
import { taskStatus, importStatus } from "./status";
import { createSeed } from "../data/seed";
import type { DataServiceConfig } from "./types";
import {
  listServiceDatasets,
  saveDataService,
  serviceDefinition,
  serviceResponse,
  serviceStatus,
} from "./services";

function fixture() {
  const store = createSeed();
  const task = store.tasks.find((task) => task.runs.length > 0)!;
  const draft: DataServiceConfig = {
    taskId: task.id,
    runId: task.runs[0].id,
    name: "订单服务",
    slug: "order-data",
    description: "清洗后订单",
    fields: [task.fields[0].key],
    pageSize: 10,
    updatedAt: "",
  };
  return { store, task, draft };
}

describe("清洗成果与数据服务", () => {
  it("兼容没有服务配置的旧工作区，只列出已清洗任务的最新结果", () => {
    const { store, task } = fixture();
    delete store.services;
    task.runs.unshift({
      ...structuredClone(task.runs[0]),
      id: "new-run",
      time: "2099-01-01T00:00:00Z",
    });
    const datasets = listServiceDatasets(store);
    expect(datasets).toHaveLength(
      store.tasks.filter((task) => task.runs.length).length,
    );
    expect(datasets[0].run.id).toBe("new-run");
    expect(datasets.every((dataset) => dataset.status === "待配置")).toBe(true);
  });

  it("只展示最新版本清洗完成的数据，异常或空结果不能回退展示旧版本", () => {
    const { store, task, draft } = fixture();
    const saved = saveDataService(store, draft);
    const cleanRun = structuredClone(task.runs[0]);
    task.storedRunId = cleanRun.id;
    expect(taskStatus(task).text).toBe("清洗完成");
    expect(importStatus(task)?.text).toBe("已入库");
    expect(
      listServiceDatasets(saved).some((dataset) => dataset.task.id === task.id),
    ).toBe(true);

    task.runs.unshift({
      ...structuredClone(cleanRun),
      id: "failed-latest",
      validation: { blocked: true, messages: ["业务校验异常"], metrics: [] },
    });
    expect(taskStatus(task).text).toBe("校验异常");
    expect(importStatus(task)).toBeNull();
    expect(
      listServiceDatasets(saved).some((dataset) => dataset.task.id === task.id),
    ).toBe(false);
    task.runs[0].validation.blocked = false;
    task.runs[0].rows = [];
    expect(taskStatus(task).text).toBe("校验异常");
    expect(
      listServiceDatasets(saved).some((dataset) => dataset.task.id === task.id),
    ).toBe(false);

    task.runs.unshift({ ...cleanRun, id: "recovered-latest" });
    const restored = listServiceDatasets(saved).find(
      (dataset) => dataset.task.id === task.id,
    )!;
    expect(restored.run.id).toBe("recovered-latest");
    expect(restored.status).toBe("待更新");
    expect(taskStatus(task).text).toBe("清洗完成");
    expect(importStatus(task)?.text).toBe("待入库");
  });

  it("未清洗任务只显示待清洗，服务与入库状态不提前出现", () => {
    const { store } = fixture();
    const raw = store.tasks.find((task) => !task.runs.length)!;
    expect(taskStatus(raw).text).toBe("待清洗");
    expect(importStatus(raw)).toBeNull();
    expect(serviceStatus(raw)).toBeNull();
    expect(
      listServiceDatasets(store).some((dataset) => dataset.task.id === raw.id),
    ).toBe(false);
  });

  it("保存配置不改变原始数据、任务和本地入库结果，再编辑只更新同一服务", () => {
    const { store, task, draft } = fixture();
    const before = JSON.stringify(store);
    const saved = saveDataService(store, draft);
    expect(JSON.stringify(store)).toBe(before);
    expect(saved.tasks).toBe(store.tasks);
    expect(saved.warehouses).toBe(store.warehouses);
    expect(serviceStatus(task, saved.services![0])).toBe("待部署");
    const edited = saveDataService(saved, { ...draft, name: "新的服务名称" });
    expect(edited.services).toHaveLength(1);
    expect(edited.services![0].name).toBe("新的服务名称");
  });

  it("未清洗、空结果和校验异常不可配置服务", () => {
    const { store, task, draft } = fixture();
    const raw = store.tasks.find((task) => !task.runs.length)!;
    expect(() => saveDataService(store, { ...draft, taskId: raw.id })).toThrow(
      "完成清洗",
    );
    task.runs[0].validation.blocked = true;
    expect(serviceStatus(task)).toBeNull();
    expect(() => saveDataService(store, draft)).toThrow("通过校验");
    task.runs[0].validation.blocked = false;
    task.runs[0].rows = [];
    expect(serviceStatus(task)).toBeNull();
    expect(() => saveDataService(store, draft)).toThrow();
  });

  it("校验名称、唯一接口标识、输出字段和分页大小", () => {
    const { store, draft } = fixture();
    for (const invalid of [
      { name: " " },
      { slug: "../data" },
      { slug: "A" },
      { fields: [] },
      { fields: ["unknown"] },
      { pageSize: 0 },
    ]) {
      expect(() => saveDataService(store, { ...draft, ...invalid })).toThrow();
    }
    const saved = saveDataService(store, draft);
    const another = store.tasks.find(
      (task) => task.runs.length && task.id !== draft.taskId,
    )!;
    expect(() =>
      saveDataService(saved, {
        ...draft,
        taskId: another.id,
        runId: another.runs[0].id,
      }),
    ).toThrow("已被使用");
  });

  it("重新清洗后标记待更新，保存时必须显式确认最新版本", () => {
    const { store, task, draft } = fixture();
    const saved = saveDataService(store, draft);
    task.runs.unshift({ ...structuredClone(task.runs[0]), id: "new-run" });
    expect(serviceStatus(task, draft)).toBe("待更新");
    expect(() => saveDataService(saved, draft)).toThrow("已更新");
    const updated = saveDataService(saved, { ...draft, runId: "new-run" });
    expect(serviceStatus(task, updated.services![0])).toBe("待部署");
  });

  it("响应示例按配置字段和版本分页，不混入原始、删除或异常数据", () => {
    const { task, draft } = fixture();
    const expected = task.runs[0].rows.slice(10, 20).map((row) => ({
      [draft.fields[0]]: row.values[draft.fields[0]] ?? null,
    }));
    task.raw.push({ id: "raw-only", values: { [draft.fields[0]]: "RAW" } });
    task.runs[0].exceptions.push({
      row: { id: "exception", values: { [draft.fields[0]]: "EXCEPTION" } },
      reasons: ["异常"],
    });
    task.runs.unshift({
      ...structuredClone(task.runs[0]),
      id: "latest",
      rows: [],
    });
    const response = serviceResponse(task, draft, 2);
    expect(response.data).toEqual(expected);
    expect(response.total).toBe(task.runs[1].rows.length);
    expect(serviceResponse(task, draft, 999).data).toEqual([]);
    expect(() => serviceResponse(task, draft, 0)).toThrow();
    const definition = serviceDefinition(task, draft);
    expect(definition.status).toBe("pending_deployment");
    expect(definition.path).toBe("/api/data-services/order-data");
    expect(definition.source.runId).toBe(draft.runId);
    expect(() =>
      serviceResponse(task, { ...draft, runId: "missing" }),
    ).toThrow();
  });
});
