import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";

// bff 的工作目录是 bff/，但 .env 在仓库根目录
const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(here, "../../.env") });

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const config = {
  port: Number(env("BFF_PORT", "8787")),
  webOrigin: env("WEB_ORIGIN", "http://localhost:5173"),
  /** mock = 返回内置样例；live = 调用真实火山 API */
  mode: (env("CLEANSING_MODE", "mock") === "live" ? "live" : "mock") as "mock" | "live",

  tos: {
    region: env("VOLC_TOS_REGION", "cn-beijing"),
    endpoint: env("VOLC_TOS_ENDPOINT"),
    bucket: env("VOLC_TOS_BUCKET"),
    accessKey: env("VOLC_TOS_ACCESS_KEY"),
    secretKey: env("VOLC_TOS_SECRET_KEY"),
  },
  ocr: {
    accessKey: env("VOLC_ACCESS_KEY"),
    secretKey: env("VOLC_SECRET_KEY"),
    region: env("VOLC_OCR_REGION", "cn-north-1"),
    host: "visual.volcengineapi.com",
  },
  speech: {
    appId: env("VOLC_SPEECH_APP_ID"),
    apiKey: env("VOLC_SPEECH_API_KEY") || env("VOLC_SPEECH_ACCESS_TOKEN"),
    resourceIdAuc: env("VOLC_SPEECH_RESOURCE_ID_AUC", "volc.seedasr.auc"),
    resourceIdStream: env("VOLC_SPEECH_RESOURCE_ID_STREAM", "volc.bigasr.sauc.duration"),
    host: "openspeech.bytedance.com",
  },
  ark: {
    apiKey: env("ARK_API_KEY"),
    baseUrl: env("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3"),
    modelText: env("ARK_MODEL_TEXT", "doubao-seed-2-1-turbo"),
    modelVision: env("ARK_MODEL_VISION", "doubao-seed-2-1-turbo"), // 视频抽帧描述（重速度/成本）
    modelImage: env("ARK_MODEL_IMAGE", "doubao-seed-1-6-vision"), // 图片结构化（需字段 grounding）
  },
  db: {
    url: env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/data_cleansing"),
  },
  auth: {
    // 刻意没有兜底值：兜底值一旦公开（.env.example / git 历史里就有过），
    // 任何人都能自己签一个 token 冒充任意用户。缺失时由 assertAuthConfig() 在启动瞬间拦下。
    jwtSecret: env("JWT_SECRET"),
  },
  connectors: {
    // 32 字节十六进制（openssl rand -hex 32），用于加密数据库连接器的密码 / API Token
    encryptionKey: env("CONNECTOR_ENCRYPTION_KEY"),
  },
  // 部署时自动创建的演示账号（见 seedDemo.ts）；留空则不创建
  demoAccount: {
    email: env("DEMO_ACCOUNT_EMAIL"),
    password: env("DEMO_ACCOUNT_PASSWORD"),
    displayName: env("DEMO_ACCOUNT_NAME", "演示账号"),
  },
} as const;

export function assertLiveConfig(): string[] {
  const missing: string[] = [];
  if (!config.tos.bucket) missing.push("VOLC_TOS_BUCKET");
  if (!config.ocr.accessKey) missing.push("VOLC_ACCESS_KEY");
  if (!config.speech.apiKey) missing.push("VOLC_SPEECH_API_KEY");
  if (!config.ark.apiKey) missing.push("ARK_API_KEY");
  return missing;
}

// 曾经作为兜底值写在仓库里的字符串：留着它等于没改，一律拒绝
const PUBLIC_DEV_SECRET = "dev-secret-change-me";

/** 鉴权配置校验——全仓库唯一一处「启动即 throw」。
 *
 *  为什么 JWT_SECRET 不能像 VOLC_* 那样只警告：火山密钥缺失只会让相关功能降级
 *  （live 模式提示、mock 模式照跑），而 JWT_SECRET 缺失意味着登录态不可信——
 *  要么用一个所有人都知道的值签 token（可被伪造），要么每次重启随机抖动（全体被登出）。
 *  两种都不该被静默接受，所以宁可让进程起不来：Docker 的 restart 策略会让它反复重启，
 *  日志里一眼能看到原因，好过一个"能起来但登录态是假的"的半残进程。
 *
 *  调用点是 index.ts 的进程入口，不是本文件模块顶层——因为 migrate.ts → db.ts → config.ts
 *  这条链会让 `npm run migrate` 在 import 阶段就炸，而迁移不该需要签名密钥。 */
export function assertAuthConfig(): void {
  const secret = config.auth.jwtSecret;
  if (!secret) {
    throw new Error(
      "[config] 缺少 JWT_SECRET：登录态签名密钥必须显式配置（仓库根目录 .env），已不再提供默认值。\n" +
        '  生成一个：node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (secret === PUBLIC_DEV_SECRET) {
    throw new Error(
      "[config] JWT_SECRET 仍是仓库里公开过的示例值，任何人都能伪造登录态，请换成随机长字符串后重启。",
    );
  }
}
