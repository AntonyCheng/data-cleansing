import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { db, type UserRole } from "./db.js";

const TOKEN_TTL = "7d";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.auth.jwtSecret, { expiresIn: TOKEN_TTL });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, config.auth.jwtSecret) as { sub: string };
    return payload.sub;
  } catch {
    return null;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      // 由 requireAdmin 填入，仅供下游判断"是不是在操作自己"这类场景；
      // 不能拿它当权限依据——权限判断本身就是 requireAdmin 查库得出的
      userRole?: UserRole;
    }
  }
}

/** 从 Authorization: Bearer <token> 里取用户身份，校验不过直接 401 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const userId = token && verifyToken(token);
  if (!userId) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "请先登录" } });
    return;
  }
  req.userId = userId;
  next();
}

/** 管理员闸门，必须挂在 requireAuth 之后（依赖 req.userId）。
 *
 *  token 里只有 sub，所以角色必须回查 users 表：既不能信客户端传来的角色，
 *  也不把角色塞进 JWT——否则改一次角色要等旧 token 过期（7 天）才生效。
 *
 *  这里刻意用 .then/.catch(next) 而不是 async/await：Express 4 不捕获 async 中间件的
 *  rejection，而 index.ts 的 process.on("unhandledRejection") 只记日志不崩进程——
 *  一旦这里抛错，请求会静默挂死（客户端转圈到超时，错误中间件根本不会被调用）。
 *  以后新增 async 中间件都要注意这条。
 *
 *  非管理员一律 403 而不是 401：401 会被前端当成"登录态失效"直接把人登出。 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "请先登录" } });
    return;
  }
  db.selectFrom("users")
    .select("role")
    .where("id", "=", userId)
    .executeTakeFirst()
    .then((row) => {
      // 账号已被删除但 token 还没过期：给 401 让前端走自动登出（403 会让人卡在一个"没权限"的死页面）
      if (!row) {
        res.status(401).json({ error: { code: "UNAUTHORIZED", message: "账号不存在" } });
        return;
      }
      if (row.role !== "admin") {
        res.status(403).json({ error: { code: "FORBIDDEN", message: "需要管理员权限" } });
        return;
      }
      req.userRole = "admin";
      next();
    })
    .catch(next);
}
