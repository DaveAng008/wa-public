import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { getInternalToken, isAuthorizedInternal } from "@/lib/authToken";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedInternal(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 内部调用令牌未配置时直接拒绝，避免发出注定 401 的请求
  const triggerToken = getInternalToken();
  if (!triggerToken) {
    return NextResponse.json({ error: "CRON_TOKEN 未配置，无法发起内部同步调用" }, { status: 500 });
  }

  const conn = await getConn();
  const triggeredSyncs = [];

  try {
    const now = new Date();
    // 使用北京时间
    const currentHHMM = now.toLocaleTimeString('zh-CN', { 
      timeZone: 'Asia/Shanghai', 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    // 查询所有配置了自动同步的用户
    const [rows]: any = await conn.execute(
      "SELECT userId, whatsappSyncTime, whatsappSyncEnabled, whatsappAutoSyncInstances FROM AppSettings WHERE whatsappSyncEnabled = 1"
    );

    // 使用固定的服务地址，绝不信任请求的 Host 头（防止 Host 伪造导致 SSRF 与令牌外泄）
    const configuredBase = (process.env.INTERNAL_BASE_URL || process.env.NEXTAUTH_URL || "").trim().replace(/\/+$/, "");
    const base = configuredBase || `http://127.0.0.1:${process.env.PORT || 3000}`;
    const syncApiUrl = `${base}/api/contacts/sync-whatsapp?token=${encodeURIComponent(triggerToken)}`;

    for (const row of rows) {
      if (!row.whatsappSyncTime) continue;

      // 允许包含误差，只检查当前小时和分钟是否等于设定的定时同步时间
      if (currentHHMM === row.whatsappSyncTime) {
        let selectedInstances = "all";
        if (row.whatsappAutoSyncInstances) {
          try {
            const parsed = JSON.parse(row.whatsappAutoSyncInstances);
            if (Array.isArray(parsed) && parsed.length > 0) {
              selectedInstances = parsed as any;
            }
          } catch (e) {
            selectedInstances = "all";
          }
        }

        // 调用同步 API
        try {
          const res = await fetch(syncApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              userId: row.userId,
              instanceName: selectedInstances
            })
          });

          if (res.ok) {
            triggeredSyncs.push({ userId: row.userId, instances: selectedInstances });
          } else {
            console.error(`Failed to trigger auto sync for user ${row.userId}, status: ${res.status}`);
          }
        } catch (fetchErr) {
          console.error(`Error fetching sync api for user ${row.userId}:`, fetchErr);
        }
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Checked ${rows.length} users, auto synced for ${triggeredSyncs.length} users.`,
      currentHHMM,
      triggeredSyncs
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
