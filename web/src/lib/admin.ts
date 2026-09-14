// P2：管理后台（用户管理）的 bff 客户端。风格与 lib/connectors.ts 一致。
// 公开注册已关闭，建号只能走这里；全部接口在服务端都要求管理员身份（requireAdmin）。
import { apiFetch, authHeaders, jsonOrThrow } from "./api";

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "user";
  createdAt: string;
  /** 服务端硬拦对象（不可删除 / 不可重置密码），前端据此禁用按钮并标注 */
  isDemo: boolean;
}

function jsonHeaders(): HeadersInit {
  return { "Content-Type": "application/json", ...authHeaders() };
}

export function listUsers(): Promise<AdminUser[]> {
  return apiFetch("/api/admin/users", { headers: authHeaders() }).then(jsonOrThrow<AdminUser[]>);
}

export function createUser(email: string, password: string, displayName: string): Promise<AdminUser> {
  return apiFetch("/api/admin/users", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ email, password, displayName }),
  }).then(jsonOrThrow<AdminUser>);
}

export function resetPassword(id: string, password: string): Promise<void> {
  return apiFetch(`/api/admin/users/${id}/reset-password`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ password }),
  }).then(jsonOrThrow<void>);
}

export function deleteUser(id: string): Promise<void> {
  return apiFetch(`/api/admin/users/${id}`, { method: "DELETE", headers: authHeaders() }).then(jsonOrThrow<void>);
}
