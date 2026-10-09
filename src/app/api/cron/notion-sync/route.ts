import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";

import { startAsyncSync } from "@/lib/notionSyncService";
import { isAuthorizedInternal } from "@/lib/authToken";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedInternal(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. 获取当前时间 (北京时间)
    const now = new Date();
    const currentHour = now.toLocaleTimeString('zh-CN', { 
      timeZone: 'Asia/Shanghai', 
      hour: '2-digit', 
      hour12: false 
    });

    const conn = await getConn();
    
    // 2. 查询所有配置了 Notion 数据库凭证且开启了定时的用户
    const [rows]: any = await conn.execute(
      "SELECT userId, scheduledTime, notionSecret, notionDatabaseId FROM AppSettings WHERE notionSecret IS NOT NULL AND notionSecret != '' AND notionDatabaseId IS NOT NULL AND notionDatabaseId != ''"
    );
    await conn.end();

    const triggeredUsers = [];

    // 3. 检查时间并触发本地反向同步
    for (const row of rows) {
      if (!row.scheduledTime) continue;
      
      // 提取小时, 例如 "09:35" -> "09"
      const targetHour = row.scheduledTime.split(":")[0];
      
      if (currentHour === targetHour) {
        try {
          // 直连本地后台同步逻辑，不需经过 N8N
          startAsyncSync({
            userId: row.userId,
            sourceId: "", // 全局同步
            notionSecret: row.notionSecret,
            notionDatabaseId: row.notionDatabaseId,
            mapping: {},
            selectedFields: [] // 空表示自动使用默认的“发送次数”与“是否已发送”
          });
          triggeredUsers.push(row.userId);
        } catch (error) {
          console.error(`Error triggering local sync for user ${row.userId}:`, error);
        }
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Checked ${rows.length} users, triggered local reverse-sync for ${triggeredUsers.length} users.`,
      currentHour,
      triggeredUsers
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
