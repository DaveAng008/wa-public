import type { Connection } from "mysql2/promise";

export interface EvolutionConfig {
  url: string;
  apikey: string;
}

function normalize(url: string, apikey: string): EvolutionConfig | null {
  const u = (url || "").trim().replace(/\/+$/, "");
  const k = (apikey || "").trim();
  if (!u || !k) return null;
  return { url: u, apikey: k };
}

/**
 * 解析 Evolution API 连接配置。优先级从高到低：
 *
 *   1. 环境变量 EVOLUTION_API_URL + EVOLUTION_API_KEY
 *      —— 容器部署（docker-compose 内网）走这一条，真正做到零配置：
 *         地址是 http://evolution:8080，全局 Key 由部署环境生成。
 *   2. 当前用户自己 AppSettings 里的配置（兼容旧的独立部署）
 *   3. 任意「确实配置过」的管理员账号（兼容旧部署；按 updatedAt 取最新，不再随机挑一个）
 *   4. 全局默认行 AppSettings.id = 'default'（最后的兼容兜底）
 *
 * 未配置齐全时返回 null，调用方应返回明确的错误提示，而不是静默降级到某个弱默认值。
 */
export async function getEvolutionConfig(conn: Connection, userId: string): Promise<EvolutionConfig | null> {
  // 1) 环境变量优先
  const fromEnv = normalize(process.env.EVOLUTION_API_URL || "", process.env.EVOLUTION_API_KEY || "");
  if (fromEnv) return fromEnv;

  // 2) 用户自己的配置
  try {
    const [rows]: any = await conn.execute(
      "SELECT evolutionApiUrl, evolutionApiKey FROM AppSettings WHERE userId = ? ORDER BY updatedAt DESC LIMIT 1",
      [userId]
    );
    const own = normalize(rows?.[0]?.evolutionApiUrl || "", rows?.[0]?.evolutionApiKey || "");
    if (own) return own;
  } catch {
    /* 忽略，继续下一级 */
  }

  // 3) 真正配置过的管理员账号（避免 LIMIT 1 随机挑到没配置的管理员）
  try {
    const [adminRows]: any = await conn.execute(
      `SELECT s.evolutionApiUrl, s.evolutionApiKey
         FROM AppSettings s
         JOIN User u ON u.id = s.userId
        WHERE u.role = 'ADMIN'
          AND COALESCE(s.evolutionApiUrl, '') <> ''
          AND COALESCE(s.evolutionApiKey, '') <> ''
        ORDER BY s.updatedAt DESC
        LIMIT 1`
    );
    const adminCfg = normalize(adminRows?.[0]?.evolutionApiUrl || "", adminRows?.[0]?.evolutionApiKey || "");
    if (adminCfg) return adminCfg;
  } catch {
    /* 忽略，继续下一级 */
  }

  // 4) 全局默认行
  try {
    const [defRows]: any = await conn.execute(
      "SELECT evolutionApiUrl, evolutionApiKey FROM AppSettings WHERE id = 'default' LIMIT 1"
    );
    return normalize(defRows?.[0]?.evolutionApiUrl || "", defRows?.[0]?.evolutionApiKey || "");
  } catch {
    return null;
  }
}

/** 统一整理返回给前端的实例对外形象（绝不包含明文 token） */
export function maskToken(token: string): string {
  const t = (token || "").trim();
  if (!t) return "";
  if (t.length <= 8) return "****";
  return `${t.slice(0, 4)}****${t.slice(-4)}`;
}
