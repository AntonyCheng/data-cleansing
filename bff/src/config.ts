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
    jwtSecret: env("JWT_SECRET", "dev-secret-change-me"),
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
