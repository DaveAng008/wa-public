import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { getInternalToken, matchesEnvToken } from "@/lib/authToken";
import { mediaProxyUrl } from "@/lib/mediaSig";

if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("charset=")) {
  const url = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.includes("?") ? `${url}&charset=utf8mb4` : `${url}?charset=utf8mb4`;
}

export const dynamic = "force-dynamic";

// Global cache to prevent bot auto-reply loops
const sentMessagesCache = (global as any).sentMessagesCache || new Set();
(global as any).sentMessagesCache = sentMessagesCache;

// Global cache for processed message IDs to handle duplicate webhooks / retries
const processedMessagesCache = (global as any).processedMessagesCache || new Set();
(global as any).processedMessagesCache = processedMessagesCache;

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

function interpolateTemplate(template: string, contactInfo: { name: string; phone: string; relation: string; market: string; commandText?: string }) {
  if (!template) return "";
  return template
    .replace(/{name}/g, contactInfo.name || "")
    .replace(/{phone}/g, contactInfo.phone || "")
    .replace(/{relation}/g, contactInfo.relation || "")
    .replace(/{market}/g, contactInfo.market || "")
    .replace(/{commandText}/g, contactInfo.commandText || "");
}

interface CommandMatchResult {
  isMatched: boolean;
  rule: any;
  commandText: string;
}

function matchAdminCommand(messageText: string, rulesJsonStr: string): CommandMatchResult {
  try {
    const rules = JSON.parse(rulesJsonStr || "[]");
    if (!Array.isArray(rules)) return { isMatched: false, rule: null, commandText: "" };
    
    const trimmedMsg = messageText.trim();
    for (const rule of rules) {
      if (rule.enabled === false) continue;
      
      const triggerSender = rule.triggerSender || "client_only";
      if (triggerSender !== "admin_only" && triggerSender !== "both" && triggerSender !== "admin_self") {
        continue;
      }
      
      let keywords: string[] = [];
      const hasLegacyKeyword = rule.conditionType === "keyword" && rule.keyword && (!rule.filters || !Array.isArray(rule.filters) || rule.filters.length === 0);
      if (hasLegacyKeyword) {
        keywords = rule.keyword.split(/[,，]/).map((k: string) => k.trim().toLowerCase()).filter(Boolean);
      } else if (rule.filters && Array.isArray(rule.filters)) {
        const textFilter = rule.filters.find((f: any) => f.field === "messageText");
        if (textFilter && textFilter.value) {
          keywords = textFilter.value.split(/[,，]/).map((k: string) => k.trim().toLowerCase()).filter(Boolean);
        }
      }
      
      if (keywords.length === 0) continue;
      
      const prefix = rule.commandConfig?.prefix || "";
      
      for (const kw of keywords) {
        let commandPattern = "";
        let hasPrefixMatching = false;
        
        if (prefix === "《》") {
          commandPattern = `《${kw}》`;
          if (trimmedMsg.toLowerCase().startsWith(commandPattern.toLowerCase())) {
            hasPrefixMatching = true;
          }
        } else if (prefix) {
          commandPattern = `${prefix}${kw}`;
          if (trimmedMsg.toLowerCase().startsWith(commandPattern.toLowerCase())) {
            hasPrefixMatching = true;
          }
        } else {
          commandPattern = kw;
          if (trimmedMsg.toLowerCase().startsWith(commandPattern.toLowerCase())) {
            hasPrefixMatching = true;
          }
        }
        
        if (hasPrefixMatching) {
          let remainingText = trimmedMsg.substring(commandPattern.length).trim();
          remainingText = remainingText.replace(/^[:：\s]+/, "");
          return {
            isMatched: true,
            rule,
            commandText: remainingText
          };
        }
      }
    }
  } catch (e) {
    console.error("Error matching admin command:", e);
  }
  return { isMatched: false, rule: null, commandText: "" };
}

