import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const conn = await getConn();

  try {
    // 1. 总人数
    const [totalRes]: any = await conn.execute(
      "SELECT COUNT(*) as count FROM Contact WHERE userId = ?",
      [userId]
    );
    const total = totalRes[0].count;

    if (total === 0) {
      return NextResponse.json({
        total: 0,
        unsent: 0,
        sent: 0,
        unsentPercentage: 0,
        markets: [],
        tags: []
      });
    }

    // 2. 未发送人数
    const [unsentRes]: any = await conn.execute(
      "SELECT COUNT(*) as count FROM Contact WHERE userId = ? AND sent = false",
      [userId]
    );
    const unsent = unsentRes[0].count;
    const sent = total - unsent;
    const unsentPercentage = ((unsent / total) * 100).toFixed(1);

    // 3. 市场分布
    const [marketRes]: any = await conn.execute(
      "SELECT market, COUNT(*) as count FROM Contact WHERE userId = ? GROUP BY market",
      [userId]
    );
    const markets = marketRes.map((r: any) => ({
      name: r.market || "未填",
      count: r.count,
      percentage: ((r.count / total) * 100).toFixed(1)
    }));

    // 4. 标签分布 (Relation)
    const [relationRes]: any = await conn.execute(
      "SELECT relation FROM Contact WHERE userId = ?",
      [userId]
    );
    
    const tagCounts: { [key: string]: number } = {};
    relationRes.forEach((row: any) => {
      try {
        const tags = JSON.parse(row.relation || "[]");
        tags.forEach((tag: string) => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      } catch (e) {
        // 忽略解析错误
      }
    });

    const tags = Object.entries(tagCounts).map(([name, count]) => ({
      name,
      count,
      percentage: ((count / total) * 100).toFixed(1)
    })).sort((a, b) => b.count - a.count);

    return NextResponse.json({
      total,
      unsent,
      sent,
      unsentPercentage,
      markets,
      tags
    });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
