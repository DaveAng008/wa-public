import crypto from "crypto";

/**
 * 媒体中转签名。
 *
 * `/api/media-proxy/[id]` 有两个使用方：
 *   1. 浏览器（已登录会话）—— 走 session 鉴权，并校验素材归属；
 *   2. Evolution API 服务端发媒体时来取文件 —— 它没有浏览器会话，
 *      因此用「素材 ID 的 HMAC 签名」作为短期可用的凭证。
 *
 * 签名密钥优先用 ENCRYPTION_KEY，其次退回 AUTH_SECRET / CRON_TOKEN。
 * 三者都未配置时返回空串，此时只有登录会话可以访问（服务端取媒体会失败），
 * 这是 fail-closed 的安全默认值。
 */
function getSignKey(): string {
  return (process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET || process.env.CRON_TOKEN || "").trim();
}

export function signMediaId(id: string): string {
  const key = getSignKey();
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(id).digest("hex").slice(0, 32);
}

/** 供服务端拼媒体 URL 时使用：带上签名，Evolution 才能取到文件 */
export function mediaProxyUrl(baseUrl: string, materialId: string, ext = ""): string {
  const base = (baseUrl || "").replace(/\/+$/, "");
  const sig = signMediaId(materialId);
  const query = sig ? `?sig=${sig}` : "";
  return `${base}/api/media-proxy/${materialId}/media${ext}${query}`;
}
