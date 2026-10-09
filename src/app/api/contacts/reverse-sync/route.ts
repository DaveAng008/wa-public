import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import { startAsyncSync } from "@/lib/notionSyncService";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session?.user?.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    // 自动检查并添加 lastReverseSyncAt 字段
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN lastReverseSyncAt DATETIME DEFAULT NULL");
    } catch (e) {
      // 忽略字段已存在的错误
    }

    let mapping = {};
    let selectedFields: string[] = [];
    let sourceId = "";
    try {
      const body = await req.json();
      mapping = body.mapping || {};
      selectedFields = body.selectedFields || [];
      sourceId = body.sourceId || "";
    } catch (e) {
      // Ignore parse errors if no body provided
    }

    let webhookUrl = "";
    let notionSecret = "";
    let notionDatabaseId = "";

    if (sourceId) {
      const [ds]: any = await conn.execute("SELECT notionSyncWebhookUrl, notionSecret, notionDatabaseId FROM DataSource WHERE id = ? AND userId = ? LIMIT 1", [sourceId, userId]);
      if (ds[0]) {
        webhookUrl = ds[0].notionSyncWebhookUrl || "";
        notionSecret = ds[0].notionSecret || "";
        notionDatabaseId = ds[0].notionDatabaseId || "";
      }
    }

    // Fallback to global config if empty/not found
    if (!webhookUrl || !notionSecret || !notionDatabaseId) {
      const [settings]: any = await conn.execute("SELECT notionSyncWebhookUrl, notionSecret, notionDatabaseId FROM AppSettings WHERE userId = ? LIMIT 1", [userId]);
      webhookUrl = webhookUrl || settings[0]?.notionSyncWebhookUrl;
      notionSecret = notionSecret || settings[0]?.notionSecret;
      notionDatabaseId = notionDatabaseId || settings[0]?.notionDatabaseId;
    }

    if (!webhookUrl || !notionSecret || !notionDatabaseId) {
      const [defaultSettings]: any = await conn.execute("SELECT notionSyncWebhookUrl, notionSecret, notionDatabaseId FROM AppSettings WHERE id = 'default' LIMIT 1");
      webhookUrl = webhookUrl || defaultSettings[0]?.notionSyncWebhookUrl;
      notionSecret = notionSecret || defaultSettings[0]?.notionSecret;
      notionDatabaseId = notionDatabaseId || defaultSettings[0]?.notionDatabaseId;
    }

    if (!notionSecret || !notionDatabaseId) {
      return NextResponse.json({ error: "未配置 Notion 连接凭证，请先在数据源或系统设置中配置" }, { status: 400 });
    }

    // 记录上次同步时间
    await conn.execute("UPDATE AppSettings SET lastReverseSyncAt = ?, updatedAt = NOW() WHERE userId = ?", [new Date(), userId]);

    // 启动非阻塞后台任务进行同步，不阻塞 HTTP 响应
    startAsyncSync({
      userId: userId as string,
      sourceId,
      notionSecret,
      notionDatabaseId,
      mapping,
      selectedFields
    });

    return NextResponse.json({ 
      success: true, 
      message: "反向同步已在后台启动！请在同步日志中查看进度。" 
    });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
