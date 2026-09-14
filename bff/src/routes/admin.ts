// P2：管理后台的用户管理。公开注册已关闭，建号只能走这里。
// 全部路由已在 index.ts 挂载处套了 requireAuth + requireAdmin（router 内可信任 req.userId / req.userRole）。
import { randomUUID } from "node:crypto";
import express from "express";
import { hashPassword } from "../auth.js";
import { config } from "../config.js";
import { db } from "../db.js";

const router = express.Router();

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { code: "BAD_REQUEST", status: 400 });
}
function forbidden(message: string, code = "FORBIDDEN"): never {
  throw Object.assign(new Error(message), { code, status: 403 });
}
function notFound(message: string): never {
  throw Object.assign(new Error(message), { code: "NOT_FOUND", status: 404 });
}

/** 演示账号是服务端硬拦对象：不可删除、不可被重置密码。
 *  未配置 DEMO_ACCOUNT_EMAIL 时恒为 false——但那时压根没有演示账号，不影响。
 *  前端也据此把按钮置灰，但那只是提示；真正的闸门在这里。 */
function isDemoEmail(email: string): boolean {
  return !!config.demoAccount.email && email === config.demoAccount.email;
}

async function loadUser(id: string) {
  const row = await db.selectFrom("users").select(["id", "email", "role"]).where("id", "=", id).executeTakeFirst();
  if (!row) notFound("账号不存在");
  return row;
}

// 用户列表：绝不 select password_hash（和 connectors 列表摘掉 secret 是同一个道理）
router.get("/users", async (_req, res, next) => {
  try {
    const rows = await db
      .selectFrom("users")
      .select(["id", "email", "display_name", "role", "created_at"])
      .orderBy("created_at", "asc")
      .execute();
    res.json(
      rows.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        role: u.role,
        createdAt: u.created_at,
        isDemo: isDemoEmail(u.email),
      })),
    );
  } catch (e) {
    next(e);
  }
});

// 建账号。新账号的工作区插 data: null——前端的空白 Store 会接手，不灌演示种子。
// 管理员建的账号一律是普通用户（要第二个管理员就直接改库里的 role）。
router.post("/users", async (req, res, next) => {
  try {
    const { email, password, displayName } = req.body as { email?: string; password?: string; displayName?: string };
    if (!email || !password || !displayName) badRequest("请填写邮箱、密码和昵称");
    if (password.length < 6) badRequest("密码至少 6 位");
    const existing = await db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirst();
    if (existing) throw Object.assign(new Error("该邮箱已注册"), { code: "EMAIL_TAKEN", status: 409 });
    const id = randomUUID();
    await db
      .insertInto("users")
      .values({ id, email, password_hash: await hashPassword(password), display_name: displayName, role: "user" })
      .execute();
    await db.insertInto("workspaces").values({ user_id: id, data: null }).execute();
    res.status(201).json({
      id,
      email,
      displayName,
      role: "user",
      createdAt: new Date().toISOString(),
      isDemo: isDemoEmail(email),
    });
  } catch (e) {
    next(e);
  }
});

// 重置密码：管理员直改，不需要旧密码
router.post("/users/:id/reset-password", async (req, res, next) => {
  try {
    const { password } = req.body as { password?: string };
    if (!password || password.length < 6) badRequest("密码至少 6 位");
    const target = await loadUser(req.params.id);
    if (isDemoEmail(target.email)) forbidden("演示账号不允许重置密码", "DEMO_PROTECTED");
    await db.updateTable("users").set({ password_hash: await hashPassword(password) }).where("id", "=", target.id).execute();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// 删除账号：该用户的 workspaces / connectors 靠 onDelete cascade 一起清掉（见 migrate.ts）
router.delete("/users/:id", async (req, res, next) => {
  try {
    const target = await loadUser(req.params.id);
    if (isDemoEmail(target.email)) forbidden("演示账号不允许删除", "DEMO_PROTECTED");
    // 删自己 = 把自己关在门外；演示账号是唯一管理员时更致命
    if (target.id === req.userId) badRequest("不能删除当前登录的账号");
    await db.deleteFrom("users").where("id", "=", target.id).execute();
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

export default router;
