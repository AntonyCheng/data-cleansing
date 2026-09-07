import { randomUUID } from "node:crypto";
import { TosClient } from "@volcengine/tos-sdk";
import { config } from "../config.js";

let client: TosClient | null = null;
function tos(): TosClient {
  if (!client) {
    client = new TosClient({
      accessKeyId: config.tos.accessKey,
      accessKeySecret: config.tos.secretKey,
      region: config.tos.region,
      endpoint: config.tos.endpoint,
    });
  }
  return client;
}

/** 上传到 TOS，返回一个有效期 1 小时的预签名 GET URL（供识别 API 拉取） */
export async function putAndSign(
  buffer: Buffer,
  ext: string,
  contentType: string,
): Promise<{ key: string; url: string }> {
  const key = `ingest/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;
  await tos().putObject({
    bucket: config.tos.bucket,
    key,
    body: buffer,
    contentType,
  });
  const url = tos().getPreSignedUrl({
    method: "GET",
    bucket: config.tos.bucket,
    key,
    expires: 3600,
  });
  return { key, url };
}
