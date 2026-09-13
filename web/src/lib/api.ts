// P0 地基：登录鉴权 + 工作区持久化的 bff 客户端。
// token 存 localStorage.kdata.auth.token，与工作区数据（现在已经搬到服务端）分开存放。

const TOKEN_KEY = "kdata.auth.token";
const USER_KEY = "kdata.auth.user";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
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

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (body as { error?: { message?: string } }).error;
    throw new Error(err?.message ?? `请求失败 (${res.status})`);
  }
  return body as T;
}

export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function register(email: string, password: string, displayName: string): Promise<AuthUser> {
  const { token, user } = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, displayName }),
  }).then(jsonOrThrow<{ token: string; user: AuthUser }>);
  saveSession(token, user);
  return user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const { token, user } = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then(jsonOrThrow<{ token: string; user: AuthUser }>);
  saveSession(token, user);
  return user;
}

export function getWorkspace(): Promise<{ data: unknown }> {
  return fetch("/api/workspace", { headers: authHeaders() }).then(jsonOrThrow<{ data: unknown }>);
}

export async function putWorkspace(data: unknown): Promise<void> {
  const res = await fetch("/api/workspace", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`保存工作区失败 (${res.status})`);
}
