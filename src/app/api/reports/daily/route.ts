import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") || "30", 10);

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [rows]: any = await conn.execute(`
      SELECT 
        DATE_FORMAT(createdAt, '%Y-%m-%d') as date,
        COUNT(*) as sent,
        SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        0 as responded
      FROM SendLog
      WHERE userId = ? AND createdAt >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE_FORMAT(createdAt, '%Y-%m-%d')
      ORDER BY date ASC
    `, [userId, days]);

    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("Daily Stats Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