async function recallMessage(configUrl: string, configApiKey: string, instanceName: string, remoteJid: string, messageId: string) {
  try {
    const url = `${configUrl.replace(/\/$/, "")}/message/delete/${instanceName}`;
    console.log(`[AI Pipeline] Recalling message ${messageId} via Evolution API...`);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": configApiKey
      },
      body: JSON.stringify({
        key: {
          remoteJid,
          fromMe: true,
          id: messageId
        }
      })
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[AI Pipeline] Failed to recall message: status=${res.status}, error=${text}`);
    } else {
      console.log(`[AI Pipeline] Message ${messageId} recalled successfully.`);
    }
  } catch (e: any) {
    console.error(`[AI Pipeline] Error recalling message:`, e.message);
  }
}

export async function POST(req: NextRequest) {
  // 1. 安全令牌校验（Header 优先，兼容 Query 传参）
  //    没有配置 WEBHOOK_TOKEN 时一律拒绝；携带的令牌不匹配也一律拒绝。
  const token = req.headers.get("X-Webhook-Token") || req.nextUrl.searchParams.get("token");
  const expectedToken = (process.env.WEBHOOK_TOKEN || "").trim();

  if (!expectedToken) {
    console.error("[WEBHOOK] 拒绝请求：环境变量 WEBHOOK_TOKEN 未配置");
    return NextResponse.json({ error: "Webhook token not configured on server" }, { status: 500 });
  }
  if (!matchesEnvToken(token, "WEBHOOK_TOKEN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { event, instance, data, sender } = body;

    let ownerPhone = "";
    if (sender && typeof sender === "string") {
      ownerPhone = sender.split("@")[0].replace(/\D/g, "");
    }
    if (!ownerPhone && instance && typeof instance === "string") {
      const match = instance.match(/^usr_(cmc[a-zA-Z0-9]+)_(.+)$/i);
      if (match) {
        const cleanInstanceName = match[2].replace(/\D/g, "");
        if (cleanInstanceName.length >= 8) {
          ownerPhone = cleanInstanceName;
        }
      }
    }

    // 🔍 最早期诊断日志 - 确认 webhook 有没有到达服务器
    console.log(`[WEBHOOK RECEIVED] event=${event} instance=${instance} fromMe=${data?.key?.fromMe} remoteJid=${data?.key?.remoteJid} messageText=${data?.message?.conversation || data?.message?.extendedTextMessage?.text || "(non-text)"}`);

    // 我们只关心新来信事件 messages.upsert 且要求数据格式正确
    if (event !== "messages.upsert" || !data || !data.key) {
      return NextResponse.json({ success: true, message: "Ignored event type or empty data" });
    }

    const messageId = data.key.id || "";
    if (messageId && sentMessagesCache.has(messageId)) {
      console.log(`[WEBHOOK] Ignored message ${messageId} as it was sent by our own bot auto-reply.`);
      sentMessagesCache.delete(messageId);
      return NextResponse.json({ success: true, message: "Ignored bot-sent message" });
    }

    if (messageId) {
      if (processedMessagesCache.has(messageId)) {
        console.log(`[WEBHOOK] Ignored duplicate/retried message ${messageId} (deduplication).`);
        return NextResponse.json({ success: true, message: "Duplicate message ignored" });
      }
      processedMessagesCache.add(messageId);
      
      // Limit cache size
      if (processedMessagesCache.size > 2000) {
        const firstItem = processedMessagesCache.values().next().value;
        processedMessagesCache.delete(firstItem);
      }
    }

    const remoteJid = data.key.remoteJid || "";
    const isPrivate = remoteJid.endsWith("@s.whatsapp.net") || remoteJid.endsWith("@c.us") || remoteJid.endsWith("@lid");
    const isGroup = remoteJid.endsWith("@g.us");

    // 既不是私聊也不是群聊消息，则过滤忽略
    if (!isPrivate && !isGroup) {
      return NextResponse.json({ success: true, message: "Not a private or group chat message" });
    }

    // 解析商户/租户 ID (userId)
    let userId = "";
    if (instance) {
      const match = instance.match(/^usr_(cmc[a-zA-Z0-9]+)_(.+)$/i);
      if (match) {
        userId = match[1];
      }
    }

    const rawId = remoteJid.split("@")[0];
    const cleanPhone = isGroup 
      ? `${rawId.replace(/\D/g, "")}@g.us` 
      : (remoteJid.endsWith("@lid") ? `${rawId.replace(/\D/g, "")}@lid` : rawId.replace(/\D/g, ""));
    if (!cleanPhone) {
      return NextResponse.json({ error: "Invalid clean phone/group ID" }, { status: 400 });
    }

    const pushName = data.pushName || "";
    
    // 提取消息文本内容
    let messageText = "";
    if (data.message) {
      if (data.message.conversation) {
        messageText = data.message.conversation;
      } else if (data.message.extendedTextMessage?.text) {
        messageText = data.message.extendedTextMessage.text;
      } else if (data.message.imageMessage?.caption) {
        messageText = `[图片] ${data.message.imageMessage.caption}`;
      } else if (data.message.videoMessage?.caption) {
        messageText = `[视频] ${data.message.videoMessage.caption}`;
      } else if (data.message.audioMessage) {
        messageText = "[语音消息]";
      } else if (data.message.documentMessage) {
        messageText = "[文件]";
      } else {
        messageText = "[媒体消息]";
      }
    }

    const conn = await getConn();
    try {
      // 💡 进信路由兜底方案：如果不是通过系统平台绑定的前缀实例，尝试从数据库 InstanceConfig 映射关系中查出其归属的 userId
      if (!userId && instance) {
        const [configs]: any = await conn.execute(
          "SELECT userId FROM InstanceConfig WHERE instanceName = ? LIMIT 1",
          [instance]
        );
        if (configs[0]) {
          userId = configs[0].userId;
        }
      }

      if (!userId) {
        return NextResponse.json({ error: "Cannot parse userId from instance name" }, { status: 400 });
      }

      // 2. 验证租户用户是否存在
      const [users]: any = await conn.execute(
        "SELECT id FROM User WHERE id = ? LIMIT 1",
        [userId]
      );
      if (users.length === 0) {
        return NextResponse.json({ error: "User (userId) not found" }, { status: 404 });
      }

      // 2.0.5 黑名单检查：如果发送方或整个聊天会在黑名单中，则直接拦截并静默忽略
      const chatPhoneNoSuffix = cleanPhone.split("@")[0].replace(/\D/g, "");
      const senderPhoneNoSuffix = (data.key.participant || data.participant || "").split("@")[0].replace(/\D/g, "");
      
      const [blacklistEntries]: any = await conn.execute(
        `SELECT id FROM Blacklist 
         WHERE userId = ? 
         AND (phone = ? OR phone = ? OR (phone = ? AND ? != '') OR (phone = ? AND ? != '')) 
         LIMIT 1`,
        [
          userId, 
          cleanPhone, 
          chatPhoneNoSuffix, 
          senderPhoneNoSuffix, 
          senderPhoneNoSuffix,
          (data.key.participant || data.participant || ""),
          (data.key.participant || data.participant || "")
        ]
      );

      if (blacklistEntries.length > 0) {
        console.log(`[WEBHOOK IGNORED] Message from ${cleanPhone} (sender: ${data.key.participant || "private"}) is blacklisted.`);
        return NextResponse.json({ success: true, message: "Ignored blacklisted sender/chat" });
      }

      // 2.1 查询并校验实例控制策略
      const [instConfigs]: any = await conn.execute(
        "SELECT allowKanban, allowHub FROM InstanceConfig WHERE instanceName = ? AND userId = ? LIMIT 1",
        [instance || "", userId]
      );
      
      const allowKanban = instConfigs[0] ? (instConfigs[0].allowKanban == 1 || instConfigs[0].allowKanban === true) : true;
      const allowHub = instConfigs[0] ? (instConfigs[0].allowHub == 1 || instConfigs[0].allowHub === true) : true;

      // 如果两个都不允许，直接返回忽略
      if (!allowKanban && !allowHub) {
        return NextResponse.json({ success: true, message: "Ignored by InstanceConfig rules" });
      }

      // 2.2 查询租户用户设置（ORDER BY updatedAt DESC 确保取最新的完整设置行，避免取到骨架行）
      const [settings]: any = await conn.execute(
        "SELECT n8nWebhookUrl, hubWebhookUrl, hubWebhookToken, evolutionApiUrl, evolutionApiKey, whatsappSyncConfig, notificationPhone, aiSpeechToTextEnabled, aiVisionEnabled, aiVisionPrompt, aiRoutingEnabled, aiRoutingConfig, aiNoiseFilterEnabled, globalTimeConfig, globalFilters, groupMonitorEnabled, groupTargetStepId, customHookUrl FROM AppSettings WHERE userId = ? ORDER BY updatedAt DESC LIMIT 1",
        [userId]
      );
      const appSettings = settings[0] || {};
      
      // 2.3 如果是群聊消息，且开启群聊监控，则拦截过滤
      const groupMonitorEnabled = appSettings.groupMonitorEnabled == 1 || appSettings.groupMonitorEnabled === true;
      if (isGroup && !groupMonitorEnabled) {
        return NextResponse.json({ success: true, message: "Group chat messages ignored as group monitoring is disabled" });
      }

      const syncRulesStr = appSettings.whatsappSyncConfig || "[]";

      const aiRoutingConfig = appSettings.aiRoutingConfig || "[]";
      const aiRoutingEnabled = appSettings.aiRoutingEnabled == 1 || appSettings.aiRoutingEnabled === true;

      let hasAdminTriggerRule = false;
      try {
        const rules = JSON.parse(aiRoutingConfig || "[]");
        if (Array.isArray(rules)) {
          hasAdminTriggerRule = rules.some((r: any) => 
            r.enabled !== false && 
            (r.triggerSender === "admin_only" || r.triggerSender === "both" || r.triggerSender === "admin_self")
          );
        }
      } catch (e) {}
      
      let matchedAdminCmd = { isMatched: false, rule: null, commandText: "" };
      if (data.key.fromMe === true && aiRoutingEnabled) {
        matchedAdminCmd = matchAdminCommand(messageText, aiRoutingConfig);
      }

      // 如果是自己发出的群聊消息，但并未匹配管理员指令，且系统里没有任何规则允许管理员触发，则过滤忽略
      if (data.key.fromMe === true && isGroup && !matchedAdminCmd.isMatched && !hasAdminTriggerRule) {
        return NextResponse.json({ success: true, message: "Ignored self-sent group message (not an admin command)" });
      }

      // 匹配前缀并寻找 market 市场和 notify 规则
      let market = "";
      let matchedRule: any = null;
      try {
        const rules = JSON.parse(syncRulesStr);
        if (Array.isArray(rules)) {
          matchedRule = rules.find((r: any) => cleanPhone.startsWith(r.prefix));
          if (matchedRule) {
            market = matchedRule.market || "";
          }
        }
      } catch (e) {
        console.error("Failed to parse whatsappSyncConfig:", e);
      }

      // 如果是自己发出的，用 [我]: 标示；如果是群聊，用发送者姓名标示
      const displayMessage = data.key.fromMe === true
        ? `[我]: ${messageText}`
        : (isGroup ? `[${pushName || "群成员"}]: ${messageText}` : messageText);

      // 如果是自己发出的，由于是发给联系人，contactName 应该为 cleanPhone（不能用我自己的 pushName）
      let contactName = isGroup 
        ? `群聊: 尾号${cleanPhone.split("@")[0].slice(-4)}`
        : (pushName && data.key.fromMe !== true ? pushName.trim() : cleanPhone);

      let contactId = "";
      let isNewCreated = false;

      if (allowKanban) {
        // 3. 查重：判断该顾客/群聊记录是否已建立
        const [existingContacts]: any = await conn.execute(
          "SELECT id, stepId, note, name, market FROM Contact WHERE phone = ? AND userId = ? LIMIT 1",
          [cleanPhone, userId]
        );

        if (existingContacts[0]) {
          // --- 存在卡片：更新备注聊天记录与排序置顶 ---
          contactId = existingContacts[0].id;
          if (existingContacts[0].name && existingContacts[0].name.trim()) {
            contactName = existingContacts[0].name.trim();
          }
          if (existingContacts[0].market && existingContacts[0].market.trim()) {
            market = existingContacts[0].market.trim();
          }
          let currentStepId = existingContacts[0].stepId;
          if (!currentStepId) {
            // 如果 stepId 为空，自动归属到第一列阶段列
            const [steps]: any = await conn.execute(
              "SELECT id FROM ContactStep WHERE userId = ? ORDER BY orderIndex ASC LIMIT 1",
              [userId]
            );
            if (steps[0]) {
              currentStepId = steps[0].id;
            }
          }
          const existingNote = existingContacts[0].note || "";

          let newNote = existingNote;
          if (displayMessage && !matchedAdminCmd.isMatched) {
            const now = new Date();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            const timestamp = `${mm}-${dd} ${hh}:${min}`;
            const newMsgLine = `[${timestamp}] ${displayMessage}`;

            if (existingNote) {
              const oldLines = existingNote.split(/\r?\n/).filter((line: string) => line.trim() !== "");
              const chatLineRegex = /^\[\d{2}-\d{2}\s+\d{2}:\d{2}\]/;
              const chatLines = oldLines.filter((line: string) => chatLineRegex.test(line));
              const manualLines = oldLines.filter((line: string) => !chatLineRegex.test(line));
              
              // 合并并保留最近 5 条聊天
              const mergedChatLines = [newMsgLine, ...chatLines].slice(0, 5);
              newNote = [...mergedChatLines, ...manualLines].join("\n");
            } else {
              newNote = newMsgLine;
            }
          }

          // 置顶排序逻辑：获取当前看板列中最小的 orderIndex 并减去 100
          const [minOrderRows]: any = await conn.execute(
            "SELECT MIN(orderIndex) as minOrder FROM Contact WHERE stepId = ? AND userId = ?",
            [currentStepId, userId]
          );
          let newOrder = 0;
          if (minOrderRows[0] && minOrderRows[0].minOrder !== null) {
            newOrder = Number(minOrderRows[0].minOrder) - 100;
          }

          const respondedValue = data.key.fromMe === true ? "responded" : "1";

          await conn.execute(
            `UPDATE Contact SET note = ?, stepId = ?, lastActivityAt = NOW(), responded = ${respondedValue}, orderIndex = ?, updatedAt = NOW() WHERE id = ? AND userId = ?`,
            [newNote, currentStepId, newOrder, contactId, userId]
          );
        } else {
          // --- 不存在卡片：新建客户/群聊卡片 ---
          let targetStepId = null;

          if (isGroup) {
            // 💡 群聊特殊流向：如果设定了专属看板列，则使用设置；否则前往“社群跟进”
            let targetFound = false;
            if (appSettings.groupTargetStepId) {
              const [customSteps]: any = await conn.execute(
                "SELECT id FROM ContactStep WHERE id = ? AND userId = ? LIMIT 1",
                [appSettings.groupTargetStepId, userId]
              );
              if (customSteps[0]) {
                targetStepId = customSteps[0].id;
                targetFound = true;
              }
            }

            if (!targetFound) {
              const [steps]: any = await conn.execute(
                "SELECT id FROM ContactStep WHERE name = ? AND userId = ? LIMIT 1",
                ["社群跟进", userId]
              );

              if (steps[0]) {
                targetStepId = steps[0].id;
              } else {
                // 如果“社群跟进”阶段列不存在，则为该用户自动生成在最右侧
                const newStepId = "step_" + Math.random().toString(36).slice(2, 22);
                const [maxOrderRows]: any = await conn.execute(
                  "SELECT MAX(orderIndex) as maxOrder FROM ContactStep WHERE userId = ?",
                  [userId]
                );
                const nextOrder = maxOrderRows[0] && maxOrderRows[0].maxOrder !== null 
                  ? Number(maxOrderRows[0].maxOrder) + 1.0 
                  : 1.0;

                await conn.execute(
                  "INSERT INTO ContactStep (id, name, color, orderIndex, userId) VALUES (?, ?, ?, ?, ?)",
                  [newStepId, "社群跟进", "#8b5cf6", nextOrder, userId]
                );
                targetStepId = newStepId;
              }
            }
          } else {
            // 私聊去往第一列阶段列 (如“新线索”)
            const [steps]: any = await conn.execute(
              "SELECT id FROM ContactStep WHERE userId = ? ORDER BY orderIndex ASC LIMIT 1",
              [userId]
            );

            if (steps[0]) {
              targetStepId = steps[0].id;
            } else {
              const defaultStepId = "step_" + Math.random().toString(36).slice(2, 22);
              await conn.execute(
                "INSERT INTO ContactStep (id, name, color, orderIndex, userId) VALUES (?, ?, ?, ?, ?)",
                [defaultStepId, "新线索", "#3b82f6", 1.0, userId]
              );
              targetStepId = defaultStepId;
            }
          }

          // 卡片置顶：获取目标阶段列中最小的 orderIndex 并减去 100
          const [minOrderRows]: any = await conn.execute(
            "SELECT MIN(orderIndex) as minOrder FROM Contact WHERE stepId = ? AND userId = ?",
            [targetStepId, userId]
          );
          let newOrder = 0;
          if (minOrderRows[0] && minOrderRows[0].minOrder !== null) {
            newOrder = Number(minOrderRows[0].minOrder) - 100;
          }

          const newContactId = "ct_" + Math.random().toString(36).slice(2, 22);
          contactId = newContactId;

          const properties = JSON.stringify({
            sourceInstance: instance || "Webhook",
            incomingType: "EvolutionAPI",
            remoteJid: remoteJid
          });

          let initialNote = null;
          if (displayMessage && !matchedAdminCmd.isMatched) {
            const now = new Date();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            const timestamp = `${mm}-${dd} ${hh}:${min}`;
            initialNote = `[${timestamp}] ${displayMessage}`;
          }

          const defaultRelation = isGroup ? '["群聊名单"]' : '["新名单"]';

          const initialResponded = data.key.fromMe === true ? 0 : 1;

          await conn.execute(
            "INSERT INTO Contact (id, name, phone, market, stepId, note, lastActivityAt, responded, orderIndex, userId, sourceId, relation, properties) VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, 'evolution', ?, ?)",
            [newContactId, contactName, cleanPhone, market, targetStepId, initialNote, initialResponded, newOrder, userId, defaultRelation, properties]
          );
          isNewCreated = true;

          // 触发管理员新粉通知
          if (data.key.fromMe === false && !isGroup) {
            const notifyPhone = appSettings.notificationPhone;
            const configUrl = appSettings.evolutionApiUrl;
            const configApiKey = appSettings.evolutionApiKey;

            if (notifyPhone && configUrl && configApiKey && matchedRule && matchedRule.notify && matchedRule.template) {
              try {
                const now = new Date();
                const yyyy = now.getFullYear();
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const dd = String(now.getDate()).padStart(2, '0');
                const hh = String(now.getHours()).padStart(2, '0');
                const min = String(now.getMinutes()).padStart(2, '0');
                const dateStr = `${yyyy}-${mm}-${dd}`;
                const timeStr = `${hh}:${min}`;

                const notifyText = matchedRule.template
                  .replace(/{name}/g, contactName)
                  .replace(/{phone}/g, cleanPhone)
                  .replace(/{market}/g, market)
                  .replace(/{date}/g, dateStr)
                  .replace(/{time}/g, timeStr)
                  .replace(/{message}/g, messageText || "");

                fetch(`${configUrl}/message/sendText/${instance}`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "apikey": configApiKey
                  },
                  body: JSON.stringify({
                    number: notifyPhone,
                    text: notifyText
                  })
                }).then(async (sendRes) => {
                  if (!sendRes.ok) {
                    const errBody = await sendRes.text();
                    console.error(`Evolution API notification failed: ${sendRes.status} - ${errBody}`);
                  }
                }).catch(err => {
                  console.error("Failed to send Evolution notification:", err.message);
                });
              } catch (notifyErr: any) {
                console.error("Failed to trigger notification flow:", notifyErr.message);
              }
            }
          }
        }
      } // allowKanban closure

      // 3.5 触发 AI 分析与智能路由 (后台异步执行，不阻塞 Webhook 响应)
      // 🔧 关键修复：当 allowKanban=false 时 contactId 在上面的代码块里不会被赋值。
      // 这里补加一个只读查询，确保自动规则引擎独立于看板写入权限运行。
      if (!contactId) {
        const aiRoutingEnabledCheck = appSettings.aiRoutingEnabled == 1 || appSettings.aiRoutingEnabled === true;
        if (aiRoutingEnabledCheck && (!data.key.fromMe || matchedAdminCmd.isMatched || hasAdminTriggerRule)) {
          try {
            const [fallbackContact]: any = await conn.execute(
              "SELECT id FROM Contact WHERE phone = ? AND userId = ? LIMIT 1",
              [cleanPhone, userId]
            );
            if (fallbackContact[0]) {
              contactId = fallbackContact[0].id;
              console.log(`[Webhook] allowKanban=false but aiRoutingEnabled: found existing contactId=${contactId} via fallback lookup`);
            }
          } catch (e: any) {
            console.error("[Webhook] Fallback contactId lookup failed:", e.message);
          }
        }
      }

      if (contactId) {
        const hasAudio = !!data.message?.audioMessage;
        const hasImage = !!data.message?.imageMessage;
        const aiSpeechToTextEnabled = appSettings.aiSpeechToTextEnabled == 1 || appSettings.aiSpeechToTextEnabled === true;
        const aiVisionEnabled = appSettings.aiVisionEnabled == 1 || appSettings.aiVisionEnabled === true;
        const aiRoutingEnabled = appSettings.aiRoutingEnabled == 1 || appSettings.aiRoutingEnabled === true;
        
        if ((hasAudio && aiSpeechToTextEnabled) || (hasImage && aiVisionEnabled) || aiRoutingEnabled) {
          // 查询 API Key 与自动规则权限
          let apiKeys = {} as any;
          let isAuthorized = true;
          try {
            const [userRows]: any = await conn.execute("SELECT role, apiKeys, automationsEnabled FROM User WHERE id = ? LIMIT 1", [userId]);
            if (userRows[0]) {
              const uRole = userRows[0].role?.toUpperCase();
              const uAutomationsEnabled = !!userRows[0].automationsEnabled;
              if (uRole !== "ADMIN" && !uAutomationsEnabled) {
                isAuthorized = false;
              }
              if (userRows[0].apiKeys) {
                apiKeys = typeof userRows[0].apiKeys === "string" ? JSON.parse(userRows[0].apiKeys) : userRows[0].apiKeys;
              }
            }
          } catch (e) {
            console.error("Failed to query user apiKeys and permissions for AI routing:", e);
          }

          if (!isAuthorized) {
            console.log(`[Webhook] User ${userId} does not have automatic rules permission (automationsEnabled = 0), bypassing AI routing.`);
          } else {
            // ✅ 关键修复：改为 await 同步执行，确保在容器环境中管道不被中途终止
            // Evolution API 超时通常为 30 秒，足够执行完整个管道
            try {
            await processMessageAiAndRouting({
              userId,
              contactId,
              messageId: data.key.id,
              messageText,
              data,
              isGroup,
              cleanPhone,
              contactName,
              market,
              instance: instance || "",
              configUrl: (appSettings.evolutionApiUrl || "").replace(/\/$/, ""), // 去掉末尾斜杠避免双斜杠问题
              configApiKey: appSettings.evolutionApiKey || "",
              aiKeys: apiKeys,
              aiSpeechToTextEnabled,
              aiVisionEnabled,
              aiVisionPrompt: appSettings.aiVisionPrompt || "",
              aiRoutingEnabled,
              aiRoutingConfig: appSettings.aiRoutingConfig || "[]",
              aiNoiseFilterEnabled: appSettings.aiNoiseFilterEnabled == 1 || appSettings.aiNoiseFilterEnabled === true,
              isNewCreated,
              senderJid: data.key.participant || data.participant || (isPrivate ? remoteJid : ""),
              pushName: data.pushName || "",
              globalTimeConfig: appSettings.globalTimeConfig || null,
              globalFilters: appSettings.globalFilters || null,
              matchedAdminCmd,
              ownerPhone
            });
          } catch (err: any) {
            console.error("AI pipeline execution error:", err.message);
          }
        }
      }
      }

      // 4. Hook 出口：非阻塞异步触发 N8N 联动 (Fire-and-Forget)
      if (appSettings) {
        // 4.1 触发 N8N Webhook 联动
        if (appSettings.n8nWebhookUrl) {
          const n8nUrl = appSettings.n8nWebhookUrl;
          if (n8nUrl.startsWith("http")) {
            fetch(n8nUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            }).catch(err => {
              console.error("Failed to forward webhook to N8N:", err.message);
            });
          }
        }

        // 4.2 直连推送最新 Hub Webhook (方案 B)
        if (allowHub && appSettings.hubWebhookUrl) {
          const hubUrl = appSettings.hubWebhookUrl;
          if (hubUrl.startsWith("http")) {
            const hubPayload = {
              event: "messages.upsert",
              userId: userId,
              phone: cleanPhone,
              name: contactName,
              message: messageText,
              instance: instance || "Webhook",
              isGroup: isGroup,
              token: appSettings.hubWebhookToken || null,
              timestamp: new Date().toISOString()
            };

            fetch(hubUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(appSettings.hubWebhookToken ? { "X-Hub-Token": appSettings.hubWebhookToken } : {})
              },
              body: JSON.stringify(hubPayload)
            }).catch(err => {
              console.error("Failed to forward webhook to Hub:", err.message);
            });
          }
        }

        // 4.3 触发自定义 Hook 出口 Webhook 链接
        if (appSettings.customHookUrl) {
          const customUrl = appSettings.customHookUrl;
          if (customUrl.startsWith("http")) {
            const customPayload = {
              event: "messages.upsert",
              userId: userId,
              phone: cleanPhone,
              name: contactName,
              message: messageText,
              instance: instance || "Webhook",
              isGroup: isGroup,
              timestamp: new Date().toISOString(),
              raw: data
            };

            fetch(customUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify(customPayload)
            }).catch(err => {
              console.error("Failed to forward webhook to custom hook:", err.message);
            });
          }
        }
      }

      return NextResponse.json({
        success: true,
        contactId,
        isGroup,
        instance,
        userId,
        aiRoutingEnabled: appSettings?.aiRoutingEnabled,
        aiRoutingConfigLen: appSettings?.aiRoutingConfig?.length || 0,
        message: "Message processed successfully."
      });

    } finally {
      await conn.end();
    }

  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function processMessageAiAndRouting(params: {
  userId: string;
  contactId: string;
  messageId: string;
  messageText: string;
  data: any;
  isGroup: boolean;
  cleanPhone: string;
  contactName: string;
  market: string;
  instance: string;
  configUrl: string;
  configApiKey: string;
  aiKeys: any;
  aiSpeechToTextEnabled: boolean;
  aiVisionEnabled: boolean;
  aiVisionPrompt: string;
  aiRoutingEnabled: boolean;
  aiRoutingConfig: string;
  aiNoiseFilterEnabled: boolean;
  isNewCreated: boolean;
  senderJid: string;
  pushName: string;
  globalTimeConfig?: string | null;
  globalFilters?: string | null;
  matchedAdminCmd: { isMatched: boolean; rule: any; commandText: string };
  ownerPhone?: string;
}) {
  const openaiKey = params.aiKeys?.openai;
  let finalMessageText = params.messageText;
  let isAiProcessed = false;

  console.log(`[AI Pipeline] Starting pipeline for contactId=${params.contactId}, phone=${params.cleanPhone}, messageText="${params.messageText}", aiRoutingEnabled=${params.aiRoutingEnabled}`);

  // 1. 语音转文字 (OpenAI Whisper)
  if (params.data.message?.audioMessage && params.aiSpeechToTextEnabled) {
    if (!openaiKey) {
      console.log("[AI Pipeline] Skipped audio transcription: OpenAI API Key is missing.");
    } else {
      try {
        console.log(`[AI Pipeline] Downloading audio message ${params.messageId} from Evolution API...`);
        const mediaRes = await fetch(`${params.configUrl}/chat/getBase64FromMediaMessage/${params.instance}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": params.configApiKey
          },
          body: JSON.stringify({
            message: {
              key: {
                id: params.messageId
              }
            }
          })
        });
        if (mediaRes.ok) {
          const mediaData = await mediaRes.json();
          if (mediaData.base64) {
            console.log("[AI Pipeline] Audio downloaded. Transcribing via Whisper API...");
            const buffer = Buffer.from(mediaData.base64, "base64");
            const mimetype = mediaData.mimetype || "audio/ogg";
            const formData = new FormData();
            const blob = new Blob([buffer], { type: mimetype });
            formData.append("file", blob, `audio.${mimetype.split("/")[1] || "ogg"}`);
            formData.append("model", "whisper-1");

            const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${openaiKey}`
              },
              body: formData
            });
            if (whisperRes.ok) {
              const whisperData = await whisperRes.json();
              if (whisperData.text) {
                finalMessageText = `🎤 [语音转译]: ${whisperData.text}`;
                isAiProcessed = true;
                console.log(`[AI Pipeline] Whisper success: "${whisperData.text}"`);
              }
            } else {
              console.error("[AI Pipeline] Whisper API failed:", whisperRes.status, await whisperRes.text());
            }
          }
        } else {
          console.error("[AI Pipeline] Failed to download audio from Evolution API:", mediaRes.status, await mediaRes.text());
        }
      } catch (e: any) {
        console.error("[AI Pipeline] Whisper error:", e.message);
      }
    }
  }

  // 2. 图片智能解读 (GPT-4o-mini Vision)
  if (params.data.message?.imageMessage && params.aiVisionEnabled) {
    if (!openaiKey) {
      console.log("[AI Pipeline] Skipped image analysis: OpenAI API Key is missing.");
    } else {
      try {
        console.log(`[AI Pipeline] Downloading image message ${params.messageId} from Evolution API...`);
        const mediaRes = await fetch(`${params.configUrl}/chat/getBase64FromMediaMessage/${params.instance}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": params.configApiKey
          },
          body: JSON.stringify({
            message: {
              key: {
                id: params.messageId
              }
            }
          })
        });
        if (mediaRes.ok) {
          const mediaData = await mediaRes.json();
          if (mediaData.base64) {
            console.log("[AI Pipeline] Image downloaded. Analyzing via GPT-4o-mini Vision...");
            const mimetype = mediaData.mimetype || "image/jpeg";
            const prompt = params.aiVisionPrompt || "判断此图是否为支付凭证（水单），如果是请提取金额，如果是其他截图请做简单分类说明。";
            
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${openaiKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: prompt },
                      {
                        type: "image_url",
                        image_url: {
                          url: `data:${mimetype};base64,${mediaData.base64}`
                        }
                      }
                    ]
                  }
                ],
                max_tokens: 300
              })
            });
            if (response.ok) {
              const completion = await response.json();
              const description = completion.choices[0]?.message?.content;
              if (description) {
                const captionText = params.data.message.imageMessage.caption ? ` (${params.data.message.imageMessage.caption})` : "";
                finalMessageText = `🖼️ [图片解读]: ${description.trim()}${captionText}`;
                isAiProcessed = true;
                console.log(`[AI Pipeline] GPT-4o Vision success: "${description.trim()}"`);
              }
            } else {
              console.error("[AI Pipeline] GPT-4o Vision API failed:", response.status, await response.text());
            }
          }
        } else {
          console.error("[AI Pipeline] Failed to download image from Evolution API:", mediaRes.status, await mediaRes.text());
        }
      } catch (e: any) {
        console.error("[AI Pipeline] Vision API error:", e.message);
      }
    }
  }

  // 4. 更新数据库 Contact 备注和路由规则
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const cleanSenderPhone = params.senderJid ? params.senderJid.split("@")[0].replace(/\D/g, "") : "";
    let memberContact: any = null;
    let isNewSenderCreated = false;

    if (params.isGroup && cleanSenderPhone) {
      const [rows]: any = await conn.execute(
        "SELECT id, stepId, note, relation, priority, market, properties FROM Contact WHERE phone = ? AND userId = ? LIMIT 1",
        [cleanSenderPhone, params.userId]
      );
      if (rows[0]) {
        memberContact = rows[0];
      }
    }

    const getOrEnsureMemberContact = async () => {
      if (memberContact) return memberContact;
      memberContact = await ensureContactExists(conn, params.userId, cleanSenderPhone, {
        instance: params.instance,
        parentGroupJid: params.data.key.remoteJid,
        displayName: params.pushName
      });
      isNewSenderCreated = true;
      return memberContact;
    };

    // 💡 4.0 查找当前联系人最近接收到的群发活动 ID
    let lastCampaignId: string | null = null;
    try {
      const [lastSendLog]: any = await conn.execute(
        "SELECT campaignId FROM SendLog WHERE phone = ? AND userId = ? AND status = 'SENT' ORDER BY sentAt DESC LIMIT 1",
        [params.cleanPhone, params.userId]
      );
      if (lastSendLog[0]) {
        lastCampaignId = lastSendLog[0].campaignId;
      }
    } catch (sendLogErr: any) {
      console.error("[AI Pipeline] Failed to query SendLog:", sendLogErr.message);
    }

    let priorityToSet: string | null = null;
    let stepIdToSet: string | null = null;
    let relationsToSet: string[] | null = null;
    let notesToAppend: string[] = [];

    let activeContactId = params.contactId;
    let activeContactPhone = params.cleanPhone;

    console.log(`[AI Pipeline] Keyword & AI routing check: enabled=${params.aiRoutingEnabled}, configLength=${params.aiRoutingConfig?.length || 0}`);
    if (params.aiRoutingEnabled && params.aiRoutingConfig) {
      try {
        const rules = JSON.parse(params.aiRoutingConfig);
        console.log(`[AI Pipeline] Loaded ${rules?.length || 0} routing rules`);
        if (Array.isArray(rules)) {
          let detectedIntent: string | null = null;
          const textToCheck = finalMessageText.toLowerCase();

          for (const rule of rules) {
            if (rule.enabled === false) continue;

            // --- 0. 适用实例限制校验 (Option A + Option 2 alias mapping) ---
            if (rule.applicableInstances && Array.isArray(rule.applicableInstances) && rule.applicableInstances.length > 0 && !rule.applicableInstances.includes("all")) {
              if (!rule.applicableInstances.includes(params.instance)) {
                console.log(`[AI Pipeline] Rule "${rule.name}" is restricted to instances: ${JSON.stringify(rule.applicableInstances)}. Incoming instance "${params.instance}" does not match. Bypassing.`);
                continue;
              }
            }

            const triggerSender = rule.triggerSender || "client_only";
            const isFromMe = params.data.key.fromMe === true;
            const isSelfChat = isFromMe && (params.ownerPhone ? (params.cleanPhone === params.ownerPhone) : (cleanSenderPhone && cleanSenderPhone === params.cleanPhone));

            let triggerSenderMatches = false;
            if (isFromMe) {
              if (isSelfChat) {
                triggerSenderMatches = (triggerSender === "admin_self");
              } else {
                triggerSenderMatches = (triggerSender === "admin_only" || triggerSender === "both");
              }
            } else {
              triggerSenderMatches = (triggerSender === "client_only" || triggerSender === "both");
            }

            if (!triggerSenderMatches) continue;

            // --- 1. 生效时间段层级校验 (优先局部，局部未启用则继承全局) ---
            let isTimePassed = true;
            if (rule.timeConfig?.enabled) {
              const now = new Date();
              const currentDay = now.getDay();
              const activeDays = rule.timeConfig.days || [];
              if (activeDays.length > 0 && !activeDays.includes(currentDay)) {
                isTimePassed = false;
              } else {
                const currentMinutes = now.getHours() * 60 + now.getMinutes();
                const [sh, sm] = (rule.timeConfig.startTime || "00:00").split(":").map(Number);
                const [eh, em] = (rule.timeConfig.endTime || "23:59").split(":").map(Number);
                const startMinutes = sh * 60 + sm;
                const endMinutes = eh * 60 + em;
                
                let isInRange = false;
                if (startMinutes <= endMinutes) {
                  isInRange = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
                } else {
                  isInRange = currentMinutes >= startMinutes || currentMinutes <= endMinutes;
                }
                if (!isInRange) isTimePassed = false;
              }
            } else {
              if (params.globalTimeConfig) {
                try {
                  const globalTime = typeof params.globalTimeConfig === 'string' ? JSON.parse(params.globalTimeConfig) : params.globalTimeConfig;
                  if (globalTime && globalTime.enabled) {
                    const now = new Date();
                    const currentDay = now.getDay();
                    const activeDays = globalTime.days || [];
                    if (activeDays.length > 0 && !activeDays.includes(currentDay)) {
                      isTimePassed = false;
                    } else {
                      const currentMinutes = now.getHours() * 60 + now.getMinutes();
                      const [sh, sm] = (globalTime.startTime || "00:00").split(":").map(Number);
                      const [eh, em] = (globalTime.endTime || "23:59").split(":").map(Number);
                      const startMinutes = sh * 60 + sm;
                      const endMinutes = eh * 60 + em;
                      
                      let isInRange = false;
                      if (startMinutes <= endMinutes) {
                        isInRange = currentMinutes >= startMinutes && currentMinutes <= endMinutes;
                      } else {
                        isInRange = currentMinutes >= startMinutes || currentMinutes <= endMinutes;
                      }
                      if (!isInRange) isTimePassed = false;
                    }
                  }
                } catch (err) {
                  console.error("[AI Pipeline] Failed to parse globalTimeConfig:", err);
                }
              }
            }
            if (!isTimePassed) continue;

            // --- 2. 过滤器层级校验 (优先局部，局部未配置则继承全局) ---
            let allFiltersPassed = true;
            let filtersToValidate: any[] = [];
            if (rule.filters && Array.isArray(rule.filters) && rule.filters.length > 0) {
              filtersToValidate = rule.filters;
            } else if (params.globalFilters) {
              try {
                const parsedGlobal = typeof params.globalFilters === 'string' ? JSON.parse(params.globalFilters) : params.globalFilters;
                if (Array.isArray(parsedGlobal) && parsedGlobal.length > 0) {
                  filtersToValidate = parsedGlobal;
                }
              } catch (err) {
                console.error("[AI Pipeline] Failed to parse globalFilters:", err);
              }
            }

            if (filtersToValidate.length > 0) {
              for (const filter of filtersToValidate) {
                let subjectContact = null;
                let subjectIsNew = false;
                if (params.isGroup && filter.targetSubject === "group_member") {
                  subjectContact = memberContact;
                  subjectIsNew = isNewSenderCreated;
                } else {
                  const [origRows]: any = await conn.execute(
                    "SELECT id, stepId, note, relation, priority, market, properties FROM Contact WHERE id = ? AND userId = ? LIMIT 1",
                    [params.contactId, params.userId]
                  );
                  subjectContact = origRows[0] || null;
                  subjectIsNew = params.isNewCreated;
                }
                
                let isFilterPassed = false;
                const field = filter.field;
                const op = filter.operator;
                const val = String(filter.value || "").toLowerCase();
                
                if (field === "chatType") {
                  const chatVal = params.isGroup ? "group" : "private";
                  isFilterPassed = (op === "equals" && chatVal === val) || (op === "not_equals" && chatVal !== val);
                } else if (field === "messageType") {
                  let incomingType = "text";
                  if (params.data.message?.imageMessage) incomingType = "image";
                  else if (params.data.message?.audioMessage) incomingType = "audio";
                  else if (params.data.message?.videoMessage) incomingType = "video";
                  else if (params.data.message?.documentMessage) incomingType = "document";
                  
                  isFilterPassed = (op === "equals" && incomingType === val) || (op === "not_equals" && incomingType !== val);
                } else if (field === "phonePrefix") {
                  const phoneToCheck = params.isGroup && filter.targetSubject === "group_member" ? cleanSenderPhone : params.cleanPhone;
                  const starts = phoneToCheck.startsWith(val);
                  isFilterPassed = (op === "starts_with" && starts) || (op === "not_starts_with" && !starts);
                } else if (field === "isNewContact") {
                  const expected = val === "true";
                  isFilterPassed = subjectIsNew === expected;
                } else if (field === "messageText") {
                  const trimmedMsg = finalMessageText.trim().toLowerCase();
                  const kws = val.split(/[,，]/).map((k: string) => k.trim()).filter(Boolean);
                  if (op === "equals") {
                    isFilterPassed = kws.some(kw => trimmedMsg === kw);
                  } else if (op === "not_equals") {
                    isFilterPassed = kws.every(kw => trimmedMsg !== kw);
                  } else if (op === "contains") {
                    isFilterPassed = kws.some(kw => textToCheck.includes(kw));
                  } else if (op === "not_contains") {
                    isFilterPassed = kws.every(kw => !textToCheck.includes(kw));
                  } else if (op === "starts_with") {
                    isFilterPassed = kws.some(kw => trimmedMsg.startsWith(kw));
                  }
                  console.log(`[AI Pipeline Filter] messageText matching: message="${finalMessageText}" (textToCheck="${textToCheck}"), keywords=${JSON.stringify(kws)}, operator=${op}, isPassed=${isFilterPassed}`);
                } else if (field === "aiIntent") {
                  const provider = rule.aiModelProvider || "openai";
                  const key = params.aiKeys?.[provider];
                  if (key) {
                    if (detectedIntent === null) {
                      detectedIntent = await classifyIntentWithAI(params.messageText, provider, key, rule.aiModel);
                    }
                    isFilterPassed = (op === "equals" && detectedIntent === val) || (op === "not_equals" && detectedIntent !== val);
                  } else {
                    console.error("[AI Pipeline] Missing AI key for provider:", provider);
                    isFilterPassed = false;
                  }
                } else if (field === "visionReceipt") {
                  const isReceipt = isAiProcessed && !!params.data.message?.imageMessage && (
                    finalMessageText.toLowerCase().includes("支付凭证") ||
                    finalMessageText.toLowerCase().includes("水单") ||
                    finalMessageText.toLowerCase().includes("凭证") ||
                    finalMessageText.toLowerCase().includes("receipt") ||
                    finalMessageText.toLowerCase().includes("slip") ||
                    finalMessageText.toLowerCase().includes("voucher") ||
                    finalMessageText.toLowerCase().includes("transfer") ||
                    finalMessageText.toLowerCase().includes("proof")
                  );
                  const expected = val === "true" || val === "yes";
                  isFilterPassed = (op === "equals" && isReceipt === expected) || (op === "not_equals" && isReceipt !== expected);
                } else {
                  let contactFieldVal = "";
                  if (subjectContact) {
                    if (field.startsWith("properties.")) {
                      const propKey = field.substring(11);
                      let props: any = {};
                      try {
                        props = typeof subjectContact.properties === 'string' 
                          ? JSON.parse(subjectContact.properties) 
                          : (subjectContact.properties || {});
                      } catch(e) {}
                      contactFieldVal = props[propKey] !== undefined && props[propKey] !== null ? String(props[propKey]) : "";
                    } else {
                      contactFieldVal = String(subjectContact[field] || "");
                    }
                  }
                  if (field === "relation") {
                    let tags: string[] = [];
                    try { tags = JSON.parse(contactFieldVal || "[]"); } catch(e) { tags = []; }
                    const tagLower = tags.map(t => t.toLowerCase());
                    const contains = tagLower.includes(val);
                    if (op === "contains") isFilterPassed = contains;
                    else if (op === "not_contains") isFilterPassed = !contains;
                    else if (op === "is_empty") isFilterPassed = tags.length === 0;
                    else if (op === "is_not_empty") isFilterPassed = tags.length > 0;
                  } else {
                    const matchVal = contactFieldVal.toLowerCase();
                    if (op === "equals") isFilterPassed = matchVal === val;
                    else if (op === "not_equals") isFilterPassed = matchVal !== val;
                    else if (op === "contains") isFilterPassed = matchVal.includes(val);
                    else if (op === "not_contains") isFilterPassed = !matchVal.includes(val);
                    else if (op === "is_empty") isFilterPassed = contactFieldVal === "";
                    else if (op === "is_not_empty") isFilterPassed = contactFieldVal !== "";
                  }
                }
                if (!isFilterPassed) {
                  allFiltersPassed = false;
                  break;
                }
              }
            }
            if (!allFiltersPassed) continue;

            const ruleTriggerType = rule.triggerType || "all";
            if (ruleTriggerType === "campaign") {
              if (!lastCampaignId || (rule.campaignId && rule.campaignId !== "all" && lastCampaignId !== rule.campaignId)) continue;
            }

            let isMatched = false;
            let ruleCommandText = "";

            if (isFromMe) {
              if (params.matchedAdminCmd.isMatched && rule.id === params.matchedAdminCmd.rule.id) {
                isMatched = true;
                ruleCommandText = params.matchedAdminCmd.commandText;
              }
            } else {
              const hasLegacyCondition = rule.conditionType && ["keyword", "ai_intent", "vision_receipt"].includes(rule.conditionType) && (!rule.filters || !Array.isArray(rule.filters) || rule.filters.length === 0);
              if (!hasLegacyCondition) {
                // New unified filter-only rules. Since all filters (which include messageText, etc.) have already passed, we match!
                isMatched = true;
                ruleCommandText = finalMessageText;
              } else {
                // Legacy condition evaluation
                const condType = rule.conditionType || "keyword";
                if (condType === "keyword" && rule.keyword) {
                  const kws = rule.keyword.split(/[,，]/).map((k: string) => k.trim().toLowerCase()).filter(Boolean);
                  const prefix = rule.commandConfig?.prefix || "";
                  const trimmedMsg = finalMessageText.trim();
                  let matchedPrefixKw = false;
                  
                  for (const kw of kws) {
                    let commandPattern = "";
                    let hasPrefixMatching = false;
                    
                    if (prefix === "《》") {
                      commandPattern = `《${kw}》`;
                      if (trimmedMsg.toLowerCase().startsWith(commandPattern.toLowerCase())) {
                        hasPrefixMatching = true;
                      }
                    } else if (prefix) {
                      commandPattern = `${prefix}${kw}`;
                      if (trimmedMsg.toLowerCase().startsWith(commandPattern.toLowerCase())) {
                        hasPrefixMatching = true;
                      }
                    } else {
                      commandPattern = kw;
                      if (trimmedMsg.toLowerCase().startsWith(commandPattern.toLowerCase())) {
                        hasPrefixMatching = true;
                      }
                    }
                    
                    if (hasPrefixMatching) {
                      matchedPrefixKw = true;
                      let remaining = trimmedMsg.substring(commandPattern.length).trim();
                      remaining = remaining.replace(/^[:：\s]+/, "");
                      ruleCommandText = remaining;
                      break;
                    }
                  }
                  
                  if (matchedPrefixKw) {
                    isMatched = true;
                  } else if (!prefix) {
                    isMatched = kws.some((kw: string) => textToCheck.includes(kw));
                    ruleCommandText = finalMessageText;
                  }
                } else if (condType === "ai_intent") {
                  const provider = rule.aiModelProvider || "openai";
                  const key = params.aiKeys?.[provider];
                  if (key) {
                    if (detectedIntent === null) detectedIntent = await classifyIntentWithAI(params.messageText, provider, key, rule.aiModel);
                    isMatched = detectedIntent === rule.aiIntent;
                    ruleCommandText = finalMessageText;
                  }
                } else if (condType === "vision_receipt") {
                  if (isAiProcessed && params.data.message?.imageMessage) {
                    const lowerText = finalMessageText.toLowerCase();
                    isMatched = lowerText.includes("支付凭证") || 
                                lowerText.includes("水单") || 
                                lowerText.includes("凭证") || 
                                lowerText.includes("receipt") || 
                                lowerText.includes("slip") || 
                                lowerText.includes("voucher") || 
                                lowerText.includes("transfer") || 
                                lowerText.includes("proof");
                    ruleCommandText = finalMessageText;
                  }
                }
              }
            }

            let shouldStop = false;
            let actionsToExecute: any[] = [];

            if (isMatched) {
              actionsToExecute = rule.actionsTrue || [];
              shouldStop = true;
            } else {
              if (rule.actionsFalse && Array.isArray(rule.actionsFalse) && rule.actionsFalse.length > 0) {
                actionsToExecute = rule.actionsFalse;
                shouldStop = true;
              }
            }

            if (shouldStop) {
              if (params.isGroup && rule.targetSubject === "group_member") {
                const member = await getOrEnsureMemberContact();
                activeContactId = member.id;
                activeContactPhone = cleanSenderPhone;
              } else {
                activeContactId = params.contactId;
                activeContactPhone = params.cleanPhone;
              }

              const chainStartTime = Date.now();
              let chainSteps: any[] = [];
              if (actionsToExecute.length > 0) {
                chainSteps = await executeActionChain(actionsToExecute, {
                  conn,
                  params,
                  finalMessageText,
                  openaiKey,
                  detectedIntent,
                  matchedRuleName: rule.name || "未命名",
                  cleanSenderPhone,
                  activeContactId,
                  activeContactPhone,
                  getOrEnsureMemberContact,
                  setPriority: (p: string) => { priorityToSet = p; },
                  setStepId: (s: string) => { stepIdToSet = s; },
                  appendNote: (n: string) => { notesToAppend.push(n); },
                  setRelations: (r: string[]) => { relationsToSet = r; },
                  commandText: ruleCommandText,
                  rule
                });
              }
              const chainDuration = Date.now() - chainStartTime;

              // 保存自动规则执行日志 (AutomationLog)
              try {
                let overallStatus = "success";
                if (chainSteps.length > 0) {
                  const hasFailedStep = chainSteps.some(s => s.status === "failed");
                  const hasSuccessStep = chainSteps.some(s => s.status === "success");
                  if (hasFailedStep && hasSuccessStep) {
                    overallStatus = "partial";
                  } else if (hasFailedStep) {
                    overallStatus = "failed";
                  }
                }
                const logId = "al_" + Math.random().toString(36).slice(2, 22);
                await conn.execute(
                  `INSERT INTO AutomationLog (id, userId, contactId, contactName, phone, ruleName, messageText, status, steps, duration, createdAt) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3))`,
                  [
                    logId,
                    params.userId,
                    activeContactId || null,
                    params.contactName || null,
                    activeContactPhone || null,
                    rule.name || "未命名",
                    finalMessageText || null,
                    overallStatus,
                    JSON.stringify(chainSteps),
                    chainDuration
                  ]
                );
                console.log(`[AI Pipeline] AutomationLog ${logId} saved successfully with status ${overallStatus}`);
              } catch (logErr: any) {
                console.error("[AI Pipeline] Failed to write AutomationLog:", logErr.message);
              }
              if (isMatched && rule.commandConfig?.autoRecall && params.data.key.fromMe === true) {
                await recallMessage(
                  params.configUrl,
                  params.configApiKey,
                  params.instance,
                  params.data.key.remoteJid,
                  params.messageId
                );
              }
              break;
            }
          }
        }
      } catch (e) {
        console.error("[AI Pipeline] Failed to process aiRoutingConfig:", e);
      }
    }

    const [existingContacts]: any = await conn.execute(
      "SELECT note, stepId, priority FROM Contact WHERE id = ? AND userId = ? LIMIT 1",
      [activeContactId, params.userId]
    );

    if (existingContacts[0]) {
      const existingNote = existingContacts[0].note || "";
      let currentStepId = stepIdToSet || existingContacts[0].stepId;
      if (!currentStepId) {
        const [steps]: any = await conn.execute(
          "SELECT id FROM ContactStep WHERE userId = ? ORDER BY orderIndex ASC LIMIT 1",
          [params.userId]
        );
        if (steps[0]) currentStepId = steps[0].id;
      }
      const currentPriority = priorityToSet || existingContacts[0].priority || "normal";
      
      let newNote = existingNote;
      if (isAiProcessed) {
        const now = new Date();
        const timestamp = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const displayMessage = params.data.key.fromMe === true ? `[我]: ${finalMessageText}` : (params.isGroup ? `[${params.data.pushName || "群成员"}]: ${finalMessageText}` : finalMessageText);
        const newMsgLine = `[${timestamp}] ${displayMessage}`;
        const oldLines = existingNote.split(/\r?\n/).filter((l: string) => l.trim() !== "");
        const tempSearchKeyword = params.data.message?.audioMessage ? "[语音消息]" : "[图片]";
        const filteredOldLines = oldLines.filter((l: string) => !l.includes(tempSearchKeyword));
        const chatLineRegex = /^\[\d{2}-\d{2}\s+\d{2}:\d{2}\]/;
        newNote = [newMsgLine, ...filteredOldLines.filter((l: string) => chatLineRegex.test(l)).slice(0, 4), ...filteredOldLines.filter((l: string) => !chatLineRegex.test(l))].join("\n");
      }

      for (const logLine of notesToAppend) {
        const oldLines = newNote.split(/\r?\n/).filter((l: string) => l.trim() !== "");
        const chatLineRegex = /^\[\d{2}-\d{2}\s+\d{2}:\d{2}\]/;
        newNote = [logLine, ...oldLines.filter((l: string) => chatLineRegex.test(l)).slice(0, 4), ...oldLines.filter((l: string) => !chatLineRegex.test(l))].join("\n");
      }

      const hasChanges = isAiProcessed || notesToAppend.length > 0 || (stepIdToSet && stepIdToSet !== existingContacts[0].stepId) || (priorityToSet && priorityToSet !== existingContacts[0].priority);

      if (hasChanges || relationsToSet) {
        const [minOrderRows]: any = await conn.execute(
          "SELECT MIN(orderIndex) as minOrder FROM Contact WHERE stepId = ? AND userId = ?",
          [currentStepId, params.userId]
        );
        let newOrder = 0;
        if (minOrderRows[0] && minOrderRows[0].minOrder !== null) {
          newOrder = Number(minOrderRows[0].minOrder) - 100;
        }

        console.log(`[AI Pipeline] Updating DB: stepId=${currentStepId}, priority=${currentPriority}, orderIndex=${newOrder} for contactId=${activeContactId}`);

        if (relationsToSet) {
          await conn.execute(
            "UPDATE Contact SET note = ?, stepId = ?, priority = ?, relation = ?, orderIndex = ?, updatedAt = NOW() WHERE id = ? AND userId = ?",
            [newNote, currentStepId, currentPriority, JSON.stringify(relationsToSet), newOrder, activeContactId, params.userId]
          );
        } else {
          await conn.execute(
            "UPDATE Contact SET note = ?, stepId = ?, priority = ?, orderIndex = ?, updatedAt = NOW() WHERE id = ? AND userId = ?",
            [newNote, currentStepId, currentPriority, newOrder, activeContactId, params.userId]
          );
        }
        console.log(`[AI Pipeline] Contact ${activeContactId} updated in DB successfully.`);
      } else {
        console.log(`[AI Pipeline] No changes detected. Skipping DB update.`);
      }
    }
  } catch (err: any) {
    console.error("[AI Pipeline] Failed to update database:", err.message);
  } finally {
    await conn.end();
  }
}

