import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import { isAuthorizedInternal } from "@/lib/authToken";

if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("charset=")) {
  const url = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.includes("?") ? `${url}&charset=utf8mb4` : `${url}?charset=utf8mb4`;
}

export const dynamic = "force-dynamic";

// 密钥类字段一律不回传明文：GET 只返回掩码，POST 遇到掩码值表示"未修改"
const SECRET_FIELDS = ["evolutionApiKey", "notionSecret", "hubWebhookToken"] as const;

function maskSecretValue(v: any): string {
  const s = typeof v === "string" ? v : "";
  if (!s) return "";
  if (s.length <= 8) return "****";
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}

function isMaskedValue(v: any): boolean {
  return typeof v === "string" && v.includes("****");
}

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function GET(req: NextRequest) {
  const session = await auth();

  // 内部服务调用需要 CRON_TOKEN；未配置时该通道关闭
  if (!session && !isAuthorizedInternal(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session?.user?.id;
  const conn = await getConn();
  try {
    // 自动检查并添加字段
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN notionSyncWebhookUrl VARCHAR(255) DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN n8nAiRewriteWebhookUrl VARCHAR(255) DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN n8nAiAnalyzeWebhookUrl VARCHAR(255) DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN n8nBindInstanceWebhookUrl VARCHAR(255) DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN hubWebhookUrl VARCHAR(255) DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN evolutionWebhookUrl VARCHAR(255) DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN hubWebhookToken VARCHAR(255) DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN latestAiAnalysis LONGTEXT DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN latestAiAnalysisTime DATETIME DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN whatsappSyncConfig TEXT DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN whatsappSyncTime VARCHAR(191) DEFAULT '03:00'");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN whatsappSyncEnabled TINYINT(1) DEFAULT 0");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN whatsappAutoSyncInstances TEXT DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN notificationPhone VARCHAR(50) DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN aiSpeechToTextEnabled TINYINT(1) DEFAULT 0");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN aiVisionEnabled TINYINT(1) DEFAULT 0");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN aiVisionPrompt TEXT DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN aiRoutingEnabled TINYINT(1) DEFAULT 0");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN aiRoutingConfig TEXT DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN aiNoiseFilterEnabled TINYINT(1) DEFAULT 0");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN globalTimeConfig TEXT DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN globalFilters TEXT DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN groupMonitorEnabled TINYINT(1) DEFAULT 0");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN groupTargetStepId VARCHAR(191) DEFAULT NULL");
    } catch (e) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN customHookUrl VARCHAR(255) DEFAULT NULL");
    } catch (e) {}

    let query = "SELECT * FROM AppSettings WHERE id = 'default' LIMIT 1";
    let params: any[] = [];
    
    if (userId) {
      query = "SELECT * FROM AppSettings WHERE userId = ? ORDER BY updatedAt DESC LIMIT 1";
      params = [userId];
    }

    const [rows]: any = await conn.execute(query, params);
    
    let user = {} as any;
    if (userId) {
      const [userRows]: any = await conn.execute("SELECT apiKeys, maxInstances FROM User WHERE id = ? LIMIT 1", [userId]);
      user = userRows[0] || {};
    }

    if (rows.length === 0) {
      return NextResponse.json({
        scheduledTime: "09:00",
        maxSendLimit: 100,
        minDelay: 120,
        maxDelay: 200,
        n8nWebhookUrl: "",
        notionSecret: "",
        notionDatabaseId: "",
        notionSyncWebhookUrl: "",
        n8nAiRewriteWebhookUrl: "",
        n8nAiAnalyzeWebhookUrl: "",
        n8nBindInstanceWebhookUrl: "",
        evolutionApiUrl: "",
        evolutionApiKey: "",
        evolutionWebhookUrl: "",
        hubWebhookUrl: "",
        hubWebhookToken: "",
        whatsappSyncConfig: "[]",
        whatsappSyncTime: "03:00",
        whatsappSyncEnabled: 0,
        whatsappAutoSyncInstances: "[]",
        notificationPhone: "",
        aiSpeechToTextEnabled: 0,
        aiVisionEnabled: 0,
        aiVisionPrompt: "判断此图是否为支付凭证（水单），如果是请提取金额，如果是其他截图请做简单分类说明。",
        aiRoutingEnabled: 0,
        aiRoutingConfig: "[]",
        aiNoiseFilterEnabled: 0,
        groupMonitorEnabled: 0,
        groupTargetStepId: "",
        customHookUrl: "",
        maxInstances: user.maxInstances ?? 1,
        apiKeys: typeof user.apiKeys === 'string' ? JSON.parse(user.apiKeys) : user.apiKeys
      });
    }
    
    // 密钥类字段一律只回传掩码，明文永远不出服务端
    const settings: any = { ...rows[0] };
    for (const f of SECRET_FIELDS) settings[f] = maskSecretValue(settings[f]);

    return NextResponse.json({
      ...settings,
      maxSendLimit: Number(settings.maxSendLimit),
      minDelay: Number(settings.minDelay),
      maxDelay: Number(settings.maxDelay),
      hubWebhookUrl: settings.hubWebhookUrl || "",
      hubWebhookToken: settings.hubWebhookToken || "",
      whatsappSyncConfig: settings.whatsappSyncConfig || "[]",
      whatsappSyncTime: settings.whatsappSyncTime || "03:00",
      whatsappSyncEnabled: settings.whatsappSyncEnabled ? 1 : 0,
      whatsappAutoSyncInstances: settings.whatsappAutoSyncInstances || "[]",
      notificationPhone: settings.notificationPhone || "",
      aiSpeechToTextEnabled: settings.aiSpeechToTextEnabled ? 1 : 0,
      aiVisionEnabled: settings.aiVisionEnabled ? 1 : 0,
      aiVisionPrompt: settings.aiVisionPrompt || "判断此图是否为支付凭证（水单），如果是请提取金额，如果是其他截图请做简单分类说明。",
      aiRoutingEnabled: settings.aiRoutingEnabled ? 1 : 0,
      aiRoutingConfig: settings.aiRoutingConfig || "[]",
      aiNoiseFilterEnabled: settings.aiNoiseFilterEnabled ? 1 : 0,
      groupMonitorEnabled: settings.groupMonitorEnabled ? 1 : 0,
      groupTargetStepId: settings.groupTargetStepId || "",
      customHookUrl: settings.customHookUrl || "",
      maxInstances: user.maxInstances ?? 1,
      apiKeys: typeof user.apiKeys === 'string' ? JSON.parse(user.apiKeys) : user.apiKeys
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  try {
    const data = await req.json();
    const conn = await getConn();
    try {
      // 密钥字段：前端回传的是掩码（含 ****）时表示"未修改"，保留数据库原值
      const [curSecretRows]: any = await conn.execute(
        "SELECT evolutionApiKey, notionSecret, hubWebhookToken FROM AppSettings WHERE userId = ? ORDER BY updatedAt DESC LIMIT 1",
        [userId]
      );
      const curSecrets = curSecretRows?.[0] || {};
      const resolveSecret = (incoming: any, fallback: any) =>
        incoming === undefined || isMaskedValue(incoming) ? (fallback || "") : (incoming || "");
      const nextEvolutionApiKey = resolveSecret(data.evolutionApiKey, curSecrets.evolutionApiKey);
      const nextNotionSecret = resolveSecret(data.notionSecret, curSecrets.notionSecret);
      const nextHubWebhookToken = resolveSecret(data.hubWebhookToken, curSecrets.hubWebhookToken);

      // 保存用户 API Keys
      if (data.apiKeys !== undefined) {
        await conn.execute(
          "UPDATE User SET apiKeys = ? WHERE id = ?",
          [typeof data.apiKeys === 'object' ? JSON.stringify(data.apiKeys) : data.apiKeys, userId]
        );
      }

      // 查出所有行（按时间倒序），保留最新行，删除多余骨架行
      const [rows]: any = await conn.execute("SELECT id FROM AppSettings WHERE userId = ? ORDER BY updatedAt DESC", [userId]);
      if (rows.length > 1) {
        // 保留第一行（最新的），删除其余重复骨架行
        const keepId = rows[0].id;
        const deleteIds = rows.slice(1).map((r: any) => r.id);
        for (const delId of deleteIds) {
          await conn.execute("DELETE FROM AppSettings WHERE id = ?", [delId]);
        }
        console.log(`[Settings POST] Cleaned up ${deleteIds.length} duplicate AppSettings rows for userId=${userId}, kept id=${keepId}`);
      }
      if (rows.length > 0) {
        const targetId = rows[0].id;
        await conn.execute(
          "UPDATE AppSettings SET scheduledTime = ?, maxSendLimit = ?, minDelay = ?, maxDelay = ?, n8nWebhookUrl = ?, notionSecret = ?, notionDatabaseId = ?, notionSyncWebhookUrl = ?, n8nAiRewriteWebhookUrl = ?, n8nAiAnalyzeWebhookUrl = ?, n8nBindInstanceWebhookUrl = ?, evolutionApiUrl = ?, evolutionApiKey = ?, evolutionWebhookUrl = ?, hubWebhookUrl = ?, hubWebhookToken = ?, whatsappSyncConfig = ?, whatsappSyncTime = ?, whatsappSyncEnabled = ?, whatsappAutoSyncInstances = ?, notificationPhone = ?, aiSpeechToTextEnabled = ?, aiVisionEnabled = ?, aiVisionPrompt = ?, aiRoutingEnabled = ?, aiRoutingConfig = ?, aiNoiseFilterEnabled = ?, globalTimeConfig = ?, globalFilters = ?, groupMonitorEnabled = ?, groupTargetStepId = ?, customHookUrl = ?, updatedAt = ? WHERE id = ?",
          [
            data.scheduledTime || "09:00",
            data.maxSendLimit || 100,
            data.minDelay || 120,
            data.maxDelay || 200,
            data.n8nWebhookUrl || "",
            nextNotionSecret,
            data.notionDatabaseId || "",
            data.notionSyncWebhookUrl || "",
            data.n8nAiRewriteWebhookUrl || "",
            data.n8nAiAnalyzeWebhookUrl || "",
            data.n8nBindInstanceWebhookUrl || "",
            data.evolutionApiUrl || "",
            nextEvolutionApiKey,
            data.evolutionWebhookUrl || "",
            data.hubWebhookUrl || "",
            nextHubWebhookToken,
            data.whatsappSyncConfig || "[]",
            data.whatsappSyncTime || "03:00",
            data.whatsappSyncEnabled ? 1 : 0,
            data.whatsappAutoSyncInstances || "[]",
            data.notificationPhone || "",
            data.aiSpeechToTextEnabled ? 1 : 0,
            data.aiVisionEnabled ? 1 : 0,
            data.aiVisionPrompt || "判断此图是否为支付凭证（水单），如果是请提取金额，如果是其他截图请做简单分类说明。",
            data.aiRoutingEnabled ? 1 : 0,
            data.aiRoutingConfig || "[]",
            data.aiNoiseFilterEnabled ? 1 : 0,
            data.globalTimeConfig || null,
            data.globalFilters || null,
            data.groupMonitorEnabled ? 1 : 0,
            data.groupTargetStepId || null,
            data.customHookUrl || null,
            new Date(),
            targetId
          ]
        );
      } else {
        await conn.execute(
          "INSERT INTO AppSettings (id, userId, scheduledTime, maxSendLimit, minDelay, maxDelay, n8nWebhookUrl, notionSecret, notionDatabaseId, notionSyncWebhookUrl, n8nAiRewriteWebhookUrl, n8nAiAnalyzeWebhookUrl, n8nBindInstanceWebhookUrl, evolutionApiUrl, evolutionApiKey, evolutionWebhookUrl, hubWebhookUrl, hubWebhookToken, whatsappSyncConfig, whatsappSyncTime, whatsappSyncEnabled, whatsappAutoSyncInstances, notificationPhone, aiSpeechToTextEnabled, aiVisionEnabled, aiVisionPrompt, aiRoutingEnabled, aiRoutingConfig, aiNoiseFilterEnabled, globalTimeConfig, globalFilters, groupMonitorEnabled, groupTargetStepId, customHookUrl, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [
            'set_' + Math.random().toString(36).slice(2, 12),
            userId,
            data.scheduledTime || "09:00",
            data.maxSendLimit || 100,
            data.minDelay || 120,
            data.maxDelay || 200,
            data.n8nWebhookUrl || "",
            nextNotionSecret,
            data.notionDatabaseId || "",
            data.notionSyncWebhookUrl || "",
            data.n8nAiRewriteWebhookUrl || "",
            data.n8nAiAnalyzeWebhookUrl || "",
            data.n8nBindInstanceWebhookUrl || "",
            data.evolutionApiUrl || "",
            nextEvolutionApiKey,
            data.evolutionWebhookUrl || "",
            data.hubWebhookUrl || "",
            nextHubWebhookToken,
            data.whatsappSyncConfig || "[]",
            data.whatsappSyncTime || "03:00",
            data.whatsappSyncEnabled ? 1 : 0,
            data.whatsappAutoSyncInstances || "[]",
            data.notificationPhone || "",
            data.aiSpeechToTextEnabled ? 1 : 0,
            data.aiVisionEnabled ? 1 : 0,
            data.aiVisionPrompt || "判断此图是否为支付凭证（水单），如果是请提取金额，如果是其他截图请做简单分类说明。",
            data.aiRoutingEnabled ? 1 : 0,
            data.aiRoutingConfig || "[]",
            data.aiNoiseFilterEnabled ? 1 : 0,
            data.globalTimeConfig || null,
            data.globalFilters || null,
            data.groupMonitorEnabled ? 1 : 0,
            data.groupTargetStepId || null,
            data.customHookUrl || null,
            new Date()
          ]
        );
      }

      // 自动在后台同步该用户下所有实例的 Webhook 地址到 Evolution API
      // 环境变量优先：容器化部署时地址与全局 Key 来自环境，无需在页面里填
      const effectiveApiUrl = (data.evolutionApiUrl || process.env.EVOLUTION_API_URL || "").trim().replace(/\/+$/, "");
      const effectiveApiKey = (nextEvolutionApiKey || process.env.EVOLUTION_API_KEY || "").trim();
      if (data.evolutionWebhookUrl && effectiveApiUrl && effectiveApiKey) {
        const url = effectiveApiUrl;
        const apikey = effectiveApiKey;
        const webhookUrl = (data.evolutionWebhookUrl || "").trim();
        const role = session.user.role?.toUpperCase();
        const isAdmin = role === "ADMIN";

        fetch(`${url}/instance/fetchInstances`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "apikey": apikey
          }
        }).then(async (res) => {
          if (res.ok) {
            const allInstances = await res.json();
            if (Array.isArray(allInstances)) {
              const userPrefix = `usr_${userId}_`;
              for (const item of allInstances) {
                const inst = item.instance ? { ...item.instance, ...item } : item;
                const name = inst.instanceName || inst.name || "";
                const isBelongsToUser = name.startsWith(userPrefix) || (isAdmin && !name.startsWith("usr_"));
                
                if (isBelongsToUser) {
                  fetch(`${url}/webhook/set/${name}`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "apikey": apikey
                    },
                    body: JSON.stringify({
                      enabled: true,
                      url: webhookUrl,
                      webhookByEvents: false,
                      events: ["MESSAGES_UPSERT"],
                      webhook: {
                        enabled: true,
                        url: webhookUrl,
                        webhookByEvents: false,
                        events: ["MESSAGES_UPSERT"]
                      }
                    })
                  }).then(async (setRes) => {
                    if (!setRes.ok) {
                      console.error(`[Settings sync] Failed to set webhook for ${name}: status=${setRes.status}`);
                    } else {
                      console.log(`[Settings sync] Successfully synced webhook for instance: ${name}`);
                    }
                  }).catch(err => console.error(`[Settings sync] Failed to set webhook for ${name}:`, err.message));
                }
              }
            }
          }
        }).catch(err => console.error("[Settings sync] Failed to fetch instances for webhook sync:", err.message));
      }

      return NextResponse.json({ success: true });
    } catch (sqlError: any) {
      return NextResponse.json({ error: sqlError.message }, { status: 500 });
    } finally {
      await conn.end();
    }
  } catch (parseError: any) {
    return NextResponse.json({ error: "Data error" }, { status: 400 });
  }
}
