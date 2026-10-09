import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

function parseMultiSelectParam(param: string | null): string[] {
  if (!param) return [];
  const trimmed = param.trim();
  if (trimmed === "all" || trimmed === "undefined" || trimmed === "") {
    return [];
  }
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      return [];
    }
  }
  return trimmed.split(",").map(s => s.trim()).filter(Boolean);
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const sourceId = url.searchParams.get("sourceId") || "";

  const conn = await getConn();
  try {
    const userId = (session.user as any).id;
    const parsedSourceIds = parseMultiSelectParam(sourceId);
    
    let marketsSql = "SELECT DISTINCT market FROM Contact WHERE userId = ? AND market IS NOT NULL AND market != ''";
    let relationsSql = "SELECT DISTINCT relation FROM Contact WHERE userId = ? AND relation IS NOT NULL AND relation != ''";
    let keysSql = "SELECT DISTINCT JSON_KEYS(properties) as keysJson FROM Contact WHERE userId = ? AND properties IS NOT NULL AND properties != '{}'";
    
    const params = [userId];
    if (parsedSourceIds.length > 0) {
      const placeholders = parsedSourceIds.map(() => "?").join(",");
      marketsSql += ` AND sourceId IN (${placeholders})`;
      relationsSql += ` AND sourceId IN (${placeholders})`;
      keysSql += ` AND sourceId IN (${placeholders})`;
      params.push(...parsedSourceIds);
      params.push(...parsedSourceIds);
      params.push(...parsedSourceIds);
    }

    const [markets]: any = await conn.execute(marketsSql, params);
    const [relations]: any = await conn.execute(relationsSql, params);

    // 解析出干净、不带中括号和引号的单个标签列表
    const uniqueRelations = new Set<string>();
    relations.forEach((r: any) => {
      const relStr = r.relation;
      if (!relStr) return;
      try {
        const parsed = JSON.parse(relStr);
        if (Array.isArray(parsed)) {
          parsed.forEach((tag: string) => {
            if (tag) uniqueRelations.add(tag.trim());
          });
        } else if (typeof parsed === 'string') {
          uniqueRelations.add(parsed.trim());
        }
      } catch {
        // 如果不是 JSON，尝试使用英文/中文逗号进行拆分
        const delimiter = relStr.includes("，") ? "，" : ",";
        relStr.split(delimiter).forEach((tag: string) => {
          if (tag) uniqueRelations.add(tag.trim());
        });
      }
    });

    // 方案 A 核心优化：利用 MySQL 的 JSON_KEYS 函数进行全表键名提取并去重，无数量限制，性能极高
    const [keyRows]: any = await conn.execute(keysSql, params);
    const allKeys = new Set<string>();
    
    keyRows.forEach((row: any) => {
      let keys = row.keysJson;
      if (typeof keys === 'string') {
        try { keys = JSON.parse(keys); } catch (e) { keys = null; }
      }
      if (Array.isArray(keys)) {
        keys.forEach((k: string) => {
          if (k) allKeys.add(k);
        });
      }
    });

    // ─── 核心修复 ───
    // 从 AppSettings 获取用户主动创建的自定义列列表，确保新建且尚无联系人拥有其属性值的空白列，也能正常出现在筛选器和“显示列”勾选列表中
    const [settingsRows]: any = await conn.execute(
      "SELECT customSchema FROM AppSettings WHERE userId = ? LIMIT 1",
      [userId]
    );
    if (settingsRows.length > 0 && settingsRows[0].customSchema) {
      try {
        const parsed = typeof settingsRows[0].customSchema === 'string'
          ? JSON.parse(settingsRows[0].customSchema)
          : settingsRows[0].customSchema;
        if (Array.isArray(parsed)) {
          parsed.forEach((k: string) => {
            if (k) allKeys.add(k.trim());
          });
        }
      } catch (e) {}
    }

    return NextResponse.json({
      markets: markets.map((m: any) => m.market),
      relations: Array.from(uniqueRelations),
      availableColumns: Array.from(allKeys),
      version: "V5_FILTER_SCHEMAS"
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
