import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import { getInternalToken, isAuthorizedInternal } from "@/lib/authToken";
import { getEvolutionConfig } from "@/lib/evolutionConfig";

export const dynamic = "force-dynamic";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

// Evolution 连接配置统一走 @/lib/evolutionConfig（环境变量优先 → 用户配置 → 管理员配置）

function replacePlaceholders(val: string, item: any, instName: string, market: string, checkPhone: string, rawPhone: string, isGroup: boolean): string {
  if (typeof val !== 'string') return val;

  const countryCode = checkPhone.slice(0, 2) || "";
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8);

  return val
    .replace(/{pushName}/g, item.pushName || item.name || "")
    .replace(/{isSaved}/g, (item.isSaved === true || item.isSaved === "true" || item.isSaved === 1) ? "是" : "否")
    .replace(/{type}/g, item.type === "group" ? "group" : (item.type === "lid" ? "lid" : "individual"))
    .replace(/{isGroup}/g, isGroup ? "是" : "否")
    .replace(/{jid}/g, item.jid || item.phone || rawPhone || "")
    .replace(/{market}/g, market || (isGroup ? "组群" : "其他地区"))
    .replace(/{countryCode}/g, countryCode)
    .replace(/{phone}/g, checkPhone || rawPhone || "")
    .replace(/{instance}/g, instName || "")
    .replace(/{date}/g, dateStr)
    .replace(/{time}/g, timeStr);
}

