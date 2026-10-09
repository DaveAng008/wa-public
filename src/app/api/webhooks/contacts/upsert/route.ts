import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { matchesEnvToken } from "@/lib/authToken";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 1. 安全令牌校验（Header: X-Webhook-Token）。未配置 WEBHOOK_TOKEN 时一律拒绝。
  const token = req.headers.get("X-Webhook-Token");

  if (!matchesEnvToken(token, "WEBHOOK_TOKEN")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    let { userId, phone, name, message, instance } = body;

    // 💡 方案 B 自动分发核心：如果未传 userId，尝试从 instance 名称 (usr_cmcXXXX_...) 中提取租户 ID
    if (!userId && instance) {
      const match = instance.match(/^usr_(cmc[a-zA-Z0-9]+)_(.+)$/i);
      if (match) {
        userId = match[1];
      }
    }

    // 参数校验
    if (!userId || !phone) {
      return NextResponse.json({ error: "Missing required fields: userId, phone" }, { status: 400 });
    }

    // 格式化手机号：保留 @g.us 与 @lid 后缀，其他只保留数字
    const rawId = phone.split("@")[0];
    const cleanPhone = phone.endsWith("@g.us") 
      ? `${rawId.replace(/\D/g, "")}@g.us` 
      : (phone.endsWith("@lid") ? `${rawId.replace(/\D/g, "")}@lid` : rawId.replace(/\D/g, ""));
    if (!cleanPhone) {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
    }

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      // 2. 检查用户是否存在，确认归属
      const [users]: any = await conn.execute(
        "SELECT id FROM User WHERE id = ? LIMIT 1",
        [userId]
      );
      if (users.length === 0) {
        return NextResponse.json({ error: "User (userId) not found" }, { status: 404 });
      }

      // 2.1 获取租户用户设置以执行关键字路由
      const [settings]: any = await conn.execute(
        "SELECT aiRoutingEnabled, aiRoutingConfig FROM AppSettings WHERE userId = ? LIMIT 1",
        [userId]
      );
      const appSettings = settings[0] || {};
      const aiRoutingEnabled = appSettings.aiRoutingEnabled == 1 || appSettings.aiRoutingEnabled === true;
      const aiRoutingConfig = appSettings.aiRoutingConfig || "[]";

      // 3. 查重：判断该顾客是否已存在
      const [existingContacts]: any = await conn.execute(
        "SELECT id, stepId, note FROM Contact WHERE phone = ? AND userId = ? LIMIT 1",
        [cleanPhone, userId]
      );

      const contactName = name ? name.trim() : cleanPhone;

      if (existingContacts[0]) {
        // --- 存在联系人：更新状态与最后消息 ---
        const contactId = existingContacts[0].id;
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

        let priorityToSet = null;
        // 智能路由关键字检查
        if (aiRoutingEnabled && aiRoutingConfig && message) {
          try {
            const rules = JSON.parse(aiRoutingConfig);
            if (Array.isArray(rules)) {
              const textToCheck = message.toLowerCase();
              for (const rule of rules) {
                if (!rule.keyword) continue;
                const kws = rule.keyword.split(",").map((k: string) => k.trim().toLowerCase()).filter(Boolean);
                const matched = kws.some((kw: string) => textToCheck.includes(kw));
                if (matched) {
                  if (rule.targetStepId) {
                    currentStepId = rule.targetStepId;
                  }
                  if (rule.action === "mark_urgent") {
                    priorityToSet = "urgent";
                  }
                  break;
                }
              }
            }
          } catch (e) {
            console.error("Failed to parse aiRoutingConfig in upsert webhook:", e);
          }
        }

        const existingNote = existingContacts[0].note || "";

        let newNote = existingNote;
        if (message) {
          const now = new Date();
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const hh = String(now.getHours()).padStart(2, '0');
          const min = String(now.getMinutes()).padStart(2, '0');
          const timestamp = `${mm}-${dd} ${hh}:${min}`;
          const newMsgLine = `[${timestamp}] ${message}`;

          if (existingNote) {
            // 将旧备注拆分行，过滤掉空行
            const oldLines = existingNote.split(/\r?\n/).filter((line: string) => line.trim() !== "");
            
            // 区分聊天行和手动备注行
            const chatLineRegex = /^\[\d{2}-\d{2}\s+\d{2}:\d{2}\]/;
            const chatLines = oldLines.filter((line: string) => chatLineRegex.test(line));
            const manualLines = oldLines.filter((line: string) => !chatLineRegex.test(line));
            
            // 合并聊天记录并只保留最近 5 条
            const mergedChatLines = [newMsgLine, ...chatLines].slice(0, 5);
            
            // 组装最终备注：最新的 5 条聊天记录在上方，手动备注内容在下方
            newNote = [...mergedChatLines, ...manualLines].join("\n");
          } else {
            newNote = newMsgLine;
          }
        }

        // 💡 自动置顶逻辑：获取当前看板列中最小的 orderIndex 并减去 100，让其成为最小值
        const [minOrderRows]: any = await conn.execute(
          "SELECT MIN(orderIndex) as minOrder FROM Contact WHERE stepId = ? AND userId = ?",
          [currentStepId, userId]
        );
        let newOrder = 0;
        if (minOrderRows[0] && minOrderRows[0].minOrder !== null) {
          newOrder = Number(minOrderRows[0].minOrder) - 100;
        }
        
        // 我们不覆盖原有的姓名 and 市场等，只更新备注、活跃时间、已回应状态、阶段列以及置顶排序值
        if (priorityToSet) {
          await conn.execute(
            "UPDATE Contact SET note = ?, stepId = ?, priority = ?, lastActivityAt = NOW(), responded = 1, orderIndex = ?, updatedAt = NOW() WHERE id = ? AND userId = ?",
            [newNote, currentStepId, priorityToSet, newOrder, contactId, userId]
          );
        } else {
          await conn.execute(
            "UPDATE Contact SET note = ?, stepId = ?, lastActivityAt = NOW(), responded = 1, orderIndex = ?, updatedAt = NOW() WHERE id = ? AND userId = ?",
            [newNote, currentStepId, newOrder, contactId, userId]
          );
        }

        return NextResponse.json({
          success: true,
          action: "updated",
          contactId
        });
      } else {
        // --- 不存在联系人：新建联系人卡片并归入第一列看板 ---
        // 3.1 获取第一列看板的 stepId
        const [steps]: any = await conn.execute(
          "SELECT id FROM ContactStep WHERE userId = ? ORDER BY orderIndex ASC LIMIT 1",
          [userId]
        );

        let targetStepId = null;
        if (steps[0]) {
          targetStepId = steps[0].id;
        } else {
          // 如果该用户没有任何看板列，我们尝试为其生成一个默认的“新线索”看板列
          const defaultStepId = "step_" + Math.random().toString(36).slice(2, 22);
          await conn.execute(
            "INSERT INTO ContactStep (id, name, color, orderIndex, userId) VALUES (?, ?, ?, ?, ?)",
            [defaultStepId, "新线索", "#3b82f6", 1.0, userId]
          );
          targetStepId = defaultStepId;
        }

        let priorityToSet = "medium";
        // 智能路由关键字检查
        if (aiRoutingEnabled && aiRoutingConfig && message) {
          try {
            const rules = JSON.parse(aiRoutingConfig);
            if (Array.isArray(rules)) {
              const textToCheck = message.toLowerCase();
              for (const rule of rules) {
                if (!rule.keyword) continue;
                const kws = rule.keyword.split(",").map((k: string) => k.trim().toLowerCase()).filter(Boolean);
                const matched = kws.some((kw: string) => textToCheck.includes(kw));
                if (matched) {
                  if (rule.targetStepId) {
                    targetStepId = rule.targetStepId;
                  }
                  if (rule.action === "mark_urgent") {
                    priorityToSet = "urgent";
                  }
                  break;
                }
              }
            }
          } catch (e) {
            console.error("Failed to parse aiRoutingConfig in upsert webhook for new contact:", e);
          }
        }

        // 💡 新联系人自动置顶：获取目标看板列中最小的 orderIndex 并减去 100
        const [minOrderRows]: any = await conn.execute(
          "SELECT MIN(orderIndex) as minOrder FROM Contact WHERE stepId = ? AND userId = ?",
          [targetStepId, userId]
        );
        let newOrder = 0;
        if (minOrderRows[0] && minOrderRows[0].minOrder !== null) {
          newOrder = Number(minOrderRows[0].minOrder) - 100;
        }

        // 3.2 生成新联系人 ID 并插入
        const newContactId = "ct_" + Math.random().toString(36).slice(2, 22);
        
        // 构造属性 properties JSON：可以记录来源实例等辅助信息
        const properties = JSON.stringify({
          sourceInstance: instance || "Webhook",
          incomingType: "EvolutionAPI"
        });

        // 格式化当前时间为 [MM-DD HH:mm]
        let initialNote = null;
        if (message) {
          const now = new Date();
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const hh = String(now.getHours()).padStart(2, '0');
          const min = String(now.getMinutes()).padStart(2, '0');
          const timestamp = `${mm}-${dd} ${hh}:${min}`;
          initialNote = `[${timestamp}] ${message}`;
        }

        await conn.execute(
          "INSERT INTO Contact (id, name, phone, stepId, priority, note, lastActivityAt, responded, orderIndex, userId, sourceId, relation, properties) VALUES (?, ?, ?, ?, ?, ?, NOW(), 1, ?, ?, 'evolution', '[\"新名单\"]', ?)",
          [newContactId, contactName, cleanPhone, targetStepId, priorityToSet, initialNote, newOrder, userId, properties]
        );

        return NextResponse.json({
          success: true,
          action: "created",
          contactId: newContactId
        });
      }
    } finally {
      await conn.end();
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