// 💡 辅助方法：AI 意图判定接口
async function classifyIntentWithAI(messageText: string, provider: string, key: string, model: string): Promise<string | null> {
  const prompt = `你是一个智能客服意图分类器。请分析客户的输入消息，并将其分类为以下三个类别之一：
1. positive (意向客户：想购买、想加盟、询问价格、询问产品详情等)
2. negative (拒绝/退订：不要、不需要、不感兴趣、退订、别发了、投诉等)
3. custom (其它疑问咨询：正常的咨询、问路、确认信息等其它非明显意向或拒绝的内容)

只输出这三个英文单词之一：positive, negative, custom。不要包含任何其他字符或标点符号。

输入消息：
"""
${messageText}
"""`;

  try {
    if (provider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-1.5-flash"}:generateContent?key=${key}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase();
        if (text?.includes("positive")) return "positive";
        if (text?.includes("negative")) return "negative";
        if (text?.includes("custom")) return "custom";
      }
    } else {
      let baseUrl = "https://api.openai.com/v1";
      if (provider === "deepseek") {
        baseUrl = "https://api.deepseek.com/v1";
      }
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model || (provider === "deepseek" ? "deepseek-chat" : "gpt-4o-mini"),
          messages: [{ role: "user", content: prompt }],
          max_tokens: 10,
          temperature: 0
        })
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content?.trim().toLowerCase();
        if (text === "positive" || text === "negative" || text === "custom") {
          return text;
        }
      }
    }
  } catch (e: any) {
    console.error(`[AI Pipeline] classifyIntentWithAI error for ${provider}:`, e.message);
  }
  return null;
}

