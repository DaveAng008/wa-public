import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conn = await getConn();
  try {
    const [rows]: any = await conn.execute(
      `SELECT id, contactId, contactName, phone, ruleName, messageText, status, steps, duration, createdAt 
       FROM AutomationLog 
       WHERE userId = ? 
       ORDER BY createdAt DESC 
       LIMIT 200`,
      [session.user.id]
    );

    const logs = rows.map((row: any) => {
      let parsedSteps = [];
      if (row.steps) {
        try {
          parsedSteps = typeof row.steps === "string" ? JSON.parse(row.steps) : row.steps;
        } catch (e) {
          parsedSteps = [];
        }
      }
      return {
        id: row.id,
        contactId: row.contactId,
        contactName: row.contactName,
        phone: row.phone,
        ruleName: row.ruleName,
        messageText: row.messageText,
        status: row.status,
        steps: parsedSteps,
        duration: row.duration,
        createdAt: row.createdAt
      };
    });

    return NextResponse.json(logs);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  const conn = await getConn();
  try {
    if (id) {
      // Delete specific log
      await conn.execute(
        "DELETE FROM AutomationLog WHERE id = ? AND userId = ?",
        [id, session.user.id]
      );
      return NextResponse.json({ success: true, deletedId: id });
    } else {
      // Clear all logs for this user
      await conn.execute(
        "DELETE FROM AutomationLog WHERE userId = ?",
        [session.user.id]
      );
      return NextResponse.json({ success: true, cleared: true });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
