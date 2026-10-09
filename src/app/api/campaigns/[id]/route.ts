import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import { isAuthorizedInternal } from "@/lib/authToken";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

// ─── GET /api/campaigns/[id] ───────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session && !isAuthorizedInternal(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session?.user?.id;
  const conn = await getConn();
  try {
    let sql = `
      SELECT c.*, g.name as groupName, g.filterConfig 
      FROM Campaign c 
      LEFT JOIN \`Group\` g ON c.groupId = g.id 
      WHERE c.id = ?
    `;
    const values: any[] = [id];

    if (userId) {
      sql += " AND c.userId = ?";
      values.push(userId);
    }

    const [rows]: any = await conn.execute(sql, values);

    if (rows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const campaign = rows[0];
    
    if (campaign.filterConfig) {
      try {
        campaign.filterConfig = typeof campaign.filterConfig === 'string' 
          ? JSON.parse(campaign.filterConfig) 
          : campaign.filterConfig;
      } catch (e) {
        campaign.filterConfig = {};
      }
    }

    // 解析 materialId 并获取完整素材内容
    campaign.materials = [];
    if (campaign.materialId) {
      try {
        let materialIds = typeof campaign.materialId === 'string' 
          ? JSON.parse(campaign.materialId) 
          : campaign.materialId;
        
        if (Array.isArray(materialIds) && materialIds.length > 0) {
          const placeholders = materialIds.map(() => '?').join(',');
          const [matRows]: any = await conn.execute(`SELECT * FROM Material WHERE id IN (${placeholders})`, materialIds);
          campaign.materials = matRows;
        }
      } catch (e) {
        console.error("Error fetching materials for campaign:", e);
      }
    }

    return NextResponse.json(campaign);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const resolvedParams = await params;
  const { id } = resolvedParams;
  const data = await req.json();
  const conn = await getConn();
  try {
    const updates: string[] = [];
    const values: any[] = [];

    for (const key of Object.keys(data)) {
      if (["name", "description", "status", "notionDatabaseId", "n8nWebhookUrl", "groupId", "sourceId", "materialId", "scheduleConfig", "useAi", "useRandom", "aiPrompt", "aiModel", "instanceName"].includes(key)) {
        updates.push(`${key} = ?`);
        let val = data[key];
        if (key === "scheduleConfig" && val !== null && typeof val === "object") {
          val = JSON.stringify(val);
        }
        if (["useAi", "useRandom"].includes(key)) {
          val = val ? 1 : 0;
        }
        values.push(val ?? null); 
      }
    }

    // Always recalculate contactCount based on the target group (either provided or existing) and sourceId (either provided or existing)
    const campaignDetails = await conn.execute("SELECT sourceId, groupId FROM Campaign WHERE id = ?", [id]).then(([rows]: any) => rows[0]);
    const targetSourceId = data.sourceId !== undefined ? data.sourceId : campaignDetails?.sourceId;
    const targetGroupId = data.groupId || campaignDetails?.groupId;
    
    if (targetGroupId || targetSourceId) {
      let cfg: any = {};
      if (targetGroupId) {
        const [groupRows]: any = await conn.execute("SELECT filterConfig FROM `Group` WHERE id = ? AND userId = ?", [targetGroupId, userId]);
        if (groupRows.length > 0 && groupRows[0].filterConfig) {
          cfg = typeof groupRows[0].filterConfig === 'string' ? JSON.parse(groupRows[0].filterConfig) : groupRows[0].filterConfig;
        }
      }
      
      let countSql = "SELECT COUNT(*) as count FROM Contact WHERE userId = ? AND (phone IS NULL OR phone = '' OR phone NOT IN (SELECT phone FROM Blacklist WHERE userId = ? AND phone IS NOT NULL AND phone != ''))";
      const queryParams: any[] = [userId, userId];

      const effectiveSourceId = targetSourceId || cfg.sourceId;
      if (effectiveSourceId) {
        countSql += " AND sourceId = ?";
        queryParams.push(effectiveSourceId);
      }

      if (cfg.markets?.length > 0) {
        countSql += ` AND market IN (${cfg.markets.map(() => "?").join(",")})`;
        queryParams.push(...cfg.markets);
      }
      
      if (cfg.relations?.length > 0) {
        const relationConditions = cfg.relations.map(() => "relation LIKE ?");
        const joiner = cfg.matchMode === "ALL" ? " AND " : " OR ";
        countSql += ` AND (${relationConditions.join(joiner)})`;
        cfg.relations.forEach((r: string) => queryParams.push(`%${r}%`));
      }

      // Add manual exclusions to the query for precision
      if (Array.isArray(cfg.excludedIds) && cfg.excludedIds.length > 0) {
        countSql += ` AND id NOT IN (${cfg.excludedIds.map(() => "?").join(",")})`;
        queryParams.push(...cfg.excludedIds);
      }

      const [countResult]: any = await conn.execute(countSql, queryParams);
      const contactCount = countResult[0].count;
      
      // Remove existing contactCount update if already added manually in the loop
      const existingIdx = updates.findIndex(u => u.startsWith("contactCount"));
      if (existingIdx !== -1) {
        updates.splice(existingIdx, 1);
        values.splice(existingIdx, 1);
      }

      updates.push(`contactCount = ?`);
      values.push(contactCount);
    }

    if (updates.length === 0) return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });

    updates.push("updatedAt = ?");
    values.push(new Date());
    
    // Final ID and userId for WHERE clause
    values.push(id);
    values.push(userId);

    const [updateResult]: any = await conn.execute(`UPDATE Campaign SET ${updates.join(", ")} WHERE id = ? AND userId = ?`, values);
    if (updateResult.affectedRows === 0) return NextResponse.json({ error: "Not found or no permission" }, { status: 404 });
    
    const [rows]: any = await conn.execute("SELECT * FROM Campaign WHERE id = ? AND userId = ? LIMIT 1", [id, userId]);
    return NextResponse.json(rows[0]);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const { id } = await params;
  const conn = await getConn();
  try {
    // 先删除关联的发送日志，避免外键约束报错
    await conn.execute("DELETE FROM SendLog WHERE campaignId = ?", [id]);
    
    const [result]: any = await conn.execute("DELETE FROM Campaign WHERE id = ? AND userId = ?", [id, userId]);
    if (result.affectedRows === 0) return NextResponse.json({ error: "Not found or no permission" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