// 💡 辅助方法：链式动作序列执行引擎 (支持延迟与双向动作链)
async function executeActionChain(
  actions: any[],
  context: {
    conn: any;
    params: any;
    finalMessageText: string;
    openaiKey: string | null;
    detectedIntent: string | null;
    matchedRuleName: string;
    cleanSenderPhone?: string;
    activeContactId?: string;
    activeContactPhone?: string;
    getOrEnsureMemberContact?: () => Promise<any>;
    setPriority: (p: string) => void;
    setStepId: (s: string) => void;
    appendNote: (n: string) => void;
    setRelations: (r: string[]) => void;
    commandText?: string;
    rule?: any;
  }
): Promise<any[]> {
  const {
    conn,
    params,
    finalMessageText,
    detectedIntent,
    cleanSenderPhone,
    activeContactId,
    activeContactPhone,
    getOrEnsureMemberContact,
    setPriority,
    setStepId,
    appendNote,
    setRelations,
    commandText
  } = context;

  const stepsLog: any[] = [];

  for (const action of actions) {
    if (!action || !action.type) continue;
    if (action.enabled === false) {
      console.log(`[AI Pipeline] Action node of type ${action.type} is disabled. Skipping.`);
      continue;
    }

    console.log(`[AI Pipeline] Executing action node: type=${action.type}`);
    const stepStartTime = Date.now();
    let stepStatus: "success" | "failed" = "success";
    let stepDetail = "";
    let shouldAbort = false;

    try {
      switch (action.type) {
        case "condition_branch": {
          console.log(`[AI Pipeline] Evaluating condition_branch action node: id=${action.id}`);
          let isConditionPassed = true;
          
          if (action.filters && Array.isArray(action.filters) && action.filters.length > 0) {
            for (const filter of action.filters) {
              let subjectContact = null;
              let subjectIsNew = false;
              if (params.isGroup && filter.targetSubject === "group_member") {
                if (getOrEnsureMemberContact) {
                  subjectContact = await getOrEnsureMemberContact();
                }
                subjectIsNew = false;
              } else {
                const [origRows]: any = await conn.execute(
                  "SELECT id, stepId, note, relation, priority, market, properties FROM Contact WHERE id = ? AND userId = ? LIMIT 1",
                  [params.contactId, params.userId]
                );
                subjectContact = origRows[0] || null;
                subjectIsNew = params.isNewCreated;
              }

              let isFilterPassed = false;
              const field = filter.field;
              const op = filter.operator;
              const val = String(filter.value || "").toLowerCase();

              if (field === "chatType") {
                const chatVal = params.isGroup ? "group" : "private";
                isFilterPassed = (op === "equals" && chatVal === val) || (op === "not_equals" && chatVal !== val);
              } else if (field === "messageType") {
                let incomingType = "text";
                if (params.data.message?.imageMessage) incomingType = "image";
                else if (params.data.message?.audioMessage) incomingType = "audio";
                else if (params.data.message?.videoMessage) incomingType = "video";
                else if (params.data.message?.documentMessage) incomingType = "document";
                isFilterPassed = (op === "equals" && incomingType === val) || (op === "not_equals" && incomingType !== val);
              } else if (field === "phonePrefix") {
                const phoneToCheck = params.isGroup && filter.targetSubject === "group_member" ? cleanSenderPhone : params.cleanPhone;
                const starts = phoneToCheck.startsWith(val);
                isFilterPassed = (op === "starts_with" && starts) || (op === "not_starts_with" && !starts);
              } else if (field === "isNewContact") {
                const expected = val === "true";
                isFilterPassed = subjectIsNew === expected;
              } else if (field === "messageText") {
                const trimmedMsg = finalMessageText.trim().toLowerCase();
                const kws = val.split(/[,，]/).map((k: string) => k.trim()).filter(Boolean);
                const textToCheck = finalMessageText.toLowerCase();
                if (op === "equals") {
                  isFilterPassed = kws.some(kw => trimmedMsg === kw);
                } else if (op === "not_equals") {
                  isFilterPassed = kws.every(kw => trimmedMsg !== kw);
                } else if (op === "contains") {
                  isFilterPassed = kws.some(kw => textToCheck.includes(kw));
                } else if (op === "not_contains") {
                  isFilterPassed = kws.every(kw => !textToCheck.includes(kw));
                } else if (op === "starts_with") {
                  isFilterPassed = kws.some(kw => trimmedMsg.startsWith(kw));
                }
              } else if (field === "aiIntent") {
                const provider = context.rule?.aiModelProvider || "openai";
                const key = params.aiKeys?.[provider];
                if (key) {
                  let intent = context.detectedIntent;
                  if (intent === null) {
                    intent = await classifyIntentWithAI(params.messageText, provider, key, context.rule?.aiModel);
                  }
                  isFilterPassed = (op === "equals" && intent === val) || (op === "not_equals" && intent !== val);
                } else {
                  console.error("[AI Pipeline] Missing AI key for provider:", provider);
                  isFilterPassed = false;
                }
              } else if (field === "visionReceipt") {
                const isReceipt = !!params.data.message?.imageMessage && (
                  finalMessageText.toLowerCase().includes("支付凭证") ||
                  finalMessageText.toLowerCase().includes("水单") ||
                  finalMessageText.toLowerCase().includes("凭证") ||
                  finalMessageText.toLowerCase().includes("receipt") ||
                  finalMessageText.toLowerCase().includes("slip") ||
                  finalMessageText.toLowerCase().includes("voucher") ||
                  finalMessageText.toLowerCase().includes("transfer") ||
                  finalMessageText.toLowerCase().includes("proof")
                );
                const expected = val === "true" || val === "yes";
                isFilterPassed = (op === "equals" && isReceipt === expected) || (op === "not_equals" && isReceipt !== expected);
              } else {
                let contactFieldVal = "";
                if (subjectContact) {
                  if (field.startsWith("properties.")) {
                    const propKey = field.substring(11);
                    let props: any = {};
                    try {
                      props = typeof subjectContact.properties === 'string' 
                        ? JSON.parse(subjectContact.properties) 
                        : (subjectContact.properties || {});
                    } catch(e) {}
                    contactFieldVal = props[propKey] !== undefined && props[propKey] !== null ? String(props[propKey]) : "";
                  } else {
                    contactFieldVal = String(subjectContact[field] || "");
                  }
                }
                if (field === "relation") {
                  let tags: string[] = [];
                  try { tags = JSON.parse(contactFieldVal || "[]"); } catch(e) { tags = []; }
                  const tagLower = tags.map(t => t.toLowerCase());
                  const contains = tagLower.includes(val);
                  if (op === "contains") isFilterPassed = contains;
                  else if (op === "not_contains") isFilterPassed = !contains;
                  else if (op === "is_empty") isFilterPassed = tags.length === 0;
                  else if (op === "is_not_empty") isFilterPassed = tags.length > 0;
                } else {
                  const matchVal = contactFieldVal.toLowerCase();
                  if (op === "equals") isFilterPassed = matchVal === val;
                  else if (op === "not_equals") isFilterPassed = matchVal !== val;
                  else if (op === "contains") isFilterPassed = matchVal.includes(val);
                  else if (op === "not_contains") isFilterPassed = !matchVal.includes(val);
                  else if (op === "is_empty") isFilterPassed = contactFieldVal === "";
                  else if (op === "is_not_empty") isFilterPassed = contactFieldVal !== "";
                }
              }

              if (!isFilterPassed) {
                isConditionPassed = false;
                break;
              }
            }
          }

          let nestedActionsToExecute = [];
          if (isConditionPassed) {
            nestedActionsToExecute = action.actionsTrue || [];
            stepDetail = "分支判定结果: 符合 (True)";
          } else {
            nestedActionsToExecute = action.actionsFalse || [];
            stepDetail = "分支判定结果: 不符合 (False)";
          }

          if (nestedActionsToExecute.length > 0) {
            console.log(`[AI Pipeline] Executing nested actions for condition_branch (isConditionPassed=${isConditionPassed})`);
            const subStepsLog = await executeActionChain(nestedActionsToExecute, context);
            stepsLog.push(...subStepsLog);
            stepDetail += `, 并执行了 ${subStepsLog.length} 个子节点。`;
          } else {
            stepDetail += ", 无子动作执行。";
          }
          break;
        }

        case "delay": {
          const delaySec = Math.min(Math.max(Number(action.delaySeconds || 5), 1), 300); // 最小 1s，最大 300s
          console.log(`[AI Pipeline] Delaying execution for ${delaySec} seconds...`);
          stepDetail = `延迟等待 ${delaySec} 秒`;
          await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
          break;
        }

        case "kanban_move": {
          if (action.targetStepId) {
            setStepId(action.targetStepId);
            console.log(`[AI Pipeline] Action: Mapped stepId to set: ${action.targetStepId}`);
            let stepName = action.targetStepId;
            try {
              const [stepRows]: any = await conn.execute("SELECT name FROM ContactStep WHERE id = ? LIMIT 1", [action.targetStepId]);
              if (stepRows[0]?.name) stepName = stepRows[0].name;
            } catch {}
            stepDetail = `移至看板阶段: ${stepName}`;
          } else {
            stepDetail = "移至看板阶段: 未指定";
          }
          break;
        }

        case "priority_change": {
          if (action.priority) {
            setPriority(action.priority === "mark_urgent" ? "urgent" : action.priority);
            console.log(`[AI Pipeline] Action: Mapped priority to set: ${action.priority}`);
            const prioMap: Record<string, string> = {
              urgent: "紧急",
              high: "高",
              medium: "中",
              normal: "中",
              low: "低"
            };
            const dispPrio = prioMap[action.priority] || action.priority;
            stepDetail = `修改优先级为: ${dispPrio}`;
          } else {
            stepDetail = "修改优先级: 未指定";
          }
          break;
        }

        case "blacklist": {
          const targetPhone = activeContactPhone || params.cleanPhone;
          console.log(`[AI Pipeline] Action: Blacklisting phone ${targetPhone}`);
          try {
            await conn.execute(
              "INSERT IGNORE INTO Blacklist (id, phone, name, userId, addedById, createdAt) VALUES (?, ?, ?, ?, ?, NOW())",
              [
                "bl_" + Math.random().toString(36).slice(2, 12), 
                targetPhone, 
                params.contactName || null,
                params.userId,
                params.userId
              ]
            );
            stepDetail = `拉黑客户 (号码: ${targetPhone})`;
          } catch (e: any) {
            console.error("[AI Pipeline] Blacklist action failed:", e.message);
            throw e;
          }
          break;
        }

        case "relation_change": {
          const targetId = activeContactId || params.contactId;
          const updates = action.propertyUpdates || [];
          
          if (updates.length > 0) {
            try {
              const [rows]: any = await conn.execute(
                "SELECT relation, properties, note, name, market, priority FROM Contact WHERE id = ? AND userId = ? LIMIT 1",
                [targetId, params.userId]
              );
              if (rows[0]) {
                let currentProps: Record<string, any> = {};
                try {
                  currentProps = typeof rows[0].properties === "string" 
                    ? JSON.parse(rows[0].properties || "{}") 
                    : (rows[0].properties || {});
                } catch (e) {
                  currentProps = {};
                }

                const staticUpdates: Record<string, any> = {};
                let hasStatic = false;
                let hasDynamic = false;

                for (const update of updates) {
                  const field = update.field;
                  let value = update.value;
                  const updateMode = update.updateMode || "overwrite";

                  // Variable interpolation
                  if (typeof value === "string") {
                    value = interpolateTemplate(value, {
                      name: rows[0].name || params.contactName,
                      phone: params.cleanPhone,
                      relation: "",
                      market: rows[0].market || params.market || "",
                      commandText: commandText || ""
                    });
                  }

                  if (["name", "phone", "market", "priority", "note"].includes(field)) {
                    let finalValue = value;
                    const oldValue = rows[0][field] || "";
                    if (updateMode === "prepend" || updateMode === "append") {
                      finalValue = updateMode === "prepend"
                        ? (oldValue ? `${value}\n${oldValue}` : value)
                        : (oldValue ? `${oldValue}\n${value}` : value);
                    }
                    staticUpdates[field] = finalValue;
                    hasStatic = true;
                  } else if (field === "relation") {
                    const tags = value.split(",").map((t: string) => t.trim()).filter(Boolean);
                    setRelations(tags);
                    staticUpdates.relation = JSON.stringify(tags);
                    hasStatic = true;
                  } else {
                    let finalValue = value;
                    const oldValue = currentProps[field] || "";
                    if (updateMode === "prepend" || updateMode === "append") {
                      finalValue = updateMode === "prepend"
                        ? (oldValue ? `${value}\n${oldValue}` : value)
                        : (oldValue ? `${oldValue}\n${value}` : value);
                    }
                    currentProps[field] = finalValue;
                    hasDynamic = true;
                  }
                }

                if (hasStatic) {
                  const sets = Object.keys(staticUpdates).map(k => `\`${k}\` = ?`).join(", ");
                  const values = Object.values(staticUpdates);
                  await conn.execute(
                    `UPDATE Contact SET ${sets}, updatedAt = NOW() WHERE id = ? AND userId = ?`,
                    [...values, targetId, params.userId]
                  );
                  console.log(`[AI Pipeline] Updated contact static fields:`, staticUpdates);
                }

                if (hasDynamic) {
                  await conn.execute(
                    "UPDATE Contact SET properties = ?, updatedAt = NOW() WHERE id = ? AND userId = ?",
                    [JSON.stringify(currentProps), targetId, params.userId]
                  );
                  console.log(`[AI Pipeline] Updated contact properties JSON:`, currentProps);
                }
                const updatedFields = Object.keys(staticUpdates).concat(hasDynamic ? ["properties"] : []).join(", ");
                stepDetail = `更新属性: ${updatedFields}`;
              } else {
                stepDetail = "更新属性失败: 客户记录不存在";
              }
            } catch (e: any) {
              console.error("[AI Pipeline] Failed to update multi properties:", e.message);
              throw e;
            }
          } else if (action.relationTags) {
            const newTags = action.relationTags.split(",").map((t: string) => t.trim()).filter(Boolean);
            if (newTags.length > 0) {
              setRelations(newTags);
              console.log(`[AI Pipeline] Action: Relations tags mapped (compat mode): ${newTags}`);
              stepDetail = `更新标签: ${action.relationTags}`;
            } else {
              stepDetail = "更新标签: 空标签";
            }
          } else {
            stepDetail = "更新属性: 无操作";
          }
          break;
        }

        case "auto_reply": {
          if (action.replyTarget === "private_only" && params.isGroup) {
            console.log(`[AI Pipeline] Skip auto-reply for action type private_only on group message.`);
            stepDetail = "跳过自动回复 (群聊限制私聊规则)";
            break;
          }

          // 查询当前联系人详细信息用于变量插值模板替换
          const targetContactIdForInterp = activeContactId || params.contactId;
          let contactDetails = { name: params.contactName, phone: params.cleanPhone, relation: "", market: params.market || "" };
          try {
            const [contactRows]: any = await conn.execute(
              "SELECT name, phone, relation, market FROM Contact WHERE id = ? AND userId = ? LIMIT 1",
              [targetContactIdForInterp, params.userId]
            );
            if (contactRows[0]) {
              let relStr = "";
              try {
                const parsedRel = JSON.parse(contactRows[0].relation || "[]");
                relStr = Array.isArray(parsedRel) ? parsedRel.join(", ") : String(contactRows[0].relation || "");
              } catch (e) {
                relStr = String(contactRows[0].relation || "");
              }
              contactDetails = {
                name: contactRows[0].name || params.contactName,
                phone: contactRows[0].phone || params.cleanPhone,
                relation: relStr,
                market: contactRows[0].market || params.market || ""
              };
            }
          } catch (dbErr) {
            console.error("[AI Pipeline] Failed to query contact details for template rendering:", dbErr);
          }

          let replyText = action.autoReplyText || "";
          let materialToSend = null;

          if (action.materialId) {
            try {
              const [matRows]: any = await conn.execute(
                "SELECT type, content, url, name FROM Material WHERE id = ? LIMIT 1",
                [action.materialId]
              );
              if (matRows[0]) {
                materialToSend = matRows[0];
              }
            } catch (matErr: any) {
              console.error("[AI Pipeline] Failed to query Material:", matErr.message);
              throw matErr;
            }
          }

          // 如果启用了 AI Q&A 自适应回复
          if (action.aiReplyEnabled) {
            const provider = action.aiReplyProvider || "openai";
            const key = params.aiKeys?.[provider];
            const model = action.aiReplyModel;
            const userPrompt = action.aiReplyPrompt || "解答客户关于产品和价格的问题。";

            if (key) {
              try {
                const interpolatedPrompt = interpolateTemplate(userPrompt, contactDetails);
                const systemPrompt = `你是一个多语言客服助手。请根据客户发来的消息语种，自动用相同的语种进行热情专业的解答。如果对方发马来文，你就用马来文回复；对方发英文，用英文回复；发中文，用中文回复。
公司背景与规则设定如下：
"""
${interpolatedPrompt}
"""`;

                replyText = await generateAiReply(params.messageText, provider, key, model, systemPrompt);
                console.log(`[AI Pipeline] AI generated Q&A reply text: "${replyText}"`);
              } catch (e: any) {
                console.error("[AI Pipeline] AI reply generation failed:", e.message);
                throw e;
              }
            } else {
              throw new Error("AI 自动回复失败: 未配置 AI 密钥");
            }
          } else if (materialToSend) {
            if (materialToSend.type === "text") {
              replyText = materialToSend.content || "";
            }
          }

          if (materialToSend && materialToSend.type?.toUpperCase() !== "TEXT") {
            // 发送多媒体素材
            if (params.configUrl && params.configApiKey) {
              try {
                const targetNumber = (action.replyTarget === "private_chat" && cleanSenderPhone) ? cleanSenderPhone : params.data.key.remoteJid;
                
                const typeLower = (materialToSend.type || "").toLowerCase();
                const mediaTypeMap: any = { image: "image", audio: "audio", video: "video", document: "document", file: "document" };
                const mediaType = mediaTypeMap[typeLower] || "image";

                let ext = ".jpg";
                if (mediaType === "video") ext = ".mp4";
                else if (mediaType === "audio") ext = ".ogg";
                else if (mediaType === "document") ext = ".pdf";

                let finalMediaUrl = materialToSend.url || "";
                if (finalMediaUrl.startsWith("/") || finalMediaUrl.includes("drive.google.com")) {
                  const envUrl = process.env.NEXTAUTH_URL || "";
                  const resolvedBaseUrl = envUrl ? envUrl.replace(/\/+$/, "") : "";
                  finalMediaUrl = mediaProxyUrl(resolvedBaseUrl, action.materialId, ext);
                }

                let safeFileName = (materialToSend.name || "file").replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, "");
                if (!safeFileName.toLowerCase().endsWith(ext)) {
                  safeFileName += ext;
                }

                const interpolatedCaption = interpolateTemplate(materialToSend.content || "", contactDetails);
                console.log(`[AI Pipeline] Sending auto-reply media (${mediaType}) to ${targetNumber} using URL: ${finalMediaUrl}`);
                
                let targetUrl = `${params.configUrl}/message/sendMedia/${params.instance}`;
                let requestBody: any = {
                  number: targetNumber,
                  mediatype: mediaType,
                  media: finalMediaUrl,
                  fileName: safeFileName,
                  caption: interpolatedCaption,
                  ptt: mediaType === "audio"
                };

                if (mediaType === "audio") {
                  targetUrl = `${params.configUrl}/message/sendWhatsAppAudio/${params.instance}`;
                  requestBody = {
                    number: targetNumber,
                    audio: finalMediaUrl,
                    options: {
                      delay: 1200,
                      presence: "recording",
                      encoding: true
                    },
                    audioMessage: {
                      audio: finalMediaUrl
                    }
                  };
                }

                const sendRes = await fetch(targetUrl, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "apikey": params.configApiKey
                  },
                  body: JSON.stringify(requestBody)
                });
                
                if (sendRes.ok) {
                  try {
                    const resJson = await sendRes.json();
                    const sentId = resJson.key?.id || resJson.messageId;
                    if (sentId) {
                      sentMessagesCache.add(sentId);
                      if (sentMessagesCache.size > 1000) {
                        const firstItem = sentMessagesCache.values().next().value;
                        sentMessagesCache.delete(firstItem);
                      }
                    }
                  } catch (e) {}

                  const now = new Date();
                  const mm = String(now.getMonth() + 1).padStart(2, '0');
                  const dd = String(now.getDate()).padStart(2, '0');
                  const hh = String(now.getHours()).padStart(2, '0');
                  const min = String(now.getMinutes()).padStart(2, '0');
                  const timestamp = `${mm}-${dd} ${hh}:${min}`;
                  const noteText = `[${timestamp}] [我] (自动回复素材 ${materialToSend.name}): [${mediaType}] ${materialToSend.url}`;
                  
                  if (action.replyTarget === "private_chat" && getOrEnsureMemberContact) {
                    try {
                      const member = await getOrEnsureMemberContact();
                      const [existing]: any = await conn.execute("SELECT note FROM Contact WHERE id = ? LIMIT 1", [member.id]);
                      if (existing[0]) {
                        const oldNote = existing[0].note || "";
                        const newNote = oldNote ? `${noteText}\n${oldNote}` : noteText;
                        await conn.execute("UPDATE Contact SET note = ?, updatedAt = NOW() WHERE id = ?", [newNote, member.id]);
                      }
                    } catch (e: any) {
                      console.error("[AI Pipeline] Failed to append private media reply note:", e.message);
                    }
                  } else {
                    appendNote(noteText);
                  }
                  stepDetail = `发送多媒体素材 (类型: ${mediaType}, 名称: ${materialToSend.name})`;
                } else {
                  const errorText = await sendRes.text();
                  console.error(`[AI Pipeline] Auto-reply sendMedia failed: ${sendRes.status} - ${errorText}`);
                  throw new Error(`发送媒体素材失败: Evolution-API 返回 ${sendRes.status}`);
                }
              } catch (mediaErr: any) {
                console.error("[AI Pipeline] Auto-reply sendMedia error:", mediaErr.message);
                throw mediaErr;
              }
            } else {
              throw new Error("Evolution API 未配置，无法发送多媒体素材");
            }
          } else if (replyText && params.configUrl && params.configApiKey) {
            // 发送纯文本回复 (普通文本或AI自适应)
            try {
              const targetNumber = (action.replyTarget === "private_chat" && cleanSenderPhone) ? cleanSenderPhone : params.data.key.remoteJid;
              const interpolatedReplyText = interpolateTemplate(replyText, contactDetails);
              console.log(`[AI Pipeline] Sending auto-reply to ${targetNumber}: "${interpolatedReplyText}"`);
              const sendRes = await fetch(`${params.configUrl}/message/sendText/${params.instance}`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "apikey": params.configApiKey
                },
                body: JSON.stringify({
                  number: targetNumber,
                  text: interpolatedReplyText
                })
              });
              if (sendRes.ok) {
                try {
                  const resJson = await sendRes.json();
                  const sentId = resJson.key?.id || resJson.messageId;
                  if (sentId) {
                    sentMessagesCache.add(sentId);
                    if (sentMessagesCache.size > 1000) {
                      const firstItem = sentMessagesCache.values().next().value;
                      sentMessagesCache.delete(firstItem);
                    }
                  }
                } catch (e) {}

                const now = new Date();
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const dd = String(now.getDate()).padStart(2, '0');
                const hh = String(now.getHours()).padStart(2, '0');
                const min = String(now.getMinutes()).padStart(2, '0');
                const timestamp = `${mm}-${dd} ${hh}:${min}`;
                const noteText = `[${timestamp}] [我] (自动回复): ${interpolatedReplyText}`;
                
                if (action.replyTarget === "private_chat" && getOrEnsureMemberContact) {
                  try {
                    const member = await getOrEnsureMemberContact();
                    const [existing]: any = await conn.execute("SELECT note FROM Contact WHERE id = ? LIMIT 1", [member.id]);
                    if (existing[0]) {
                      const oldNote = existing[0].note || "";
                      const newNote = oldNote ? `${noteText}\n${oldNote}` : noteText;
                      await conn.execute("UPDATE Contact SET note = ?, updatedAt = NOW() WHERE id = ?", [newNote, member.id]);
                    }
                  } catch (e: any) {
                    console.error("[AI Pipeline] Failed to append private reply note to member contact:", e.message);
                  }
                } else {
                  appendNote(noteText);
                }
                const previewText = interpolatedReplyText.slice(0, 50) + (interpolatedReplyText.length > 50 ? "..." : "");
                stepDetail = `${action.aiReplyEnabled ? "AI自适应回复" : "自动文本回复"}: "${previewText}"`;
              } else {
                const errorText = await sendRes.text();
                console.error(`[AI Pipeline] Auto-reply failed: ${sendRes.status} - ${errorText}`);
                throw new Error(`自动回复发送失败: Evolution-API 返回 ${sendRes.status}`);
              }
            } catch (replyErr: any) {
              console.error("[AI Pipeline] Auto-reply send error:", replyErr.message);
              throw replyErr;
            }
          } else {
            throw new Error("无法执行自动回复: 缺少消息内容或 Evolution API 配置");
          }
          break;
        }

        case "admin_notify": {
          const notifyPhone = action.notifyPhone || "60123456789";
          if (params.configUrl && params.configApiKey) {
            try {
              const targetContactIdForNotify = activeContactId || params.contactId;
              let dbContactName = params.contactName;
              let dbContactMarket = params.market || "未分配";
              let dbRelationStr = "";

              if (targetContactIdForNotify) {
                try {
                  const [cRows]: any = await conn.execute(
                    "SELECT name, phone, relation, market FROM Contact WHERE id = ? AND userId = ? LIMIT 1",
                    [targetContactIdForNotify, params.userId]
                  );
                  if (cRows[0]) {
                    if (cRows[0].name && cRows[0].name.trim()) dbContactName = cRows[0].name.trim();
                    if (cRows[0].market && cRows[0].market.trim()) dbContactMarket = cRows[0].market.trim();
                    try {
                      const parsedRel = JSON.parse(cRows[0].relation || "[]");
                      dbRelationStr = Array.isArray(parsedRel) ? parsedRel.join(", ") : String(cRows[0].relation || "");
                    } catch (e) {
                      dbRelationStr = String(cRows[0].relation || "");
                    }
                  }
                } catch (dbErr: any) {
                  console.error("[AI Pipeline] Failed to query contact for admin_notify:", dbErr.message);
                }
              }

              let notifyText = action.notifyTemplate || `🔔【自动规则报警/新粉通知】\n客户名称：{name}\n电话号码：{phone}\n所属市场：{market}\n来信内容：{messageText}\n触发规则：{ruleName}`;
              notifyText = notifyText
                .replace(/{name}/g, dbContactName || params.cleanPhone || "")
                .replace(/{phone}/g, params.cleanPhone || "")
                .replace(/{market}/g, dbContactMarket || "未分配")
                .replace(/{relation}/g, dbRelationStr || "")
                .replace(/{messageText}/g, params.messageText || "")
                .replace(/{ruleName}/g, context.matchedRuleName || "");

              console.log(`[AI Pipeline] Sending direct admin notification to ${notifyPhone}`);
              const res = await fetch(`${params.configUrl}/message/sendText/${params.instance}`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "apikey": params.configApiKey
                },
                body: JSON.stringify({
                  number: notifyPhone,
                  text: notifyText
                })
              });
              if (!res.ok) {
                const errText = await res.text();
                throw new Error(`管理员通知发送失败: ${res.status} - ${errText}`);
              }
              stepDetail = `已发送管理员通知到: ${notifyPhone}`;
            } catch (notifyErr: any) {
              console.error("[AI Pipeline] Direct admin notification failed:", notifyErr.message);
              throw notifyErr;
            }
          } else {
            throw new Error("未配置 Evolution API，无法发送管理员通知");
          }
          break;
        }

        case "next_campaign": {
          if (action.nextCampaignId) {
            try {
              console.log(`[AI Pipeline] Direct sequence nextCampaignId: ${action.nextCampaignId}`);
              
              // Appending group tags to relations if applicable
              const [campRows]: any = await conn.execute(
                "SELECT groupId, name FROM Campaign WHERE id = ? LIMIT 1",
                [action.nextCampaignId]
              );
              let campName = action.nextCampaignId;
              if (campRows[0]) {
                campName = campRows[0].name || campName;
                if (campRows[0].groupId) {
                  const [gRows]: any = await conn.execute(
                    "SELECT filterConfig FROM `Group` WHERE id = ? LIMIT 1",
                    [campRows[0].groupId]
                  );
                  if (gRows[0]?.filterConfig) {
                    const filterConfig = JSON.parse(gRows[0].filterConfig);
                    if (filterConfig.relations && filterConfig.relations.length > 0) {
                      const newTag = filterConfig.relations[0];
                      
                      const targetId = activeContactId || params.contactId;
                      const [ctRows]: any = await conn.execute(
                        "SELECT relation FROM Contact WHERE id = ? LIMIT 1",
                        [targetId]
                      );
                      if (ctRows[0]) {
                        let currentRelations: string[] = [];
                        try {
                          currentRelations = JSON.parse(ctRows[0].relation || "[]");
                        } catch (e) {
                          currentRelations = [];
                        }
                        if (!currentRelations.includes(newTag)) {
                          currentRelations.push(newTag);
                          await conn.execute(
                            "UPDATE Contact SET relation = ? WHERE id = ?",
                            [JSON.stringify(currentRelations), targetId]
                          );
                        }
                      }
                    }
                  }
                }
              }

              const host = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).host : "localhost:3000";
              const protocol = process.env.NEXTAUTH_URL?.startsWith("https") ? "https" : "http";
              const internalToken = getInternalToken();
              if (!internalToken) {
                throw new Error("未配置 CRON_TOKEN，无法触发下一期群发活动");
              }
              const triggerUrl = `${protocol}://${host}/api/campaigns/${action.nextCampaignId}/trigger?token=${encodeURIComponent(internalToken)}`;
              
              const targetId = activeContactId || params.contactId;
              const trRes = await fetch(triggerUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  targetContactId: targetId
                })
              });
              if (!trRes.ok) {
                throw new Error(`触发群发活动接口返回错误: ${trRes.status}`);
              }
              stepDetail = `已触发下一期群发活动: ${campName}`;
            } catch (campErr: any) {
              console.error("[AI Pipeline] Next campaign action failed:", campErr.message);
              throw campErr;
            }
          } else {
            stepDetail = "触发群发活动: 未指定活动ID";
          }
          break;
        }

        case "webhook": {
          if (action.webhookUrl) {
            try {
              const method = action.webhookMethod || "POST";
              const targetUrl = action.webhookUrl.trim();
              console.log(`[AI Pipeline] Custom Webhook trigger: URL=${targetUrl}, Method=${method}`);
              
              const payload = {
                event: "AUTO_RULE_TRIGGERED",
                ruleName: context.matchedRuleName,
                message: {
                  text: params.messageText,
                  fromMe: params.data.key?.fromMe || false,
                  timestamp: new Date().toISOString(),
                  isGroup: params.isGroup
                },
                contact: {
                  id: activeContactId || params.contactId,
                  name: params.contactName,
                  phone: activeContactPhone || params.cleanPhone,
                  market: params.market || ""
                },
                sender: params.isGroup ? {
                  phone: cleanSenderPhone,
                  name: params.data.pushName
                } : null
              };

              const headers: Record<string, string> = {
                "Content-Type": "application/json"
              };

              if (action.webhookHeaders) {
                try {
                  const parsed = JSON.parse(action.webhookHeaders);
                  Object.assign(headers, parsed);
                } catch (e) {
                  console.error("[AI Pipeline] Failed to parse custom webhook headers:", e);
                }
              }

              const fetchOptions: any = {
                method: method,
                headers: headers
              };

              if (method !== "GET") {
                fetchOptions.body = JSON.stringify(payload);
              }

              const res = await fetch(targetUrl, fetchOptions);
              console.log(`[AI Pipeline] Custom Webhook response: status=${res.status}`);
              
              if (!res.ok) {
                throw new Error(`Webhook URL 返回错误状态码: ${res.status}`);
              }

              let responseData: any = null;
              try {
                const text = await res.text();
                try {
                  responseData = JSON.parse(text);
                } catch (pe) {
                  console.log(`[AI Pipeline] Custom Webhook response is not JSON.`);
                }
              } catch (readErr: any) {
                console.error("[AI Pipeline] Failed to read webhook response body:", readErr.message);
              }

              if (responseData) {
                if (responseData.priority) {
                  setPriority(responseData.priority === "mark_urgent" ? "urgent" : responseData.priority);
                  console.log(`[AI Pipeline] Custom Webhook priority directive: ${responseData.priority}`);
                }
                
                if (responseData.stepId) {
                  setStepId(responseData.stepId);
                  console.log(`[AI Pipeline] Custom Webhook stepId directive: ${responseData.stepId}`);
                }
                
                if (responseData.relation) {
                  let relationTags: string[] = [];
                  if (Array.isArray(responseData.relation)) {
                    relationTags = responseData.relation.map(String);
                  } else if (typeof responseData.relation === "string") {
                    relationTags = responseData.relation.split(",").map((t: string) => t.trim()).filter(Boolean);
                  }
                  if (relationTags.length > 0) {
                    setRelations(relationTags);
                    console.log(`[AI Pipeline] Custom Webhook relation directive: ${relationTags}`);
                  }
                }
                
                if (responseData.replyText && params.configUrl && params.configApiKey) {
                  const targetContactIdForInterp = activeContactId || params.contactId;
                  let contactDetails = { name: params.contactName, phone: params.cleanPhone, relation: "", market: params.market || "" };
                  try {
                    const [contactRows]: any = await conn.execute(
                      "SELECT name, phone, relation, market FROM Contact WHERE id = ? AND userId = ? LIMIT 1",
                      [targetContactIdForInterp, params.userId]
                    );
                    if (contactRows[0]) {
                      let relStr = "";
                      try {
                        const parsedRel = JSON.parse(contactRows[0].relation || "[]");
                        relStr = Array.isArray(parsedRel) ? parsedRel.join(", ") : String(contactRows[0].relation || "");
                      } catch (e) {
                        relStr = String(contactRows[0].relation || "");
                      }
                      contactDetails = {
                        name: contactRows[0].name || params.contactName,
                        phone: contactRows[0].phone || params.cleanPhone,
                        relation: relStr,
                        market: contactRows[0].market || params.market || ""
                      };
                    }
                  } catch (dbErr) {
                    console.error("[AI Pipeline] Failed to query contact details for webhook reply template rendering:", dbErr);
                  }

                  const rawReplyText = responseData.replyText;
                  const interpolatedReplyText = interpolateTemplate(rawReplyText, contactDetails);
                  const targetNumber = params.cleanPhone;
                  console.log(`[AI Pipeline] Custom Webhook reply directive to ${targetNumber}: "${interpolatedReplyText}"`);
                  
                  const sendRes = await fetch(`${params.configUrl}/message/sendText/${params.instance}`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "apikey": params.configApiKey
                    },
                    body: JSON.stringify({
                      number: targetNumber,
                      text: interpolatedReplyText
                    })
                  });
                  
                  if (sendRes.ok) {
                    const now = new Date();
                    const mm = String(now.getMonth() + 1).padStart(2, '0');
                    const dd = String(now.getDate()).padStart(2, '0');
                    const hh = String(now.getHours()).padStart(2, '0');
                    const min = String(now.getMinutes()).padStart(2, '0');
                    const timestamp = `${mm}-${dd} ${hh}:${min}`;
                    const noteText = `[${timestamp}] [我] (Webhook回复): ${interpolatedReplyText}`;
                    appendNote(noteText);
                  } else {
                    console.error(`[AI Pipeline] Webhook response replyText send failed: ${sendRes.status}`);
                  }
                }
              }
              stepDetail = `触发自定义 Webhook 成功 (URL: ${targetUrl})`;
            } catch (webhookErr: any) {
              console.error("[AI Pipeline] Custom Webhook action failed:", webhookErr.message);
              throw webhookErr;
            }
          } else {
            stepDetail = "触发 Webhook: 未指定 URL";
          }
          break;
        }

        case "agent_assign": {
          try {
            const assignMode = action.assignMode || "specific";
            let targetUserId = "";

            if (assignMode === "specific") {
              targetUserId = action.assignUserId;
            } else if (assignMode === "round_robin") {
              let usersList: any[] = [];
              const [userRows]: any = await conn.execute(
                "SELECT id, name FROM User WHERE role = 'OPERATOR' ORDER BY id ASC"
              );
              usersList = userRows;
              if (usersList.length === 0) {
                const [allUserRows]: any = await conn.execute(
                  "SELECT id, name FROM User ORDER BY id ASC"
                );
                usersList = allUserRows;
              }

              if (usersList.length > 0) {
                const targetId = activeContactId || params.contactId;
                let hash = 0;
                for (let i = 0; i < targetId.length; i++) {
                  hash = targetId.charCodeAt(i) + ((hash << 5) - hash);
                }
                const index = Math.abs(hash) % usersList.length;
                targetUserId = usersList[index]?.id || "";
                console.log(`[AI Pipeline] Round-robin selected user: ${usersList[index]?.name} (${targetUserId})`);
              }
            }

            if (targetUserId) {
              const targetId = activeContactId || params.contactId;
              const currentUserId = params.userId;

              if (targetUserId !== currentUserId) {
                let targetUserName = targetUserId;
                const [uRows]: any = await conn.execute(
                  "SELECT name FROM User WHERE id = ? LIMIT 1",
                  [targetUserId]
                );
                if (uRows[0]) {
                  targetUserName = uRows[0].name;
                }

                const [steps]: any = await conn.execute(
                  "SELECT id FROM ContactStep WHERE userId = ? ORDER BY orderIndex ASC LIMIT 1",
                  [targetUserId]
                );
                let targetStepId = steps[0]?.id;
                if (!targetStepId) {
                  targetStepId = "step_" + Math.random().toString(36).slice(2, 22);
                  await conn.execute(
                    "INSERT INTO ContactStep (id, name, color, orderIndex, userId) VALUES (?, ?, ?, ?, ?)",
                    [targetStepId, "新线索", "#3b82f6", 1.0, targetUserId]
                  );
                }

                await conn.execute(
                  "UPDATE Contact SET userId = ?, stepId = ?, updatedAt = NOW() WHERE id = ? AND userId = ?",
                  [targetUserId, targetStepId, targetId, currentUserId]
                );
                console.log(`[AI Pipeline] Reassigned contact ${targetId} from ${currentUserId} to ${targetUserId}`);

                params.userId = targetUserId;
                setStepId(targetStepId);

                const now = new Date();
                const mm = String(now.getMonth() + 1).padStart(2, '0');
                const dd = String(now.getDate()).padStart(2, '0');
                const hh = String(now.getHours()).padStart(2, '0');
                const min = String(now.getMinutes()).padStart(2, '0');
                const timestamp = `${mm}-${dd} ${hh}:${min}`;
                const noteText = `[${timestamp}] [系统] 联系人已成功分配给跟进人: ${targetUserName}。`;
                appendNote(noteText);
                stepDetail = `已分配给跟进人: ${targetUserName}`;
              } else {
                stepDetail = "跟进人分配: 已经是当前拥有者，跳过";
              }
            } else {
              stepDetail = "跟进人分配: 未指定或未找到跟进人";
            }
          } catch (assignErr: any) {
            console.error("[AI Pipeline] Agent assignment action failed:", assignErr.message);
            throw assignErr;
          }
          break;
        }
      }
    } catch (e: any) {
      stepStatus = "failed";
      stepDetail = `执行失败: ${e.message}`;
      console.error(`[AI Pipeline Action Error] type=${action.type} error=${e.message}`);
      if ((action.onFailurePolicy || "stop") === "stop") {
        shouldAbort = true;
      }
    } finally {
      const stepDuration = Date.now() - stepStartTime;
      stepsLog.push({
        type: action.type,
        status: stepStatus,
        detail: stepDetail,
        duration: stepDuration
      });
    }

    if (shouldAbort) {
      console.log(`[AI Pipeline] Aborting action chain due to failure of ${action.type} (policy=stop)`);
      break;
    }
  }

  return stepsLog;
}


