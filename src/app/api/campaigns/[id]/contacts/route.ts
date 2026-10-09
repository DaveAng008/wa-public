import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import { isAuthorizedInternal } from "@/lib/authToken";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session && !isAuthorizedInternal(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conn = await getConn();
  try {
    // 1. 获取活动关联的人群包配置及数据源配置
    const [campaignRows]: any = await conn.execute(`
      SELECT c.groupId, c.sourceId, c.userId, g.filterConfig 
      FROM Campaign c 
      LEFT JOIN \`Group\` g ON c.groupId = g.id 
      WHERE c.id = ? 
      LIMIT 1
    `, [id]);

    if (campaignRows.length === 0) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const cfg = campaignRows[0].filterConfig
      ? (typeof campaignRows[0].filterConfig === 'string' ? JSON.parse(campaignRows[0].filterConfig) : campaignRows[0].filterConfig)
      : {};

    // 2. 构建联系人查询 SQL
    let contactSql = "SELECT * FROM Contact WHERE userId = ? AND (phone IS NULL OR phone = '' OR phone NOT IN (SELECT phone FROM Blacklist WHERE userId = ? AND phone IS NOT NULL AND phone != ''))";
    const queryParams: any[] = [campaignRows[0].userId, campaignRows[0].userId];

    const effectiveSourceId = campaignRows[0].sourceId || cfg.sourceId;
    if (effectiveSourceId) {
      contactSql += " AND sourceId = ?";
      queryParams.push(effectiveSourceId);
    }

    if (cfg.markets?.length > 0) {
      contactSql += ` AND market IN (${cfg.markets.map(() => "?").join(",")})`;
      queryParams.push(...cfg.markets);
    }
    
    if (cfg.relations?.length > 0) {
      const relationConditions = cfg.relations.map(() => "relation LIKE ?");
      contactSql += ` AND (${relationConditions.join(cfg.matchMode === "ALL" ? " AND " : " OR ")})`;
      cfg.relations.forEach((r: string) => queryParams.push(`%${r}%`));
    }

    // 3. 执行查询
    const [contacts]: any = await conn.execute(contactSql, queryParams);

    // 4. 排除黑名单
    const excludedIds = new Set(cfg.excludedIds || []);
    const filteredContacts = contacts.filter((c: any) => !excludedIds.has(c.id));

    return NextResponse.json({
      campaignId: id,
      total: filteredContacts.length,
      contacts: filteredContacts
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
