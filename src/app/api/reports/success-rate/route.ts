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
        SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
      FROM SendLog
      WHERE userId = ?
    `, [userId]);

    const result = rows[0] || { success: 0, failed: 0 };
    
    return NextResponse.json({
      success: Number(result.success) || 0,
      failed: Number(result.failed) || 0
    });
  } catch (e: any) {
    console.error("Success Rate Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
