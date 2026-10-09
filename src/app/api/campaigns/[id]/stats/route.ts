import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    // 1. 查询真实的发送统计
    const [stats]: any = await conn.execute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending
      FROM SendLog 
      WHERE campaignId = ?
    `, [id]);

    // 2. 查询最近的 20 条发送日志
    const [logs]: any = await conn.execute(`
      SELECT 
        id, phone, message, status, createdAt, error
      FROM SendLog 
      WHERE campaignId = ?
      ORDER BY createdAt DESC
      LIMIT 20
    `, [id]);
    
    const s = stats[0];
    
    return NextResponse.json({
      campaignId: id,
      total: s.total || 0,
      sent: s.sent || 0,
      failed: s.failed || 0,
      pending: s.pending || 0,
      successRate: s.total > 0 ? Math.round((s.sent / s.total) * 100) : 0,
      recentLogs: logs // 返回真实日志
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
