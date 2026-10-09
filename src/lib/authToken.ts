import crypto from "crypto";

/**
 * 平台内部令牌（cron 调度、服务端之间互调）。
 * 一律从环境变量 CRON_TOKEN 读取，源码中不保留任何默认值。
 * 未配置时所有校验都会失败（fail closed），避免"默认万能 token"被滥用。
 */
export function getInternalToken(): string | null {
  const t = (process.env.CRON_TOKEN || "").trim();
  return t.length > 0 ? t : null;
}

/** 常量时间比较，避免时序侧信道 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  try {
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * 校验请求是否携带合法的内部令牌。
 * 支持两种传法：`Authorization: Bearer <token>`（推荐）或 `?token=<token>`（兼容旧的调度配置）。
 */
export function isAuthorizedInternal(req: Request): boolean {
  const expected = getInternalToken();
  if (!expected) return false;

  const header = req.headers.get("authorization") || "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  let queryToken = "";
  try {
    queryToken = new URL(req.url).searchParams.get("token") || "";
  } catch {
    queryToken = "";
  }

  const got = bearer || queryToken;
  return got.length > 0 && safeEqual(got, expected);
}

/** 校验任意字符串类令牌（如 WEBHOOK_TOKEN），未配置则一律拒绝 */
export function matchesEnvToken(got: string | null | undefined, envName: string): boolean {
  const expected = (process.env[envName] || "").trim();
  if (!expected) return false;
  if (!got) return false;
  return safeEqual(got, expected);
}
