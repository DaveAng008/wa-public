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
        (DAYOFWEEK(createdAt) - 1) as dayOfWeek,
        HOUR(createdAt) as hour,
        COUNT(*) as count
      FROM SendLog
      WHERE userId = ?
      GROUP BY dayOfWeek, hour
      ORDER BY dayOfWeek, hour
    `, [userId]);

    const formattedRows = rows.map((r: any) => ({
      dayOfWeek: Number(r.dayOfWeek),
      hour: Number(r.hour),
      count: Number(r.count)
    }));

    return NextResponse.json(formattedRows);
  } catch (e: any) {
    console.error("Heatmap Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