// 💡 辅助方法：AI 文本生成回复 (支持多模型)
async function generateAiReply(messageText: string, provider: string, key: string, model: string, systemPrompt: string): Promise<string> {
  try {
    if (provider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-1.5-flash"}:generateContent?key=${key}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\n客户发来的消息：\n${messageText}` }] }
          ]
        })
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text.trim();
      }
    } else {
      let baseUrl = "https://api.openai.com/v1";
      if (provider === "deepseek") {
        baseUrl = "https://api.deepseek.com/v1";
      }
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model || (provider === "deepseek" ? "deepseek-chat" : "gpt-4o-mini"),
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: messageText }
          ],
          max_tokens: 350,
          temperature: 0.7
        })
      });
      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return text.trim();
      }
    }
  } catch (e: any) {
    console.error("[AI Pipeline] generateAiReply error:", e.message);
  }
  return "";
}

// 💡 辅助方法：懒加载创建/查询个人联系人记录
async function ensureContactExists(
  conn: any,
  userId: string,
  phone: string,
  options: {
    instance?: string;
    parentGroupJid?: string;
    displayName?: string;
  }
) {
  const [rows]: any = await conn.execute(
    "SELECT id, stepId, note, relation, priority, market, properties FROM Contact WHERE phone = ? AND userId = ? LIMIT 1",
    [phone, userId]
  );
  if (rows[0]) {
    return rows[0];
  }

  const [steps]: any = await conn.execute(
    "SELECT id FROM ContactStep WHERE userId = ? ORDER BY orderIndex ASC LIMIT 1",
    [userId]
  );
  let targetStepId = steps[0]?.id;
  if (!targetStepId) {
    targetStepId = "step_" + Math.random().toString(36).slice(2, 22);
    await conn.execute(
      "INSERT INTO ContactStep (id, name, color, orderIndex, userId) VALUES (?, ?, ?, ?, ?)",
      [targetStepId, "新线索", "#3b82f6", 1.0, userId]
    );
  }
  
  const [minOrderRows]: any = await conn.execute(
    "SELECT MIN(orderIndex) as minOrder FROM Contact WHERE stepId = ? AND userId = ?",
    [targetStepId, userId]
  );
  let newOrder = 0;
  if (minOrderRows[0] && minOrderRows[0].minOrder !== null) {
    newOrder = Number(minOrderRows[0].minOrder) - 100;
  }
  
  const newContactId = "ct_" + Math.random().toString(36).slice(2, 22);
  const properties = JSON.stringify({
    sourceInstance: options.instance || "Webhook",
    incomingType: "EvolutionAPI",
    parentGroupJid: options.parentGroupJid || ""
  });
  
  const defaultRelation = '["新名单"]';
  const displayName = options.displayName || phone;
  
  await conn.execute(
    "INSERT INTO Contact (id, name, phone, stepId, priority, note, lastActivityAt, responded, orderIndex, userId, sourceId, relation, properties) VALUES (?, ?, ?, ?, 'medium', NULL, NOW(), 1, ?, ?, 'evolution', ?, ?)",
    [newContactId, displayName, phone, targetStepId, newOrder, userId, defaultRelation, properties]
  );

  return {
    id: newContactId,
    stepId: targetStepId,
    note: "",
    relation: defaultRelation,
    priority: "medium",
    market: "",
    properties: properties
  };
}
