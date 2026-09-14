import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import type { DataRow } from "../lib/types";
import {
  createConnector,
  deleteConnector,
  extractApiRows,
  extractSqlRows,
  listConnectors,
  listTables,
  testConnector,
  type ApiAuthType,
  type ApiConnectorConfig,
  type Connector,
  type ConnectorKind,
  type ExtractResult,
  type SqlConnectorConfig,
  type TestResult,
} from "../lib/connectors";
import { Badge, Notice } from "./UI";

type Kind = "数据库" | "API";
const KINDS_FOR: Record<Kind, ConnectorKind[]> = { 数据库: ["mysql", "postgres"], API: ["api"] };

export default function ConnectorSource({
  kind,
  onRows,
}: {
  kind: Kind;
  onRows: (rows: DataRow[], defaultName: string, sourceLabel: string, sourceType: string) => void;
}) {
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // 新建连接表单
  const [connName, setConnName] = useState("");
  const [dbKind, setDbKind] = useState<"mysql" | "postgres">("mysql");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(3306);
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [ssl, setSsl] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [authType, setAuthType] = useState<ApiAuthType>("none");
  const [apiKeyHeader, setApiKeyHeader] = useState("X-Api-Key");
  const [secret, setSecret] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);

  // 选定连接之后
  const [tables, setTables] = useState<string[] | null>(null);
  const [selectedTable, setSelectedTable] = useState("");
  const [apiPath, setApiPath] = useState("");
  const [apiMethod, setApiMethod] = useState<"GET" | "POST">("GET");
  const [advanced, setAdvanced] = useState(false);
  const [pageParam, setPageParam] = useState("page");
  const [pageSizeParam, setPageSizeParam] = useState("pageSize");
  const [pageSize, setPageSize] = useState(50);
  const [listPath, setListPath] = useState("");
  const [preview, setPreview] = useState<ExtractResult | null>(null);
  const [busy, setBusy] = useState(false);
  // 「使用演示数据源」预填标记：新建连接表单填好后，保存成功时再自动填提取参数（路径/翻页）
  const [demoPrefill, setDemoPrefill] = useState(false);

  const kinds = KINDS_FOR[kind];

  useEffect(() => {
    listConnectors()
      .then((cs) => setConnectors(cs.filter((c) => kinds.includes(c.kind))))
      .catch(() => setConnectors([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const selected = connectors?.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    setTables(null);
    setSelectedTable("");
    setPreview(null);
    if (selected && kind === "数据库") {
      listTables(selected.id)
        .then(setTables)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : "拉取表列表失败"));
    }
    if (selected && demoPrefill) {
      // 演示数据源：连接保存成功后自动填好提取参数，用户直接点「预览」即可
      setApiPath("/api/trade");
      setApiMethod("GET");
      setPageParam("page");
      setPageSizeParam("pageSize");
      setPageSize(2);
      setListPath("data");
      setAdvanced(true);
      setDemoPrefill(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function currentConfig(): SqlConnectorConfig | ApiConnectorConfig {
    return kind === "数据库" ? { host, port, database, username, ssl } : { baseUrl, authType, apiKeyHeader };
  }

  async function doTest() {
    setError("");
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await testConnector(kind === "数据库" ? dbKind : "api", currentConfig(), secret));
    } catch (e) {
      setError(e instanceof Error ? e.message : "测试失败");
    } finally {
      setTesting(false);
    }
  }

  async function doSave() {
    setError("");
    setSaving(true);
    try {
      const label = connName.trim() || (kind === "数据库" ? `${host}/${database}` : baseUrl);
      const c = await createConnector(kind === "数据库" ? dbKind : "api", label, currentConfig(), secret);
      setConnectors((cs) => [c, ...(cs ?? [])]);
      setSelectedId(c.id);
      setCreating(false);
      setTestResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function doRemove(id: string) {
    try {
      await deleteConnector(id);
      setConnectors((cs) => (cs ?? []).filter((c) => c.id !== id));
      if (selectedId === id) setSelectedId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  function pagination() {
    return advanced ? { pageParam, pageSizeParam, pageSize, listPath: listPath || undefined } : undefined;
  }

  async function extract(limit: number): Promise<ExtractResult | null> {
    if (!selected) return null;
    if (kind === "数据库") {
      if (!selectedTable) {
        setError("请先选择表");
        return null;
      }
      return extractSqlRows(selected.id, selectedTable, limit);
    }
    if (!apiPath.trim()) {
      setError("请填写请求路径");
      return null;
    }
    return extractApiRows(selected.id, apiPath.trim(), apiMethod, pagination(), limit);
  }

  async function doPreview() {
    setError("");
    setBusy(true);
    try {
      setPreview(await extract(20));
    } catch (e) {
      setError(e instanceof Error ? e.message : "预览失败");
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!selected) return;
    setError("");
    setBusy(true);
    try {
      const result = await extract(10000);
      if (!result) return;
      const rows: DataRow[] = result.rows.map((values, i) => ({ id: `import-${i}`, values }));
      const sourceLabel = kind === "数据库" ? `${selected.name} · ${selectedTable}` : `${selected.name} · ${apiPath}`;
      const sourceType = kind === "数据库" ? (selected.kind === "mysql" ? "MySQL" : "PostgreSQL") : "API";
      const defaultName = kind === "数据库" ? `${selectedTable}整理` : `${apiPath.replace(/^\//, "") || "接口数据"}整理`;
      onRows(rows, defaultName, sourceLabel, sourceType);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connector-source">
      {connectors && connectors.length > 0 && !creating && (
        <label className="field">
          选择已保存的连接
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            <option value="">请选择…</option>
            {connectors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && !creating && (
        <button className="text-button connector-remove" onClick={() => doRemove(selected.id)}>
          <Trash2 size={13} />
          删除这个连接
        </button>
      )}

      {!creating ? (
        <>
          <button className="sample-link" onClick={() => setCreating(true)}>
            <Plus size={14} />
            新建连接
            <ArrowRight size={14} />
          </button>
          {kind === "API" && (
            <button
              className="sample-link"
              onClick={() => {
                // 一键预填内置演示 API（docker compose 部署时的容器网内地址），
                // 保存连接后提取参数也会自动填好
                setBaseUrl("http://demo-api:8090");
                setAuthType("api-key");
                setApiKeyHeader("X-Api-Key");
                setSecret("hlj-demo-2026");
                setConnName("黑龙江省演示数据API");
                setDemoPrefill(true);
                setCreating(true);
              }}
            >
              使用演示数据源（黑龙江省API）
              <ArrowRight size={14} />
            </button>
          )}
        </>
      ) : (
        <div className="connector-form">
          {kind === "数据库" ? (
            <>
              <div className="form-columns">
                <label className="field">
                  数据库类型
                  <select
                    value={dbKind}
                    onChange={(e) => {
                      const v = e.target.value as "mysql" | "postgres";
                      setDbKind(v);
                      setPort(v === "mysql" ? 3306 : 5432);
                    }}
                  >
                    <option value="mysql">MySQL</option>
                    <option value="postgres">PostgreSQL</option>
                  </select>
                </label>
                <label className="field">
                  端口
                  <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
                </label>
              </div>
              <label className="field">
                主机地址
                <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />
              </label>
              <div className="form-columns">
                <label className="field">
                  数据库名
                  <input value={database} onChange={(e) => setDatabase(e.target.value)} />
                </label>
                <label className="field">
                  用户名
                  <input value={username} onChange={(e) => setUsername(e.target.value)} />
                </label>
              </div>
              <label className="field">
                密码
                <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
              </label>
              <label className="field-inline">
                <input type="checkbox" checked={ssl} onChange={(e) => setSsl(e.target.checked)} />
                使用 SSL 连接
              </label>
              <Notice>建议使用只读账号：这里只会执行 SELECT 查询，但权限最小化更安全。</Notice>
            </>
          ) : (
            <>
              <label className="field">
                接口根地址
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" />
              </label>
              <label className="field">
                鉴权方式
                <select value={authType} onChange={(e) => setAuthType(e.target.value as ApiAuthType)}>
                  <option value="none">无需鉴权</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="api-key">API Key（自定义请求头）</option>
                  <option value="basic">Basic（用户名:密码）</option>
                </select>
              </label>
              {authType === "api-key" && (
                <label className="field">
                  请求头名称
                  <input value={apiKeyHeader} onChange={(e) => setApiKeyHeader(e.target.value)} placeholder="X-Api-Key" />
                </label>
              )}
              {authType !== "none" && (
                <label className="field">
                  {authType === "basic" ? "用户名:密码" : "凭证"}
                  <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} />
                </label>
              )}
            </>
          )}
          <label className="field">
            连接名称
            <input value={connName} onChange={(e) => setConnName(e.target.value)} placeholder="给这个连接起个名字，方便下次复用" />
          </label>
          {testResult && (
            <Notice warning={!testResult.ok}>{testResult.message ?? (testResult.ok ? "连接成功" : "连接失败")}</Notice>
          )}
          <div className="form-footer">
            <button className="button" onClick={() => setCreating(false)}>
              取消
            </button>
            <button className="button" disabled={testing} onClick={doTest}>
              {testing ? "测试中…" : "测试连接"}
            </button>
            <button className="button primary" disabled={saving || !testResult?.ok} onClick={doSave}>
              {saving ? "保存中…" : "保存并继续"}
            </button>
          </div>
        </div>
      )}

      {selected && !creating && (
        <div className="connector-extract">
          {kind === "数据库" ? (
            tables === null ? (
              <Notice>正在读取表列表…</Notice>
            ) : (
              <label className="field">
                选择表
                <select value={selectedTable} onChange={(e) => setSelectedTable(e.target.value)}>
                  <option value="">请选择…</option>
                  {tables.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            )
          ) : (
            <>
              <div className="form-columns">
                <label className="field">
                  请求方法
                  <select value={apiMethod} onChange={(e) => setApiMethod(e.target.value as "GET" | "POST")}>
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </label>
                <label className="field">
                  请求路径
                  <input value={apiPath} onChange={(e) => setApiPath(e.target.value)} placeholder="/v1/customers" />
                </label>
              </div>
              <button className="text-button connector-advanced-toggle" onClick={() => setAdvanced((v) => !v)}>
                <ChevronDown size={13} style={{ transform: advanced ? "rotate(180deg)" : undefined }} />
                翻页设置（不需要可跳过）
              </button>
              {advanced && (
                <div className="form-columns">
                  <label className="field">
                    页码参数名
                    <input value={pageParam} onChange={(e) => setPageParam(e.target.value)} />
                  </label>
                  <label className="field">
                    每页条数参数名
                    <input value={pageSizeParam} onChange={(e) => setPageSizeParam(e.target.value)} />
                  </label>
                  <label className="field">
                    每页条数
                    <input type="number" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} />
                  </label>
                  <label className="field">
                    列表字段路径（响应体不是数组时）
                    <input value={listPath} onChange={(e) => setListPath(e.target.value)} placeholder="data.items" />
                  </label>
                </div>
              )}
            </>
          )}
          <div className="form-footer">
            <button className="button" disabled={busy} onClick={doPreview}>
              {busy ? "请求中…" : "预览 20 行"}
            </button>
            <button className="button primary" disabled={busy || !preview} onClick={doImport}>
              <Check size={15} />
              确认导入
            </button>
          </div>
          {preview && (
            <div className="connector-preview">
              <Badge tone="green">
                预览 {preview.rows.length} 行 · {preview.columns.length} 个字段
              </Badge>
              <div className="connector-preview-table">
                <table>
                  <thead>
                    <tr>
                      {preview.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {preview.columns.map((c) => (
                          <td key={c}>{r[c]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
