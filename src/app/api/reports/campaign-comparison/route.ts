import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [rows]: any = await conn.execute(`
      SELECT 
        s.campaignId,
        COALESCE(c.name, '未知活动') as campaignName,
        COUNT(*) as sent,
        SUM(CASE WHEN s.status = 'SENT' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN s.status = 'FAILED' THEN 1 ELSE 0 END) as failed
      FROM SendLog s
      LEFT JOIN Campaign c ON s.campaignId = c.id
      WHERE s.userId = ?
      GROUP BY s.campaignId, c.name
      ORDER BY sent DESC
      LIMIT 10
    `, [userId]);

    return NextResponse.json(rows);
  } catch (e: any) {
    console.error("Campaign Comparison Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
