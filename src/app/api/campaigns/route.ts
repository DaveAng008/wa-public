import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import { isAuthorizedInternal } from "@/lib/authToken";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

function generateId() {
  return "cmp_" + Math.random().toString(36).slice(2, 12);
}

// ─── GET /api/campaigns ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await auth();

  // If accessed by n8n token, we might allow full access or need a specific userId param
  // For UI users, we MUST isolate by session.user.id
  if (!session && !isAuthorizedInternal(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conn = await getConn();
  try {
    let sql = `
      SELECT c.*, 
             u.name as ownerName, u.email as ownerEmail
      FROM Campaign c
      LEFT JOIN User u ON c.userId COLLATE utf8mb4_unicode_ci = u.id
    `;

    const params: any[] = [];

    // Isolation: Only show own campaigns unless it's a token-based system call
    if (session?.user) {
      sql += " WHERE c.userId = ?";
      params.push(session.user.id);
    }

    sql += " ORDER BY c.createdAt DESC";

    const [rows]: any = await conn.execute(sql, params);

    const campaigns = [];
    for (const r of rows) {
      let materials = [];
      if (r.materialId) {
        try {
          let materialIds = typeof r.materialId === 'string' ? JSON.parse(r.materialId) : r.materialId;
          if (Array.isArray(materialIds) && materialIds.length > 0) {
            const placeholders = materialIds.map(() => '?').join(',');
            const [matRows]: any = await conn.execute(`SELECT * FROM Material WHERE id IN (${placeholders})`, materialIds);
            materials = matRows;
          }
        } catch (e) {
          // ignore parse error
        }
      }

      campaigns.push({
        ...r,
        owner: r.userId ? { id: r.userId, name: r.ownerName, email: r.ownerEmail } : undefined,
        contactCount: Number(r.contactCount || 0),
        materials
      });
    }

    return NextResponse.json(campaigns);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

// ─── POST /api/campaigns ────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await req.json();
  const { name, description, notionDatabaseId, n8nWebhookUrl, groupId, useAi, useRandom, aiPrompt, aiModel, materialId, sourceId, scheduleConfig } = data;

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const conn = await getConn();
  try {
    const id = generateId();
    const now = new Date();
    const userId = session.user.id;

    let contactCount = 0;
    let cfg: any = {};
    if (groupId) {
      const [groupRows]: any = await conn.execute("SELECT filterConfig FROM `Group` WHERE id = ? AND userId = ?", [groupId, userId]);
      if (groupRows.length > 0 && groupRows[0].filterConfig) {
        cfg = typeof groupRows[0].filterConfig === 'string' ? JSON.parse(groupRows[0].filterConfig) : groupRows[0].filterConfig;
      }
    }

    if (groupId || sourceId) {
      let countSql = "SELECT COUNT(*) as count FROM Contact WHERE userId = ? AND (phone IS NULL OR phone = '' OR phone NOT IN (SELECT phone FROM Blacklist WHERE userId = ? AND phone IS NOT NULL AND phone != ''))";
      const queryParams: any[] = [userId, userId];

      const effectiveSourceId = sourceId || cfg.sourceId;
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
        countSql += ` AND (${relationConditions.join(cfg.matchMode === "ALL" ? " AND " : " OR ")})`;
        cfg.relations.forEach((r: string) => queryParams.push(`%${r}%`));
      }

      const [countResult]: any = await conn.execute(countSql, queryParams);
      const total = countResult[0].count;
      const excludedCount = Array.isArray(cfg.excludedIds) ? cfg.excludedIds.length : 0;
      contactCount = Math.max(0, total - excludedCount);
    }

    await conn.execute(
      "INSERT INTO Campaign (id, name, description, notionDatabaseId, n8nWebhookUrl, groupId, sourceId, contactCount, status, userId, ownerId, createdAt, updatedAt, useAi, useRandom, aiPrompt, aiModel, materialId, scheduleConfig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, name, description || "", notionDatabaseId || "", n8nWebhookUrl || "", groupId || "", sourceId || null, contactCount, "DRAFT", userId, userId, now, now, useAi ? 1 : 0, useRandom ? 1 : 0, aiPrompt || "", aiModel || "gpt-4o-mini", materialId ? JSON.stringify(materialId) : "[]", scheduleConfig ? JSON.stringify(scheduleConfig) : null]
    );

    return NextResponse.json({ 
      id, name, description, status: "DRAFT", groupId, sourceId, contactCount, notionDatabaseId, n8nWebhookUrl, createdAt: now,
      useAi, useRandom, aiPrompt, aiModel, scheduleConfig
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
