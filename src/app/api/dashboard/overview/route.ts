import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    // 1. 统计活跃活动
    const [[{ activeCampaigns }]]: any = await conn.execute(
      "SELECT COUNT(*) as activeCampaigns FROM Campaign WHERE status = 'ACTIVE' AND userId = ?", 
      [userId]
    );

    // 2. 统计总发送量 (从 SendLog 统计 SENT 的记录)
    const [[{ totalSent }]]: any = await conn.execute(
      "SELECT COUNT(*) as totalSent FROM SendLog WHERE status = 'SENT' AND userId = ?",
      [userId]
    );

    // 3. 统计今日发送量
    const today = new Date().toISOString().split('T')[0];
    const [[{ todaySent }]]: any = await conn.execute(
      "SELECT COUNT(*) as todaySent FROM SendLog WHERE status = 'SENT' AND userId = ? AND createdAt >= ?",
      [userId, `${today} 00:00:00`]
    );

    // 4. 统计在线账号 (暂无该表，返回 0)
    const onlineAccounts = 0;

    // 5. 获取最近活动
    const [recentActivity]: any = await conn.execute(`
      SELECT 
        id, 
        'sent' as type, 
        phone as contactName, 
        message, 
        createdAt as timestamp 
      FROM SendLog 
      WHERE userId = ? AND status = 'SENT'
      ORDER BY createdAt DESC 
      LIMIT 10
    `, [userId]).catch(() => [[]]);

    // 6. 检查是否有正在运行的任务 (简单逻辑：最近 5 分钟有 PENDING 记录)
    const [[{ pendingCount }]]: any = await conn.execute(
      "SELECT COUNT(*) as pendingCount FROM SendLog WHERE status = 'PENDING' AND userId = ?",
      [userId]
    ).catch(() => [[{ pendingCount: 0 }]]);

    return NextResponse.json({
      todaySent: todaySent || 0,
      totalSent: totalSent || 0,
      activeCampaigns: activeCampaigns || 0,
      onlineAccounts: onlineAccounts || 0,
      recentActivity: recentActivity || [],
      activeJob: pendingCount > 0 ? {
        campaignId: "active",
        campaignName: "执行中任务",
        total: pendingCount,
        sent: 0,
        remaining: pendingCount
      } : undefined
    });
  } catch (e: any) {
    console.error("Dashboard Overview Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
