// 部署时直接把演示账号 + 演示数据一起打进去，不需要现场手动注册再等前端种子。
// 演示账号同时是平台唯一的管理员（管理员建号 + 「设置」里的用户管理都靠它）。
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
  if (email && password) {
    const existing = await db
      .selectFrom("users")
      .select(["id", "role"])
      .where("email", "=", email)
      .executeTakeFirst();
    if (!existing) {
      const id = randomUUID();
      await db
        .insertInto("users")
        .values({ id, email, password_hash: await hashPassword(password), display_name: displayName, role: "admin" })
        .execute();
      await db.insertInto("workspaces").values({ user_id: id, data: JSON.stringify(demoWorkspace) }).execute();
      console.log(`[seedDemo] 已创建演示账号 ${email}（管理员），工作区已预置演示数据`);
    } else if (existing.role !== "admin") {
      // 老环境里的演示账号是在 role 列存在之前建的，这里补一次幂等提升。
      // 与上面"已存在就不覆盖现场修改"并不冲突——这条 UPDATE 只写 role 一列、
      // 且先用 email 查出主键再按主键命中（不用 where email，避免大小写/空格差异多行命中），
      // 密码、昵称、created_at、工作区数据一律不碰。
      await db.updateTable("users").set({ role: "admin" }).where("id", "=", existing.id).execute();
      console.log(`[seedDemo] 演示账号 ${email} 已提升为管理员`);
    }
  }
  // 即使没配演示账号也要跑：注册已关闭，一个管理员都没有的库等于没人能建账号
  await ensureSomeoneIsAdmin();
}

/** 兜底：平台已关闭公开注册，若库里一个管理员都没有，整个系统就没人能建账号了（只能连库改数据）。
 *  把最早注册的账号提升为管理员并打一条醒目日志。幂等；一个账号都没有时什么都不做。
 *  正常路径不会走到这里（演示账号已配），出现这条 warning 说明 DEMO_ACCOUNT_EMAIL 漏配或改过名。 */
async function ensureSomeoneIsAdmin(): Promise<void> {
  const admin = await db.selectFrom("users").select("id").where("role", "=", "admin").executeTakeFirst();
  if (admin) return;
  const oldest = await db
    .selectFrom("users")
    .select(["id", "email"])
    .orderBy("created_at", "asc")
    .executeTakeFirst();
  if (!oldest) return;
  await db.updateTable("users").set({ role: "admin" }).where("id", "=", oldest.id).execute();
  console.warn(`[seedDemo] 当前没有任何管理员，已把最早注册的账号提升为管理员：${oldest.email}`);
}
