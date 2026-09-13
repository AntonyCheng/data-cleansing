// 连接器凭证（数据库密码 / API Token）加密存储：AES-256-GCM，密钥来自 CONNECTOR_ENCRYPTION_KEY。
// 密文格式：base64(iv[12] + authTag[16] + ciphertext)，单字段自包含，不需要额外一列存 iv。
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "./config.js";

function key(): Buffer {
  const hex = config.connectors.encryptionKey;
  if (!hex || hex.length !== 64) {
    throw Object.assign(
      new Error("未配置 CONNECTOR_ENCRYPTION_KEY（需 32 字节 / 64 位十六进制），无法保存连接凭证"),
      { code: "MISSING_ENCRYPTION_KEY", status: 500 },
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
