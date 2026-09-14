// P0 地基：登录鉴权 + 工作区持久化的 bff 客户端。
// token 存 localStorage.kdata.auth.token，与工作区数据（现在已经搬到服务端）分开存放。

const TOKEN_KEY = "kdata.auth.token";
const USER_KEY = "kdata.auth.user";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  // 老版本 localStorage 里存的 user 没有这个字段，所以可选；缺省一律按普通用户处理
  // （fail-closed——最坏结果是管理员少看一个设置入口，而不是普通用户看到管理员入口）。
  // 启动时的 /api/auth/me 校验会把它刷新成服务端的真实角色。
  role?: "admin" | "user";
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function saveSession(token: string, user: AuthUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* 隐私模式等异常场景，登录状态就只在本次会话内存里有效 */
  }
}

/** 把服务端返回的最新用户写回本地缓存：角色变更（比如被提升为管理员）靠这个刷新 */
export function saveUser(user: AuthUser): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* 同上 */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

/** 登录态失效（HTTP 401）专用错误。继承 Error，所以既有那些
 *  `e instanceof Error ? e.message : ...` 的写法一个字都不用改；
 *  需要区分"身份失效"和"其他错误"的调用方用 instanceof 判断即可。
 *  注意：网络不通 / 5xx / 403 都不是它——那些绝不能触发登出。 */
export class UnauthorizedError extends Error {}

let onUnauthorized: (() => void) | null = null;
/** 由 App 在挂载时注册。任何一路请求（含 WebSocket）发现登录态失效都会调到这里。 */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}
/** 供非 fetch 的通道（WebSocket 的 UNAUTHORIZED 帧）复用同一条登出路径 */
export function notifyUnauthorized(): void {
  onUnauthorized?.();
}

/** 所有**带登录态**的请求都走这里。两个职责：
 *  1) 401 就通知全局登出——放在这一层而不是各调用方，是为了不漏：
 *     前端有多处请求压根不解析 body（比如 deleteConnector），只改 jsonOrThrow 会漏掉它们；
 *  2) 网络错误原样抛（这里不做 catch）——绝不能把一次断网吞成"登录态失效"把人踢回登录页。
 *
 *  ⚠️ login() 刻意**不**走这里：后端只有两处返回 401，一处是 requireAuth（真正的登录态失效），
 *  另一处就是登录密码错误（index.ts 的 INVALID_CREDENTIALS）。在这里统一处理会把"输错密码"
 *  误报成"登录状态已失效"。自动登出的语义只对"带 token 的请求"成立，登录本身不带 token。 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status === 401) notifyUnauthorized();
  return res;
}

export async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { message?: string } }).error;
    const message = err?.message ?? `请求失败 (${res.status})`;
    if (res.status === 401) throw new UnauthorizedError(message);
    throw new Error(message);
  }
  return body as T;
}

export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(email: string, password: string): Promise<AuthUser> {
  // 用原生 fetch：见上面 apiFetch 的说明（密码错的 401 不能触发自动登出）
  const { token, user } = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then(jsonOrThrow<{ token: string; user: AuthUser }>);
  saveSession(token, user);
  return user;
}

/** 启动校验：localStorage 里的 token 可能早就过期、或被换过 JWT_SECRET 作废，只能问服务端 */
export async function me(): Promise<AuthUser> {
  return jsonOrThrow<AuthUser>(await apiFetch("/api/auth/me", { headers: authHeaders() }));
}

export function getWorkspace(): Promise<{ data: unknown }> {
  return apiFetch("/api/workspace", { headers: authHeaders() }).then(jsonOrThrow<{ data: unknown }>);
}

export async function putWorkspace(data: unknown): Promise<void> {
  const res = await apiFetch("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`保存工作区失败 (${res.status})`);
}
