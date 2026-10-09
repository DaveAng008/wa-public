import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const resolvedParams = await params;
  const { id } = resolvedParams;

  try {
    const body = await req.json();
    const { name, notionSecret, notionDatabaseId, notionSyncWebhookUrl, description } = body;

    if (!name) {
      return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
    }

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      const [result]: any = await conn.execute(
        "UPDATE DataSource SET name = ?, notionSecret = ?, notionDatabaseId = ?, notionSyncWebhookUrl = ?, description = ?, updatedAt = NOW() WHERE id = ? AND userId = ?",
        [
          name,
          notionSecret || null,
          notionDatabaseId || null,
          notionSyncWebhookUrl || null,
          description || null,
          id,
          userId
        ]
      );

      if (result.affectedRows === 0) {
        return NextResponse.json({ error: "DataSource not found" }, { status: 404 });
      }

      return NextResponse.json({ success: true, id });
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const resolvedParams = await params;
  const { id } = resolvedParams;

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [result]: any = await conn.execute(
      "DELETE FROM DataSource WHERE id = ? AND userId = ?",
      [id, userId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "DataSource not found" }, { status: 404 });
    }

    // 同时删除该数据源下的所有联系人
    await conn.execute(
      "DELETE FROM Contact WHERE sourceId = ? AND userId = ?",
      [id, userId]
    );

    return NextResponse.json({ success: true, message: "DataSource and its contacts deleted successfully" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
