// 部署时直接把演示账号 + 演示数据一起打进去，不需要现场手动注册再等前端种子——
// demo-workspace.json 是从 web/src/data/seed.ts 的 createSeed() 生成的静态快照
// （生成方式：在 web/ 目录跑一段 tsx 脚本 import createSeed 后 JSON.stringify 写出来），
// 跟前端首次登录时的种子数据完全一致，只是提前算好、直接落库，不用等浏览器里跑一遍。
import { randomUUID } from "node:crypto";
import demoWorkspace from "./seed/demo-workspace.json" with { type: "json" };
import { hashPassword } from "./auth.js";
import { config } from "./config.js";
import { db } from "./db.js";

export async function ensureDemoAccount(): Promise<void> {
  const { email, password, displayName } = config.demoAccount;
  if (!email || !password) return; // 未配置就不建，不强加一个演示账号

  const existing = await db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirst();
  if (existing) return; // 已经存在（哪怕是重新部署/容器重建）就不动，不覆盖现场可能已经做过的修改

  const id = randomUUID();
  await db.insertInto("users").values({ id, email, password_hash: await hashPassword(password), display_name: displayName }).execute();
  await db.insertInto("workspaces").values({ user_id: id, data: JSON.stringify(demoWorkspace) }).execute();
  console.log(`[seedDemo] 已创建演示账号 ${email}，工作区已预置演示数据`);
}
