import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const withCounts = req.nextUrl.searchParams.get("withCounts") === "true";
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [rows]: any = await conn.execute(
      `SELECT ds.*, 
        (SELECT COUNT(*) FROM Contact c WHERE c.sourceId = ds.id AND c.userId = ds.userId AND c.phone NOT IN (SELECT phone FROM Blacklist WHERE userId = ds.userId)) as contactCount 
       FROM DataSource ds 
       WHERE ds.userId = ? 
       ORDER BY ds.createdAt DESC`,
      [userId]
    );

    if (withCounts) {
      const [unassignedRows]: any = await conn.execute(
        `SELECT COUNT(*) as count FROM Contact WHERE userId = ? AND (sourceId IS NULL OR sourceId = '' OR sourceId = 'whatsapp_sync' OR sourceId NOT IN (SELECT id FROM DataSource)) AND phone NOT IN (SELECT phone FROM Blacklist WHERE userId = ?)`,
        [userId, userId]
      );

      return NextResponse.json({
        dataSources: rows,
        unassignedCount: unassignedRows[0]?.count || 0
      });
    }

    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  try {
    const body = await req.json();
    const { name, type, notionSecret, notionDatabaseId, notionSyncWebhookUrl, description } = body;

    if (!name || !type) {
      return NextResponse.json({ error: "Missing required fields: name, type" }, { status: 400 });
    }

    const id = "ds_" + Math.random().toString(36).slice(2, 22);
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      await conn.execute(
        "INSERT INTO DataSource (id, name, type, notionSecret, notionDatabaseId, notionSyncWebhookUrl, description, userId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
        [
          id,
          name,
          type,
          notionSecret || null,
          notionDatabaseId || null,
          notionSyncWebhookUrl || null,
          description || null,
          userId
        ]
      );
      return NextResponse.json({ success: true, id, name });
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