async function fetchInstanceGroups(config: { url: string; apikey: string }, instanceName: string): Promise<any[]> {
  try {
    let groupRes = await fetch(`${config.url}/group/fetchAllGroups/${instanceName}?getParticipants=false`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "apikey": config.apikey
      },
      cache: "no-store"
    });
    if (!groupRes.ok) {
      groupRes = await fetch(`${config.url}/group/fetchAllGroups/${instanceName}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": config.apikey
        },
        body: JSON.stringify({ getParticipants: false }),
        cache: "no-store"
      });
    }
    if (groupRes.ok) {
      const temp = await groupRes.json();
      if (Array.isArray(temp)) return temp;
      if (temp && typeof temp === 'object') {
        if (Array.isArray(temp.data)) return temp.data;
        if (Array.isArray(temp.groups)) return temp.groups;
      }
    }
  } catch (e) {
    console.error(`Failed to fetch groups for ${instanceName}:`, e);
  }
  return [];
}

export async function POST(req: NextRequest) {
  let userId = "";
  let targetInstanceName: string | string[] = "all";
  
  let body: any = {};
  try {
    body = await req.json();
  } catch (e) {}

  if (isAuthorizedInternal(req)) {
    // 内部调度通道（cron）：必须是真实存在的用户 ID，不能凭令牌任意写入
    const requestedUserId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!requestedUserId) {
      return NextResponse.json({ error: "Missing required field: userId" }, { status: 400 });
    }
    const checkConn = await getConn();
    try {
      const [uRows]: any = await checkConn.execute("SELECT id FROM User WHERE id = ? LIMIT 1", [requestedUserId]);
      if (!uRows || uRows.length === 0) {
        return NextResponse.json({ error: "Unknown userId" }, { status: 400 });
      }
    } finally {
      await checkConn.end();
    }
    userId = requestedUserId;
    targetInstanceName = body.instanceName || "all";
  } else {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = session.user.id;
    targetInstanceName = body.instanceName || "all";
  }

  if (!userId) {
    return NextResponse.json({ error: "Missing required field: userId" }, { status: 400 });
  }

  // 解析默认字段和属性模板（手动导入时传参）
  let defaultFields: { key: string, value: any }[] = [];
  if (body.defaultFields && Array.isArray(body.defaultFields)) {
    defaultFields = body.defaultFields;
  }

  let relationFromTemplate: string[] = [];
  const relField = defaultFields.find(f => f.key === "relation" || f.key === "标签" || f.key === "关系标签");
  if (relField && relField.value) {
    relationFromTemplate = Array.isArray(relField.value) 
      ? relField.value 
      : String(relField.value).split(",").map(x => x.trim()).filter(Boolean);
  } else {
    relationFromTemplate = ["新名单"];
  }

  let respondedFromTemplate = 0; // 默认 0
  const respField = defaultFields.find(f => f.key === "是否有回应" || f.key === "responded" || f.key === "回复状态");
  if (respField) {
    const v = String(respField.value).trim();
    if (v === "已回复" || v === "true" || v === "1" || respField.value === true) {
      respondedFromTemplate = 1;
    } else {
      respondedFromTemplate = 0;
    }
  }

  const baseProperties: Record<string, any> = {};
  defaultFields.forEach(f => {
    if (!["relation", "标签", "关系标签", "是否有回应", "responded", "回复状态"].includes(f.key) && f.key) {
      baseProperties[f.key] = f.value;
    }
  });

  const conn = await getConn();

  try {
    // 1. 获取 Evolution API 凭据
    const config = await getEvolutionConfig(conn, userId);
    if (!config) {
      return NextResponse.json({ error: "Evolution API 未配置，请先在系统设置中配置 API 地址和密钥" }, { status: 400 });
    }

    // 2. 拉取 Evolution API 所有的实例
    const instancesRes = await fetch(`${config.url}/instance/fetchInstances`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "apikey": config.apikey
      },
      cache: "no-store"
    });

    if (!instancesRes.ok) {
      const errText = await instancesRes.text();
      throw new Error(`无法获取实例列表: ${errText}`);
    }

    const allInstances = await instancesRes.json();
    if (!Array.isArray(allInstances)) {
      return NextResponse.json({ success: true, message: "未找到可用的 WhatsApp 实例", count: 0 });
    }

    // 查询该用户下配置为不允许同步的实例列表
    const [disabledInstancesRows]: any = await conn.execute(
      "SELECT instanceName FROM InstanceConfig WHERE userId = ? AND allowSync = 0",
      [userId]
    );
    const disabledSet = new Set<string>(disabledInstancesRows.map((r: any) => r.instanceName));

    // 3. 过滤并找出待同步的在线实例
    const activeInstances = allInstances
      .map((item: any) => {
        const inst = item.instance ? { ...item.instance, ...item } : item;
        const name = inst.instanceName || inst.name || "";
        const token = inst.token || inst.apikey || (inst.hash?.apikey || inst.hash) || item.hash?.apikey || item.hash || "";
        const ownerJid = inst.ownerJid || inst.owner || "";
        const connStatus = String(inst.connectionStatus || inst.status || "").toLowerCase();
        const isOpen = connStatus === "connected" || connStatus === "online" || connStatus === "open";

        // 获取剥离前缀后的名称，并判定归属
        const match = name.match(/^usr_(cmc[a-zA-Z0-9]+)_(.+)$/i);
        const ownerId = match ? match[1] : "system";

        return {
          rawName: name,
          token: token,
          ownerId: ownerId,
          ownerJid: ownerJid,
          isOpen: isOpen
        };
      })
      .filter((inst: any) => {
        // 安全检查：普通用户只能同步归属于自己的或系统实例
        const isOwner = inst.ownerId === "system" || inst.ownerId === userId;
        if (!isOwner) return false;

        // 如果在被禁用同步列表中，则跳过
        if (disabledSet.has(inst.rawName)) return false;

        // 匹配特定实例或所有
        if (targetInstanceName !== "all") {
          if (Array.isArray(targetInstanceName)) {
            if (!targetInstanceName.includes(inst.rawName)) return false;
          } else {
            if (inst.rawName !== targetInstanceName) return false;
          }
        }

        // 实例必须在线且绑定了手机号
        return inst.isOpen && inst.ownerJid;
      });

    if (activeInstances.length === 0) {
      return NextResponse.json({
        success: false,
        error: targetInstanceName === "all" ? "没有在线的 WhatsApp 实例，请先在系统设置中连接实例" : `所选实例未在线或未绑定手机号`
      }, { status: 400 });
    }

    // 获取规则配置
    const [settingsRows]: any = await conn.execute(
      "SELECT whatsappSyncConfig FROM AppSettings WHERE userId = ? LIMIT 1",
      [userId]
    );
    let rules: any[] = [];
    try {
      const configStr = settingsRows[0]?.whatsappSyncConfig || "[]";
      rules = JSON.parse(configStr);
      if (!Array.isArray(rules)) {
        throw new Error("Parsed rules is not an array");
      }
    } catch (e) {
      // 默认规则备份
      rules = [
        { prefix: "65", market: "新加坡", notify: true, template: "每天更新新名单:\n电话号码：{phone}\n市场：新加坡" },
        { prefix: "60", market: "马来西亚", notify: false, template: "" }
      ];
    }
    // 按照前缀长度降序排序以进行最精确的前缀匹配
    rules.sort((a, b) => b.prefix.length - a.prefix.length);

    // ==================== 路径 1: 仅预览模式 ====================
    if (body.preview === true) {
      const previewContacts: any[] = [];
      const previewPhonesSet = new Set<string>();

      // 获取当前已存联系人（以防重复导入识别）
      const [existingContacts]: any = await conn.execute(
        "SELECT phone FROM Contact WHERE userId = ?",
        [userId]
      );
      const existingPhonesSet = new Set<string>(existingContacts.map((c: any) => c.phone));

      for (const inst of activeInstances) {
        // 7.1 获取实例下的联系人列表
        let rawContacts: any[] = [];
        try {
          const contactsRes = await fetch(`${config.url}/chat/findContacts/${inst.rawName}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": config.apikey
            },
            body: JSON.stringify({}),
            cache: "no-store"
          });

          if (contactsRes.ok) {
            const temp = await contactsRes.json();
            if (Array.isArray(temp)) {
              rawContacts = temp;
            } else if (temp && typeof temp === 'object') {
              if (Array.isArray(temp.data)) {
                rawContacts = temp.data;
              } else if (Array.isArray(temp.contacts)) {
                rawContacts = temp.contacts;
              } else if (Array.isArray(temp.contacts?.contacts)) {
                rawContacts = temp.contacts.contacts;
              }
            }
          }
        } catch (e) {
          console.error(`Failed to fetch contacts for ${inst.rawName}:`, e);
        }

        // 7.2 获取实例下的聊天列表 (用于拉取没有保存在通讯录中的个人对话)
        let rawChats: any[] = [];
        try {
          const chatsRes = await fetch(`${config.url}/chat/findChats/${inst.rawName}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": config.apikey
            },
            body: JSON.stringify({}),
            cache: "no-store"
          });
          if (chatsRes.ok) {
            const temp = await chatsRes.json();
            if (Array.isArray(temp)) {
              rawChats = temp;
            } else if (temp && typeof temp === 'object') {
              if (Array.isArray(temp.data)) {
                rawChats = temp.data;
              } else if (Array.isArray(temp.chats)) {
                rawChats = temp.chats;
              }
            }
          }
        } catch (e) {
          console.error(`Failed to fetch chats for ${inst.rawName}:`, e);
        }

        // 合并并去重，按 JID 进行合并
        const mergedMap = new Map<string, any>();

        for (const item of rawContacts) {
          const jid = String(item.remoteJid || item.id || "").trim();
          if (!jid) continue;
          
          mergedMap.set(jid, {
            id: jid,
            name: item.name || item.pushName || item.verifiedName || "",
            pushName: item.pushName || "",
            verifiedName: item.verifiedName || "",
            isGroup: item.isGroup === true || item.type === "group" || jid.endsWith("@g.us"),
            isSaved: item.isSaved === true || item.isSaved === "true",
            type: item.type || (jid.endsWith("@g.us") ? "group" : "user")
          });
        }

        for (const item of rawChats) {
          const jid = String(item.remoteJid || item.id || "").trim();
          if (!jid) continue;

          const isGroup = item.isGroup === true || item.type === "group" || jid.endsWith("@g.us");
          const existing = mergedMap.get(jid);
          if (existing) {
            existing.name = existing.name || item.name || item.pushName || "";
            existing.pushName = existing.pushName || item.pushName || "";
            if (item.isSaved !== undefined) {
              existing.isSaved = item.isSaved === true || item.isSaved === "true";
            }
          } else {
            mergedMap.set(jid, {
              id: jid,
              name: item.name || item.pushName || "",
              pushName: item.pushName || "",
              verifiedName: "",
              isGroup: isGroup,
              isSaved: item.isSaved === true || item.isSaved === "true",
              type: item.type || (isGroup ? "group" : "user")
            });
          }
        }

        // 7.3 获取实例下的真实群组列表并融合 subject
        const rawGroups = await fetchInstanceGroups(config, inst.rawName);
        for (const item of rawGroups) {
          const jid = String(item.id || item.jid || item.remoteJid || "").trim();
          if (!jid || !jid.endsWith("@g.us")) continue;

          const groupSubject = item.subject || item.name || item.groupName || item.title || "";
          const existing = mergedMap.get(jid);
          if (existing) {
            if (groupSubject) {
              existing.name = groupSubject;
              existing.subject = groupSubject;
            }
            existing.isGroup = true;
            existing.type = "group";
          } else {
            mergedMap.set(jid, {
              id: jid,
              name: groupSubject || "未命名群组",
              subject: groupSubject,
              pushName: "",
              verifiedName: "",
              isGroup: true,
              isSaved: true,
              type: "group"
            });
          }
        }

        const combinedContacts = Array.from(mergedMap.values());
        for (const item of combinedContacts) {
          const jid = String(item.id || "").trim();
          if (!jid) continue;

          const isLid = jid.endsWith("@lid");
          const isGroup = item.isGroup === true || item.type === "group" || jid.endsWith("@g.us");
          const isIndividual = jid.endsWith("@s.whatsapp.net") || jid.endsWith("@c.us") || isLid;

          if (!isGroup && !isIndividual) continue;

          // 自动过滤没有昵称且以 @lid 结尾的联系人 (群组优先取 subject)
          const name = item.subject || item.name || item.pushName || item.verifiedName || "";
          if (isLid && !name.trim()) {
            continue;
          }

          const rawId = jid.split("@")[0];
          const rawPhone = isGroup 
            ? jid 
            : (isLid ? `${rawId.replace(/\D/g, "")}@lid` : rawId.replace(/\D/g, ""));
          if (!rawPhone) continue;

          // 全局去重 (防止多账号预览时出现完全相同的号码)
          if (previewPhonesSet.has(rawPhone)) {
            continue;
          }
          previewPhonesSet.add(rawPhone);

          const checkPhone = isGroup ? rawPhone.split("-")[0].replace(/\D/g, "") : rawPhone;
          const matchedRule = rules.find(r => checkPhone.startsWith(r.prefix));
          const market = matchedRule ? matchedRule.market : "";

          previewContacts.push({
            name: name || (isGroup ? "未命名群组" : "新联系人"),
            phone: rawPhone,
            isGroup: isGroup,
            type: isGroup ? "group" : (isLid ? "lid" : "individual"),
            market: market,
            instanceName: inst.rawName,
            pushName: item.pushName || "",
            isSaved: item.isSaved === true,
            jid: jid,
            exists: existingPhonesSet.has(rawPhone)
          });
        }
      }

      return NextResponse.json({
        success: true,
        contacts: previewContacts
      });
    }

    // ==================== 核心参数解析 (导入及同步) ====================
    let sourceId = "whatsapp_sync";
    let sourceName = "WhatsApp 同步";
    let description = "通过绑定的 WhatsApp 实例同步拉取的联系人";

    if (body.sourceId) {
      sourceId = body.sourceId;
      const [dsRows]: any = await conn.execute(
        "SELECT name, description FROM DataSource WHERE id = ? AND userId = ? LIMIT 1",
        [sourceId, userId]
      );
      if (dsRows[0]) {
        sourceName = dsRows[0].name;
        description = dsRows[0].description || "";
      }
    } else if (body.sourceName) {
      // 说明是手动导入，生成一个唯一的数据源 ID，并创建该数据源
      sourceId = "ds_" + Math.random().toString(36).slice(2, 22);
      sourceName = body.sourceName;
      description = body.description || "从 WhatsApp 实例手动导入的联系人";
      
      await conn.execute(
        "INSERT INTO DataSource (id, name, type, description, userId, createdAt, updatedAt) VALUES (?, ?, 'WHATSAPP', ?, ?, NOW(), NOW())",
        [sourceId, sourceName, description, userId]
      );
    } else {
      // 定时同步/自动同步 (Cron) 的兜底数据源
      await conn.execute(
        "INSERT IGNORE INTO DataSource (id, name, type, description, userId, createdAt, updatedAt) VALUES (?, ?, 'WHATSAPP', ?, ?, NOW(), NOW())",
        [sourceId, sourceName, description, userId]
      );
    }

    const duplicateStrategy = body.duplicateStrategy || "ALLOW";

    // 获取当前已存联系人（以防重复导入）
    const [existingContacts]: any = await conn.execute(
      "SELECT id, phone FROM Contact WHERE userId = ?",
      [userId]
    );

    // 如果策略不是 ALLOW，建立全局已存在联系人映射；如果是 ALLOW，则仅在当前请求批次内去重
    const localMap = new Map<string, string>();
    if (duplicateStrategy !== "ALLOW") {
      existingContacts.forEach((c: any) => localMap.set(c.phone, c.id));
    }

    let totalFetched = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalNotificationsSent = 0;
    const syncLogsDetails: any[] = [];

    // ==================== 路径 2: 勾选联系人导入 ====================
    if (body.contacts && Array.isArray(body.contacts)) {
      totalFetched = body.contacts.length;

      for (const item of body.contacts) {
        try {
          const rawPhone = String(item.phone || "").trim();
          if (!rawPhone) continue;

          const isGroup = item.isGroup === true;
          const isLid = rawPhone.endsWith("@lid");

          // 查找匹配的区号前缀规则进行分组统计和市场划分 (群聊采用群 ID 的第一部分前缀数字)
          const checkPhone = isGroup ? rawPhone.split("-")[0].replace(/\D/g, "") : rawPhone;
          const matchedRule = rules.find(r => checkPhone.startsWith(r.prefix));
          let market = item.market || (matchedRule ? matchedRule.market : "");

          // 合并从表单模板传来的默认标签
          const finalRelations = Array.from(new Set([
            isGroup ? "群组" : "个人",
            ...relationFromTemplate
          ]));

          const instName = item.instanceName || (activeInstances[0]?.rawName || "");
          const inst = activeInstances.find(i => i.rawName === instName) || activeInstances[0];

          const contactProperties: Record<string, any> = {};
          defaultFields.forEach(f => {
            if (!["relation", "标签", "关系标签", "是否有回应", "responded", "回复状态"].includes(f.key) && f.key) {
              contactProperties[f.key] = replacePlaceholders(f.value, item, inst ? inst.rawName : "", market, checkPhone, rawPhone, isGroup);
            }
          });

          // 如果前缀规则没有计算出 market，尝试从 contactProperties 提取，或给予默认值
          if (!market) {
            market = contactProperties["市场"] || contactProperties["market"] || contactProperties["Market"] || (isGroup ? "组群" : "其他地区");
          }

          const newProperties = {
            ...contactProperties,
            "实例": inst ? inst.rawName : "",
            "isGroup": isGroup
          };

          const existingId = localMap.get(rawPhone);
          if (duplicateStrategy === "SKIP" && existingId) {
            continue;
          }

          if (!existingId || duplicateStrategy === "ALLOW") {
            // 新建联系人
            const contactId = "ct_" + Math.random().toString(36).slice(2, 22) + Math.random().toString(36).slice(2, 10);
            
            await conn.execute(
              "INSERT INTO Contact (id, name, phone, market, relation, properties, sent, responded, userId, sourceId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NOW(), NOW())",
              [
                contactId,
                item.name || (isGroup ? "未命名群组" : "新联系人"),
                rawPhone,
                market,
                JSON.stringify(finalRelations),
                JSON.stringify(newProperties),
                respondedFromTemplate,
                userId,
                sourceId
              ]
            );
            localMap.set(rawPhone, contactId); // 插入本地映射防止同批次内的重复数据
            totalCreated++;

            // 发送新粉自通知消息 (仅限私聊且开启了通知)
            if (matchedRule && matchedRule.notify && matchedRule.template && !isGroup && inst) {
              try {
                const instOwnNumber = inst.ownerJid.split("@")[0];
                const todayStr = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
                const notifyText = matchedRule.template
                  .replace(/{phone}/g, rawPhone)
                  .replace(/{market}/g, market)
                  .replace(/{date}/g, todayStr)
                  .replace(/{today}/g, todayStr);

                const sendRes = await fetch(`${config.url}/message/sendText/${inst.rawName}`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "apikey": config.apikey
                  },
                  body: JSON.stringify({
                    number: instOwnNumber,
                    text: notifyText
                  })
                });

                if (sendRes.ok) {
                  totalNotificationsSent++;
                }

                // 每次通知间隔 500ms
                await new Promise(resolve => setTimeout(resolve, 500));
              } catch (notifyErr: any) {
                console.error(`Failed to send WhatsApp notification for ${rawPhone}:`, notifyErr.message);
              }
            }
          } else {
            // 更新已存在联系人，进行字段、属性合并，保留已有的真实名称而不要被 fallback "新联系人" 覆盖
            const [cDetail]: any = await conn.execute(
              "SELECT name, relation, properties, sourceId FROM Contact WHERE id = ? LIMIT 1",
              [existingId]
            );
            
            const existingName = cDetail[0]?.name || "";
            let finalName = item.name;
            if (existingName && existingName !== "新联系人" && (item.name === "新联系人" || !item.name)) {
              finalName = existingName;
            }

            let existingRelations: string[] = [];
            if (cDetail[0]?.relation) {
              try {
                const parsed = typeof cDetail[0].relation === 'string' 
                  ? JSON.parse(cDetail[0].relation) 
                  : cDetail[0].relation;
                if (Array.isArray(parsed)) existingRelations = parsed;
              } catch {}
            }
            const mergedRelations = Array.from(new Set([...existingRelations, ...finalRelations]));

            let existingProps: any = {};
            if (cDetail[0]?.properties) {
              try {
                existingProps = typeof cDetail[0].properties === 'string' 
                  ? JSON.parse(cDetail[0].properties) 
                  : cDetail[0].properties;
              } catch {}
            }
            const mergedProperties = {
              ...existingProps,
              ...newProperties
            };

            const currentSourceId = cDetail[0]?.sourceId || "";
            let finalSourceId = currentSourceId;
            if ((!currentSourceId || currentSourceId === "whatsapp_sync") && sourceId !== "whatsapp_sync") {
              finalSourceId = sourceId;
            }

            await conn.execute(
              "UPDATE Contact SET name = ?, market = COALESCE(NULLIF(market, ''), ?), relation = ?, properties = ?, responded = ?, sourceId = ?, updatedAt = NOW() WHERE id = ? AND userId = ?",
              [
                finalName,
                market,
                JSON.stringify(mergedRelations),
                JSON.stringify(mergedProperties),
                respondedFromTemplate,
                finalSourceId,
                existingId,
                userId
              ]
            );
            totalUpdated++;
          }
        } catch (itemErr: any) {
          console.error(`Error importing contact ${item.phone}:`, itemErr);
        }
      }

      syncLogsDetails.push({
        instanceName: Array.isArray(targetInstanceName) ? targetInstanceName.join(",") : targetInstanceName,
        status: "SUCCESS",
        fetched: totalFetched,
        created: totalCreated,
        updated: totalUpdated,
        notified: totalNotificationsSent
      });

    } else {
      // ==================== 路径 3: 默认全同步 (Cron 自动化流程) ====================
      for (const inst of activeInstances) {
        try {
          // 7.1 获取实例下的联系人列表
          let rawContacts: any[] = [];
          try {
            const contactsRes = await fetch(`${config.url}/chat/findContacts/${inst.rawName}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": config.apikey
              },
              body: JSON.stringify({}),
              cache: "no-store"
            });

            if (contactsRes.ok) {
              const temp = await contactsRes.json();
              if (Array.isArray(temp)) {
                rawContacts = temp;
              } else if (temp && typeof temp === 'object') {
                if (Array.isArray(temp.data)) {
                  rawContacts = temp.data;
                } else if (Array.isArray(temp.contacts)) {
                  rawContacts = temp.contacts;
                } else if (Array.isArray(temp.contacts?.contacts)) {
                  rawContacts = temp.contacts.contacts;
                }
              }
            }
          } catch (e) {
            console.error(`Failed to fetch contacts for ${inst.rawName}:`, e);
          }

          // 7.2 获取实例下的聊天列表 (用于拉取没有保存在通讯录中的个人对话)
          let rawChats: any[] = [];
          try {
            const chatsRes = await fetch(`${config.url}/chat/findChats/${inst.rawName}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": config.apikey
              },
              body: JSON.stringify({}),
              cache: "no-store"
            });
            if (chatsRes.ok) {
              const temp = await chatsRes.json();
              if (Array.isArray(temp)) {
                rawChats = temp;
              } else if (temp && typeof temp === 'object') {
                if (Array.isArray(temp.data)) {
                  rawChats = temp.data;
                } else if (Array.isArray(temp.chats)) {
                  rawChats = temp.chats;
                }
              }
            }
          } catch (e) {
            console.error(`Failed to fetch chats for ${inst.rawName}:`, e);
          }

          // 合并并去重，按 JID 进行合并
          const mergedMap = new Map<string, any>();

          for (const item of rawContacts) {
            const jid = String(item.remoteJid || item.id || "").trim();
            if (!jid) continue;
            
            mergedMap.set(jid, {
              id: jid,
              name: item.name || item.pushName || item.verifiedName || "",
              pushName: item.pushName || "",
              verifiedName: item.verifiedName || "",
              isGroup: item.isGroup === true || item.type === "group" || jid.endsWith("@g.us"),
              isSaved: item.isSaved === true || item.isSaved === "true",
              type: item.type || (jid.endsWith("@g.us") ? "group" : "user")
            });
          }

          for (const item of rawChats) {
            const jid = String(item.remoteJid || item.id || "").trim();
            if (!jid) continue;

            const isGroup = item.isGroup === true || item.type === "group" || jid.endsWith("@g.us");
            const existing = mergedMap.get(jid);
            if (existing) {
              existing.name = existing.name || item.name || item.pushName || "";
              existing.pushName = existing.pushName || item.pushName || "";
              if (item.isSaved !== undefined) {
                existing.isSaved = item.isSaved === true || item.isSaved === "true";
              }
            } else {
              mergedMap.set(jid, {
                id: jid,
                name: item.name || item.pushName || "",
                pushName: item.pushName || "",
                verifiedName: "",
                isGroup: isGroup,
                isSaved: item.isSaved === true || item.isSaved === "true",
                type: item.type || (isGroup ? "group" : "user")
              });
            }
          }

          const combinedContacts = Array.from(mergedMap.values());
          if (combinedContacts.length === 0) continue;

          const instOwnNumber = inst.ownerJid.split("@")[0];
          let instFetched = 0;
          let instCreated = 0;
          let instUpdated = 0;
          let instNotified = 0;

          // 7.3 逐个过滤、比对、入库
          for (const item of combinedContacts) {
            const jid = String(item.id || "").trim();
            if (!jid) continue;

            const isLid = jid.endsWith("@lid");
            const isGroup = item.isGroup === true || item.type === "group" || jid.endsWith("@g.us");
            const isIndividual = jid.endsWith("@s.whatsapp.net") || jid.endsWith("@c.us") || isLid;

            // 保留个人联系人和群聊
            if (!isGroup && !isIndividual) continue;

            // 自动过滤没有昵称且以 @lid 结尾的联系人
            const name = item.name || item.pushName || item.verifiedName || "";
            if (isLid && !name.trim()) {
              continue;
            }

            const rawId = jid.split("@")[0];
            const rawPhone = isGroup 
              ? jid 
              : (isLid ? `${rawId.replace(/\D/g, "")}@lid` : rawId.replace(/\D/g, ""));
            if (!rawPhone) continue;

            // 查找匹配的区号前缀规则进行分组统计和市场划分 (群聊采用群 ID 的第一部分前缀数字)
            const checkPhone = isGroup ? rawPhone.split("-")[0].replace(/\D/g, "") : rawPhone;
            const matchedRule = rules.find(r => checkPhone.startsWith(r.prefix));

            // 自动同步 (Cron) 时，如果配置了规则但没匹配到前缀，则跳过以防污染数据库
            const isCron = isAuthorizedInternal(req);
            if (isCron && !matchedRule) {
              continue;
            }

            instFetched++;
            let market = matchedRule ? matchedRule.market : "";

            // 合并从表单模板传来的默认标签
            const finalRelations = Array.from(new Set([
              isGroup ? "群组" : "个人",
              ...relationFromTemplate
            ]));

            const contactProperties: Record<string, any> = {};
            defaultFields.forEach(f => {
              if (!["relation", "标签", "关系标签", "是否有回应", "responded", "回复状态"].includes(f.key) && f.key) {
                contactProperties[f.key] = replacePlaceholders(f.value, item, inst.rawName, market, checkPhone, rawPhone, isGroup);
              }
            });

            if (!market) {
              market = contactProperties["市场"] || contactProperties["market"] || contactProperties["Market"] || (isGroup ? "组群" : "其他地区");
            }

            const newProperties = {
              ...contactProperties,
              "实例": inst.rawName,
              "isGroup": isGroup
            };

            const existingId = localMap.get(rawPhone);
            if (!existingId) {
              // 新建联系人
              const contactId = "ct_" + Math.random().toString(36).slice(2, 22) + Math.random().toString(36).slice(2, 10);
              
              await conn.execute(
                "INSERT INTO Contact (id, name, phone, market, relation, properties, sent, responded, userId, sourceId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NOW(), NOW())",
                [
                  contactId,
                  name,
                  rawPhone,
                  market,
                  JSON.stringify(finalRelations),
                  JSON.stringify(newProperties),
                  respondedFromTemplate,
                  userId,
                  sourceId
                ]
              );
              localMap.set(rawPhone, contactId); // 插入本地映射防止同批次内的重复数据
              instCreated++;

              // 发送新粉自通知消息 (仅限私聊且开启了通知)
              if (matchedRule && matchedRule.notify && matchedRule.template && !isGroup) {
                try {
                  const todayStr = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
                  const notifyText = matchedRule.template
                    .replace(/{phone}/g, rawPhone)
                    .replace(/{market}/g, market)
                    .replace(/{date}/g, todayStr)
                    .replace(/{today}/g, todayStr);

                  const sendRes = await fetch(`${config.url}/message/sendText/${inst.rawName}`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "apikey": config.apikey
                    },
                    body: JSON.stringify({
                      number: instOwnNumber,
                      text: notifyText
                    })
                  });

                  if (sendRes.ok) {
                    instNotified++;
                  }

                  // 每次通知间隔 500ms
                  await new Promise(resolve => setTimeout(resolve, 500));
                } catch (notifyErr: any) {
                  console.error(`Failed to send WhatsApp notification for ${rawPhone}:`, notifyErr.message);
                }
              }
            } else {
              // 更新已存在联系人，进行字段、属性合并，保留已有的真实名称而不要被 fallback "新联系人" 覆盖
              const [cDetail]: any = await conn.execute(
                "SELECT name, relation, properties, sourceId FROM Contact WHERE id = ? LIMIT 1",
                [existingId]
              );
              
              const existingName = cDetail[0]?.name || "";
              let finalName = name;
              if (existingName && existingName !== "新联系人" && (name === "新联系人" || !name)) {
                finalName = existingName;
              }

              let existingRelations: string[] = [];
              if (cDetail[0]?.relation) {
                try {
                  const parsed = typeof cDetail[0].relation === 'string' 
                    ? JSON.parse(cDetail[0].relation) 
                    : cDetail[0].relation;
                  if (Array.isArray(parsed)) existingRelations = parsed;
                } catch {}
              }
              const mergedRelations = Array.from(new Set([...existingRelations, ...finalRelations]));

              let existingProps: any = {};
              if (cDetail[0]?.properties) {
                try {
                  existingProps = typeof cDetail[0].properties === 'string' 
                    ? JSON.parse(cDetail[0].properties) 
                    : cDetail[0].properties;
                } catch {}
              }
              const mergedProperties = {
                ...existingProps,
                ...newProperties
              };

              const currentSourceId = cDetail[0]?.sourceId || "";
              let finalSourceId = currentSourceId;
              if ((!currentSourceId || currentSourceId === "whatsapp_sync") && sourceId !== "whatsapp_sync") {
                finalSourceId = sourceId;
              }

              await conn.execute(
                "UPDATE Contact SET name = ?, market = COALESCE(NULLIF(market, ''), ?), relation = ?, properties = ?, responded = ?, sourceId = ?, updatedAt = NOW() WHERE id = ? AND userId = ?",
                [
                  finalName,
                  market,
                  JSON.stringify(mergedRelations),
                  JSON.stringify(mergedProperties),
                  respondedFromTemplate,
                  finalSourceId,
                  existingId,
                  userId
                ]
              );
              instUpdated++;
            }
          }

          totalFetched += instFetched;
          totalCreated += instCreated;
          totalUpdated += instUpdated;
          totalNotificationsSent += instNotified;

          syncLogsDetails.push({
            instanceName: inst.rawName,
            status: "SUCCESS",
            fetched: instFetched,
            created: instCreated,
            updated: instUpdated,
            notified: instNotified
          });

        } catch (instErr: any) {
          console.error(`Error syncing instance ${inst.rawName}:`, instErr);
          syncLogsDetails.push({
            instanceName: inst.rawName,
            status: "FAILED",
            error: instErr.message
          });
        }
      }
    }

    // 8. 记录同步记录日志
    const summaryMsg = `WhatsApp同步完成：共读取到 ${totalFetched} 条有效联系人，新增入库 ${totalCreated} 条，更新 ${totalUpdated} 条，成功发送自通知消息 ${totalNotificationsSent} 条。`;
    await conn.execute(
      "INSERT INTO SyncLog (syncType, status, summary, details, userId) VALUES ('WHATSAPP_SYNC', ?, ?, ?, ?)",
      [
        totalCreated > 0 || totalUpdated > 0 ? "SUCCESS" : "WARNING",
        summaryMsg,
        JSON.stringify({ targetInstanceName, details: syncLogsDetails }, null, 2),
        userId
      ]
    );

    return NextResponse.json({
      success: true,
      summary: summaryMsg,
      synced: totalFetched,
      created: totalCreated,
      updated: totalUpdated,
      notified: totalNotificationsSent,
      details: syncLogsDetails,
      sourceId: sourceId
    });

  } catch (e: any) {
    console.error("WhatsApp sync error:", e);
    // 写入错误日志
    try {
      await conn.execute(
        "INSERT INTO SyncLog (syncType, status, summary, details, userId) VALUES ('WHATSAPP_SYNC', 'FAILED', ?, ?, ?)",
        [
          `WhatsApp同步失败: ${e.message.substring(0, 100)}`,
          JSON.stringify({ error: e.message, stack: e.stack }, null, 2),
          userId
        ]
      );
    } catch (logErr) {
      console.error("Failed to write failed SyncLog:", logErr);
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
