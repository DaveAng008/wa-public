import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import crypto from "crypto";
import { isAuthorizedInternal } from "@/lib/authToken";
import { mediaProxyUrl } from "@/lib/mediaSig";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

// Safe JSON parser helper
function safeParseJson(str: any, fallback: any = {}) {
  if (str === null || str === undefined) return fallback;
  if (typeof str !== 'string') return str;
  try {
    return JSON.parse(str);
  } catch (e) {
    console.error("[Trigger API] JSON parse error:", e, "for raw value:", str);
    return fallback;
  }
}

// 自动清洗与规范化联系人 JID（对于群组自动检测并补齐 @g.us 后缀）
function normalizeContactJid(contact: any): string {
  let rawPhone = "";
  if (typeof contact === "string") {
    rawPhone = contact.trim();
  } else {
    rawPhone = String(contact?.phone || "").split(/[,;\n\r]+/)[0].trim();
  }
  if (!rawPhone) return "";

  // 1. 如果本身包含标准 WhatsApp 后缀，清洗多余空格/字符后直接返回
  if (rawPhone.includes("@g.us")) {
    const cleanId = rawPhone.split("@")[0].replace(/[^\d-]/g, "");
    return `${cleanId}@g.us`;
  }
  if (rawPhone.includes("@s.whatsapp.net")) {
    const cleanId = rawPhone.split("@")[0].replace(/[^\d]/g, "");
    return `${cleanId}@s.whatsapp.net`;
  }
  if (rawPhone.includes("@lid")) {
    const cleanId = rawPhone.split("@")[0].replace(/[^\d]/g, "");
    return `${cleanId}@lid`;
  }

  const market = String(contact?.market || "");
  const relationStr = typeof contact?.relation === 'string' 
    ? contact.relation 
    : JSON.stringify(contact?.relation || []);
  const properties = typeof contact?.properties === 'string' 
    ? safeParseJson(contact.properties, {}) 
    : (contact?.properties || {});

  // 2. 检查显式群组特征（市场、标签、扩展属性）
  const isMarkedAsGroup = 
    market === "组群" || market === "群组" || market.toLowerCase() === "group" ||
    relationStr.includes("群组") || relationStr.includes("组群") || relationStr.toLowerCase().includes("group") ||
    properties.isGroup === true || properties.type === "group";

  // 3. 检查 WhatsApp 群组固有编码规则（120363/120xx 开头的 17+ 位数字，或包含连字符的旧版群 ID）
  const cleanDigits = rawPhone.replace(/[^\d-]/g, "");
  const isGroupPattern = 
    /^120363\d{12}$/.test(cleanDigits) || 
    (cleanDigits.length >= 17 && cleanDigits.startsWith("120")) || 
    /^\d+-\d+$/.test(cleanDigits);

  if (isMarkedAsGroup || isGroupPattern) {
    return `${cleanDigits}@g.us`;
  }

  return rawPhone;
}


// Robust Date Parser supporting YYYY-MM-DD, YYYY/MM/DD, and Chinese date strings (e.g. 2027年5月31日, 5月31日)
function parseDateRobust(val: any): Date | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (!str) return null;

  // 1. Standard parsers
  const standardDate = new Date(str);
  if (!isNaN(standardDate.getTime())) {
    return standardDate;
  }

  // 2. Chinese format: YYYY年MM月DD日 (e.g., "2027年5月31日")
  const cnDateMatch = str.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (cnDateMatch) {
    const y = parseInt(cnDateMatch[1]);
    const m = parseInt(cnDateMatch[2]) - 1; // 0-indexed month
    const dd = parseInt(cnDateMatch[3]);
    const parsed = new Date(y, m, dd);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // 3. Chinese format without year: MM月DD日 (e.g., "5月31日")
  const cnMonthDayMatch = str.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (cnMonthDayMatch) {
    const y = new Date().getFullYear();
    const m = parseInt(cnMonthDayMatch[1]) - 1;
    const dd = parseInt(cnMonthDayMatch[2]);
    const parsed = new Date(y, m, dd);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  
  if (!session?.user && !isAuthorizedInternal(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const conn = await getConn();
  try {
    let userId = session?.user?.id;
    if (!userId && isAuthorizedInternal(req)) {
      const [ownerRows]: any = await conn.execute("SELECT userId FROM Campaign WHERE id = ?", [id]);
      if (ownerRows.length > 0) {
        userId = ownerRows[0].userId;
      } else {
        return NextResponse.json({ error: "活动不存在" }, { status: 404 });
      }
    }

    const [campaigns]: any = await conn.execute(`
      SELECT c.*, g.name as groupName, g.filterConfig 
      FROM Campaign c 
      LEFT JOIN \`Group\` g ON c.groupId = g.id 
      WHERE c.id = ? AND c.userId = ?
      LIMIT 1
    `, [id, userId as string]);
    
    if (campaigns.length === 0) {
      return NextResponse.json({ error: "活动不存在或无权限" }, { status: 404 });
    }
    const campaign = campaigns[0];
    
    // Support real-time preview of unsaved changes in UI
    const paramGroupId = req.nextUrl.searchParams.get("groupId");
    const paramSourceId = req.nextUrl.searchParams.get("sourceId");
    
    const activeGroupId = paramGroupId !== null ? paramGroupId : (campaign.groupId || "");
    const activeSourceId = paramSourceId !== null ? paramSourceId : (campaign.sourceId || "");
    
    let activeFilterConfig = campaign.filterConfig;
    if (activeGroupId && activeGroupId !== campaign.groupId) {
      const [gRows]: any = await conn.execute("SELECT filterConfig FROM `Group` WHERE id = ? AND userId = ? LIMIT 1", [activeGroupId, userId as string]);
      if (gRows.length > 0) {
        activeFilterConfig = gRows[0].filterConfig;
      } else {
        activeFilterConfig = null;
      }
    } else if (!activeGroupId) {
      activeFilterConfig = null;
    }

    // Query contacts matching the campaign targeting criteria
    let contactSql = "SELECT id, name, phone, market, relation, properties, sourceId, stepId, lastActivityAt FROM Contact WHERE userId = ? AND (phone IS NULL OR phone = '' OR phone NOT IN (SELECT phone FROM Blacklist WHERE userId = ? AND phone IS NOT NULL AND phone != ''))";
    const queryParams: any[] = [userId, userId];

    const previewCfg = activeGroupId && activeFilterConfig ? safeParseJson(activeFilterConfig, {}) : {};
    const effectivePreviewSourceId = activeSourceId || previewCfg.sourceId;

    if (effectivePreviewSourceId) {
      contactSql += " AND sourceId = ?";
      queryParams.push(effectivePreviewSourceId);
    }

    if (activeGroupId && activeFilterConfig) {
      const cfg = previewCfg;
      
      if (cfg.markets?.length > 0) {
        contactSql += ` AND market IN (${cfg.markets.map(() => "?").join(",")})`;
        queryParams.push(...cfg.markets);
      }
      
      if (cfg.relations?.length > 0) {
        const relationConditions = cfg.relations.map(() => "relation LIKE ?");
        const joiner = cfg.matchMode === "ALL" ? " AND " : " OR ";
        contactSql += ` AND (${relationConditions.join(joiner)})`;
        cfg.relations.forEach((r: string) => queryParams.push(`%${r}%`));
      }

      if (cfg.rules?.length > 0) {
        const ruleConditions: string[] = [];
        cfg.rules.forEach((rule: any) => {
          const { field, operator, value } = rule;
          if (!field || !operator) return;
          let sqlField = ["name", "phone", "market", "relation"].includes(field) 
            ? `\`${field}\`` 
            : `CASE WHEN JSON_VALID(properties) = 1 THEN JSON_UNQUOTE(JSON_EXTRACT(properties, '$."${field.replace(/"/g, '\\"').replace(/'/g, "''")}"')) ELSE NULL END`;

          switch (operator) {
            case "contains": ruleConditions.push(`${sqlField} LIKE ?`); queryParams.push(`%${value}%`); break;
            case "not_contains": ruleConditions.push(`(${sqlField} NOT LIKE ? OR ${sqlField} IS NULL)`); queryParams.push(`%${value}%`); break;
            case "equals": ruleConditions.push(`${sqlField} = ?`); queryParams.push(value); break;
            case "not_equals": ruleConditions.push(`(${sqlField} != ? OR ${sqlField} IS NULL)`); queryParams.push(value); break;
            case "is_empty": ruleConditions.push(`(${sqlField} IS NULL OR ${sqlField} = '' OR ${sqlField} = 'null')`); break;
            case "is_not_empty": ruleConditions.push(`(${sqlField} IS NOT NULL AND ${sqlField} != '' AND ${sqlField} != 'null')`); break;
          }
        });

        if (ruleConditions.length > 0) {
          const joiner = cfg.ruleMatchMode === "OR" ? " OR " : " AND ";
          contactSql += ` AND (${ruleConditions.join(joiner)})`;
        }
      }
    }

    contactSql += " ORDER BY id ASC";
    const [contacts]: any = await conn.execute(contactSql, queryParams);
    
    let excludedSet = new Set<string>();
    if (activeGroupId && activeFilterConfig) {
      const cfg = safeParseJson(activeFilterConfig, {});
      excludedSet = new Set(cfg.excludedIds || []);
    }

    const processedList = contacts.map((c: any) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      market: c.market,
      sourceId: c.sourceId,
      relation: typeof c.relation === 'string' && (c.relation.startsWith('[') || c.relation.startsWith('{')) ? safeParseJson(c.relation, c.relation) : c.relation,
      properties: safeParseJson(c.properties, {}),
      stepId: c.stepId,
      lastActivityAt: c.lastActivityAt,
      isExcluded: excludedSet.has(c.id)
    }));

    return NextResponse.json({ contacts: processedList });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  
  if (!session?.user && !isAuthorizedInternal(req)) {
    console.warn("[Trigger API] Unauthorized access attempt, session exists:", !!session?.user);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  console.log(`[Trigger API] Trigger endpoint called for campaign ID: ${id}`);

  let conn;
  try {
    conn = await getConn();
  } catch (dbErr: any) {
    console.error("[Trigger API] Database connection failed:", dbErr);
    return NextResponse.json({ error: "数据库连接失败", message: dbErr.message }, { status: 500 });
  }
  
  let batchRound: number | undefined;
  let batchSize: number | undefined;
  let targetContactId: string | undefined;
  
  try {
    const body = await req.json();
    if (body) {
      batchRound = body.batchRound;
      batchSize = body.batchSize;
      targetContactId = body.targetContactId;
      console.log(`[Trigger API] Received parameters - batchRound: ${batchRound}, batchSize: ${batchSize}, targetContactId: ${targetContactId}`);
    }
  } catch (e) {
    // ignore if body is not JSON
  }
  
  try {
    let userId = session?.user?.id;
    
    // 如果是通过内部令牌调用的，我们需要从活动表里查出这个活动属于哪个用户
    if (!userId && isAuthorizedInternal(req)) {
      const [ownerRows]: any = await conn.execute("SELECT userId FROM Campaign WHERE id = ?", [id]);
      if (ownerRows.length > 0) {
        userId = ownerRows[0].userId;
        console.log(`[Trigger API] Retrieved userId ${userId} from Campaign table via internal token`);
      } else {
        console.error(`[Trigger API] Campaign ID ${id} not found when calling via internal token`);
        return NextResponse.json({ error: "活动不存在" }, { status: 404 });
      }
    }

    const [campaigns]: any = await conn.execute(`
      SELECT c.*, g.name as groupName, g.filterConfig 
      FROM Campaign c 
      LEFT JOIN \`Group\` g ON c.groupId = g.id 
      WHERE c.id = ? AND c.userId = ?
      LIMIT 1
    `, [id, userId as string]);
    
    if (campaigns.length === 0) {
      console.error(`[Trigger API] Campaign ${id} not found or no permission for user ${userId}`);
      return NextResponse.json({ error: "活动不存在或无权限" }, { status: 404 });
    }
    const campaign = campaigns[0];
    console.log(`[Trigger API] Loaded campaign: "${campaign.name}" (Status: ${campaign.status}, Trigger Mode: ${safeParseJson(campaign.scheduleConfig).triggerType})`);

    const [settingsRows]: any = await conn.execute("SELECT * FROM AppSettings WHERE userId = ? LIMIT 1", [userId as string]);
    const settings = settingsRows[0] || {};

    const [userRows]: any = await conn.execute("SELECT apiKeys FROM User WHERE id = ? LIMIT 1", [userId as string]);
    const user = userRows[0] || {};

    const sc = safeParseJson(campaign.scheduleConfig || "{}");
    if (!sc.state) sc.state = {};

    if (sc.state.isSending) {
      console.warn(`[Trigger API] Campaign ${id} is already sending. Lock active.`);
      return NextResponse.json({
        success: false,
        message: "该活动已在后台发送中，请勿重复触发！"
      }, { status: 400 });
    }

    const isCron = !session?.user && isAuthorizedInternal(req);

    // 获取发送锁
    const tzNowLock = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const todayLockStr = `${tzNowLock.getFullYear()}-${String(tzNowLock.getMonth()+1).padStart(2,'0')}-${String(tzNowLock.getDate()).padStart(2,'0')}`;
    sc.state.isSending = true;
    // 写入发送中状态
    if (isCron && !targetContactId && (sc.triggerType || "MANUAL") === "SCHEDULED") {
      sc.state.lastRunDate = todayLockStr;
      sc.state.lastRunSlot = `${todayLockStr} ${sc.scheduledTime}`;
      sc.state.lastRunTimeMs = Date.now();
    }
    await conn.execute("UPDATE Campaign SET scheduleConfig = ? WHERE id = ?", [JSON.stringify(sc), id]);
    console.log(`[Trigger API] Acquired sending lock for campaign ${id}`);

    const triggerType = sc.triggerType || "MANUAL";

    const tzNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    const yyyy = tzNow.getFullYear();
    const mm = String(tzNow.getMonth() + 1).padStart(2, '0');
    const dd = String(tzNow.getDate()).padStart(2, '0');
    const todayDateStr = `${yyyy}-${mm}-${dd}`;

    if (isCron && !targetContactId && (triggerType === "BIRTHDAY" || triggerType === "DATE_ATTRIBUTE")) {
      if (sc.state?.lastDailyRunDate === todayDateStr) {
        console.log(`[Trigger API] Today's automated daily run has already occurred for campaign ${id} (Date: ${todayDateStr}). Skipping.`);
        return NextResponse.json({
          success: true,
          message: "今天已运行过该活动",
          contactsCount: 0
        });
      }
    }

    let contactList: any[] = [];
    if (targetContactId) {
      const [contacts]: any = await conn.execute("SELECT * FROM Contact WHERE id = ? AND userId = ?", [targetContactId, userId as string]);
      contactList = contacts;
      console.log(`[Trigger API] Running for single contact: ${contactList[0]?.name} (${contactList[0]?.phone})`);
    } else {
      let contactSql = "SELECT * FROM Contact WHERE userId = ? AND (phone IS NULL OR phone = '' OR phone NOT IN (SELECT phone FROM Blacklist WHERE userId = ? AND phone IS NOT NULL AND phone != ''))";
      const queryParams: any[] = [userId, userId];

      const runCfg = campaign.groupId && campaign.filterConfig ? safeParseJson(campaign.filterConfig, {}) : {};
      const effectiveRunSourceId = campaign.sourceId || runCfg.sourceId;

      if (effectiveRunSourceId) {
        contactSql += " AND sourceId = ?";
        queryParams.push(effectiveRunSourceId);
      }

      if (campaign.groupId && campaign.filterConfig) {
        const cfg = runCfg;

        if (cfg.markets?.length > 0) {
          contactSql += ` AND market IN (${cfg.markets.map(() => "?").join(",")})`;
          queryParams.push(...cfg.markets);
        }
        
        if (cfg.relations?.length > 0) {
          const relationConditions = cfg.relations.map(() => "relation LIKE ?");
          const joiner = cfg.matchMode === "ALL" ? " AND " : " OR ";
          contactSql += ` AND (${relationConditions.join(joiner)})`;
          cfg.relations.forEach((r: string) => queryParams.push(`%${r}%`));
        }

        if (cfg.rules?.length > 0) {
          const ruleConditions: string[] = [];
          cfg.rules.forEach((rule: any) => {
            const { field, operator, value } = rule;
            if (!field || !operator) return;
            let sqlField = ["name", "phone", "market", "relation"].includes(field) 
              ? `\`${field}\`` 
              : `CASE WHEN JSON_VALID(properties) = 1 THEN JSON_UNQUOTE(JSON_EXTRACT(properties, '$."${field.replace(/"/g, '\\"').replace(/'/g, "''")}"')) ELSE NULL END`;

            switch (operator) {
              case "contains": ruleConditions.push(`${sqlField} LIKE ?`); queryParams.push(`%${value}%`); break;
              case "not_contains": ruleConditions.push(`(${sqlField} NOT LIKE ? OR ${sqlField} IS NULL)`); queryParams.push(`%${value}%`); break;
              case "equals": ruleConditions.push(`${sqlField} = ?`); queryParams.push(value); break;
              case "not_equals": ruleConditions.push(`(${sqlField} != ? OR ${sqlField} IS NULL)`); queryParams.push(value); break;
              case "is_empty": ruleConditions.push(`(${sqlField} IS NULL OR ${sqlField} = '' OR ${sqlField} = 'null')`); break;
              case "is_not_empty": ruleConditions.push(`(${sqlField} IS NOT NULL AND ${sqlField} != '' AND ${sqlField} != 'null')`); break;
            }
          });

          if (ruleConditions.length > 0) {
            const joiner = cfg.ruleMatchMode === "OR" ? " OR " : " AND ";
            contactSql += ` AND (${ruleConditions.join(joiner)})`;
          }
        }
      }

      contactSql += " ORDER BY id ASC";
      const [contacts]: any = await conn.execute(contactSql, queryParams);
      console.log(`[Trigger API] Query fetched ${contacts.length} total contacts (before trigger filter logic)`);

      // 根据触发类型进行过滤
      if (triggerType === "BIRTHDAY") {
        let filteredContacts = contacts;
        if (campaign.groupId && campaign.filterConfig) {
          const cfg = safeParseJson(campaign.filterConfig, {});
          const excludedIds = new Set(cfg.excludedIds || []);
          filteredContacts = contacts.filter((c: any) => !excludedIds.has(c.id));
        }

        const bdayField = sc.birthdayField || "birthday";
        const notifiedBirthdays = sc.state?.notifiedBirthdays || {};
        contactList = filteredContacts.filter((c: any) => {
          const props = safeParseJson(c.properties, {});
          const bdayVal = props[bdayField];
          if (!bdayVal) return false;
          
          let isBirthdayToday = false;
          const parsedDate = parseDateRobust(bdayVal);
          if (parsedDate) {
            const pMonth = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const pDate = String(parsedDate.getDate()).padStart(2, '0');
            if (pMonth === mm && pDate === dd) isBirthdayToday = true;
          }
          return isBirthdayToday && notifiedBirthdays[c.id] !== todayDateStr;
        });
        console.log(`[Trigger API] BIRTHDAY filtering matched ${contactList.length} contacts`);
      } else if (triggerType === "DATE_ATTRIBUTE") {
        let filteredContacts = contacts;
        if (campaign.groupId && campaign.filterConfig) {
          const cfg = safeParseJson(campaign.filterConfig, {});
          const excludedIds = new Set(cfg.excludedIds || []);
          filteredContacts = contacts.filter((c: any) => !excludedIds.has(c.id));
        }

        const dateAttrField = sc.dateAttrField || "expire_date";
        const offsetDays = sc.dateAttrOffsetDays !== undefined ? Number(sc.dateAttrOffsetDays) : -10;
        const notifiedDateAttrs = sc.state?.notifiedDateAttrs || {};
        
        const offsetMs = offsetDays * 24 * 60 * 60 * 1000;
        const targetDate = new Date(tzNow.getTime() - offsetMs);
        const tyyyy = targetDate.getFullYear();
        const tmm = String(targetDate.getMonth() + 1).padStart(2, '0');
        const tdd = String(targetDate.getDate()).padStart(2, '0');
        const targetDateStr = `${tyyyy}-${tmm}-${tdd}`;

        contactList = filteredContacts.filter((c: any) => {
          const props = safeParseJson(c.properties, {});
          const dateVal = props[dateAttrField];
          if (!dateVal) return false;

          let isDateAttrMatching = false;
          const parsedDate = parseDateRobust(dateVal);
          if (parsedDate) {
            const pyyyy = parsedDate.getFullYear();
            const pmm = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const pdd = String(parsedDate.getDate()).padStart(2, '0');
            const contactDateStr = `${pyyyy}-${pmm}-${pdd}`;
            if (contactDateStr === targetDateStr) isDateAttrMatching = true;
          }
          return isDateAttrMatching && notifiedDateAttrs[c.id] !== String(dateVal);
        });
        console.log(`[Trigger API] DATE_ATTRIBUTE filtering matched ${contactList.length} contacts for date ${targetDateStr}`);
      } else if (triggerType === "COLUMN_TIMEOUT") {
        let filteredContacts = contacts;
        if (campaign.groupId && campaign.filterConfig) {
          const cfg = safeParseJson(campaign.filterConfig, {});
          const excludedIds = new Set(cfg.excludedIds || []);
          filteredContacts = contacts.filter((c: any) => !excludedIds.has(c.id));
        }

        const timeoutStepId = sc.timeoutStepId;
        const timeoutHours = sc.timeoutHours !== undefined ? Number(sc.timeoutHours) : 48;
        const notifiedTimeouts = sc.state?.notifiedTimeouts || {};

        if (!timeoutStepId) {
          contactList = [];
        } else {
          contactList = filteredContacts.filter((c: any) => {
            if (c.stepId !== timeoutStepId) return false;
            if (!c.lastActivityAt) return false;

            const lastActivityTime = new Date(c.lastActivityAt).getTime();
            const elapsedHours = (tzNow.getTime() - lastActivityTime) / (60 * 60 * 1000);
            const isTimedOut = elapsedHours >= timeoutHours;
            return isTimedOut && notifiedTimeouts[c.id] !== String(c.lastActivityAt);
          });
        }
        console.log(`[Trigger API] COLUMN_TIMEOUT filtering matched ${contactList.length} contacts`);
      } else if (triggerType === "COLUMN_ENTER") {
        // Without targetContactId, COLUMN_ENTER campaigns do not run in batch mode
        contactList = [];
        console.log(`[Trigger API] COLUMN_ENTER campaign called without targetContactId. Skipping batch run.`);
      } else {
        // MANUAL or SCHEDULED 批次切片：先滤除所有已被人群包排除的成员，得到纯净的有效目标联系人数组
        let validContacts = contacts;
        if (campaign.groupId && campaign.filterConfig) {
          const cfg = safeParseJson(campaign.filterConfig, {});
          const excludedIds = new Set(cfg.excludedIds || []);
          validContacts = contacts.filter((c: any) => !excludedIds.has(c.id));
        }

        if (batchRound !== undefined && batchSize !== undefined && batchRound > 0 && batchSize > 0) {
          const startIdx = (batchRound - 1) * batchSize;
          const endIdx = startIdx + batchSize;
          console.log(`[Trigger API] MANUAL/SCHEDULED batch slice on validContacts (total valid=${validContacts.length}): round ${batchRound}, size ${batchSize} (Indices: ${startIdx} to ${endIdx})`);
          
          // 对【纯净有效目标名单】进行精准分轮切片
          contactList = validContacts.slice(startIdx, endIdx);
        } else {
          contactList = validContacts;
        }
      }
    }

    if (contactList.length === 0) {
      console.log("[Trigger API] No contacts qualified for trigger. Returning early.");
      return NextResponse.json({ 
        success: true, 
        message: "没有符合条件的联系人，未触发发送",
        contactsCount: 0
      });
    }

    let materialsData: any[] = [];
    if (campaign.materialId) {
      const matIds = safeParseJson(campaign.materialId, []);
      const matIdsArr = Array.isArray(matIds) ? matIds : (campaign.materialId ? [campaign.materialId] : []);
      
      if (matIdsArr.length > 0) {
        const placeholders = matIdsArr.map(() => "?").join(",");
        const [materials]: any = await conn.execute(`SELECT * FROM Material WHERE id IN (${placeholders}) AND userId = ?`, [...matIdsArr, userId as string]);
        
        // 按照用户在前端选择 of ID 顺序对素材进行排序，确保发送顺序与选择顺序一致
        materialsData = materials.sort((a: any, b: any) => {
          return matIdsArr.indexOf(a.id.toString()) - matIdsArr.indexOf(b.id.toString());
        });
      }
    }

    // 根据用户的规则过滤素材
    if (!campaign.useRandom) {
      // 没打开随机选词，不能选择 RANDOM_GROUP 素材
      materialsData = materialsData.filter((mat: any) => mat.type !== "RANDOM_GROUP");
    }

    let sourceNotionSecret = "";
    let sourceNotionDatabaseId = "";
    if (campaign.sourceId) {
      try {
        const [dsRows]: any = await conn.execute("SELECT notionSecret, notionDatabaseId FROM DataSource WHERE id = ? AND userId = ? LIMIT 1", [campaign.sourceId, userId as string]);
        if (dsRows.length > 0) {
          sourceNotionSecret = dsRows[0].notionSecret || "";
          sourceNotionDatabaseId = dsRows[0].notionDatabaseId || "";
        }
      } catch (dsError) {
        console.error("[Trigger API] Failed to load DataSource details for campaign trigger", dsError);
      }
    }

    // Campaign 的 status ENUM 只有 DRAFT/ACTIVE/PAUSED，直接在后台发送，保持 ACTIVE 状态
    // 1. 启动发送前先记录 startedAt（可选，写入 scheduleConfig state）


    // 2. 更新通知时间等过滤条件状态（如果满足）
    let stateUpdated = false;
    if (!targetContactId) {
      if (triggerType === "BIRTHDAY") {
        if (!sc.state.notifiedBirthdays) sc.state.notifiedBirthdays = {};
        contactList.forEach(c => {
          sc.state.notifiedBirthdays[c.id] = todayDateStr;
        });
        stateUpdated = true;
      } else if (triggerType === "DATE_ATTRIBUTE") {
        if (!sc.state.notifiedDateAttrs) sc.state.notifiedDateAttrs = {};
        contactList.forEach(c => {
          const props = safeParseJson(c.properties, {});
          sc.state.notifiedDateAttrs[c.id] = String(props[sc.dateAttrField || "expire_date"]);
        });
        stateUpdated = true;
      } else if (triggerType === "COLUMN_TIMEOUT") {
        if (!sc.state.notifiedTimeouts) sc.state.notifiedTimeouts = {};
        contactList.forEach(c => {
          sc.state.notifiedTimeouts[c.id] = String(c.lastActivityAt);
        });
        stateUpdated = true;
      }
    }

    if (isCron && (triggerType === "BIRTHDAY" || triggerType === "DATE_ATTRIBUTE")) {
      sc.state.lastDailyRunDate = todayDateStr;
      sc.state.lastRunTimeMs = Date.now();
      stateUpdated = true;
    }

    if (stateUpdated) {
      await conn.execute("UPDATE Campaign SET scheduleConfig = ? WHERE id = ?", [JSON.stringify(sc), id]);
      console.log("[Trigger API] Saved updated campaign scheduleConfig state to DB.");
    }

    // 3. 确定发送的 baseUrl，如果请求来源是公共域名则直接以请求域名为主，防范开发阶段 NEXTAUTH_URL 残留 localhost 导致 Evolution API 访问 503 SSRF 拦截
    const reqOrigin = req.nextUrl.origin;
    const isLocalOrigin = reqOrigin.includes("localhost") || reqOrigin.includes("127.0.0.1") || reqOrigin.includes("::1");
    const finalBaseUrl = (!isLocalOrigin) ? reqOrigin : (process.env.NEXTAUTH_URL || reqOrigin);

    // 启动非阻塞后台群发任务
    startCampaignSending({
      campaignId: id,
      userId: userId as string,
      contacts: contactList,
      materials: materialsData,
      instanceName: campaign.instanceName || sc.instanceName || "",
      settings: {
        minDelay: settings.minDelay || 20,
        maxDelay: settings.maxDelay || 60,
      },
      campaignConfig: {
        useAi: campaign.useAi || false,
        aiPrompt: campaign.aiPrompt || "",
        aiModel: campaign.aiModel || ""
      },
      baseUrl: finalBaseUrl
    });

    return NextResponse.json({ 
      success: true, 
      message: `活动已在后台启动！本次将发往 ${contactList.length} 位联系人。请关注发送日志。`,
      contactsCount: contactList.length
    });

  } catch (e: any) {
    console.error("[Trigger API] Critical error during trigger execution:", e);
    // 失败时回滚状态为 ACTIVE（让用户可以重新触发）
    if (conn) {
      try {
        await conn.execute("UPDATE Campaign SET status = 'ACTIVE', updatedAt = NOW() WHERE id = ?", [id]);
      } catch (dbErr) {}
    }
    // 将真实错误暴露在 error 字段，方便前端显示
    return NextResponse.json({ error: e.message || "触发失败", detail: e.stack?.slice(0, 300) }, { status: 500 });
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

// 睡眠辅助
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 马来西亚时区日期与时间格式化辅助函数
function getMalaysiaTimeStr(date: Date = new Date()) {
  return date.toLocaleTimeString("zh-CN", { timeZone: "Asia/Kuala_Lumpur", hour12: false });
}

function getMalaysiaDateStr(date: Date = new Date()) {
  return date.toLocaleDateString("zh-CN", { timeZone: "Asia/Kuala_Lumpur" }).replace(/\//g, "/");
}

// 后台异步发送大厂
async function startCampaignSending({
  campaignId,
  userId,
  contacts,
  materials,
  instanceName: campaignInstanceName,
  settings,
  campaignConfig,
  baseUrl
}: {
  campaignId: string;
  userId: string;
  contacts: any[];
  materials: any[];
  instanceName: string;
  settings: { minDelay: number; maxDelay: number };
  campaignConfig: { useAi: boolean; aiPrompt: string; aiModel: string };
  baseUrl: string;
}) {
  const startTime = new Date();
  let conn;
  try {
    conn = await getConn();

    // 1. 获取用户的 Evolution API 配置
    const [settingsRows]: any = await conn.execute(
      "SELECT evolutionApiUrl, evolutionApiKey, notificationPhone, whatsappSyncConfig, maxSendLimit FROM AppSettings WHERE userId = ? LIMIT 1",
      [userId]
    );
    const appSettings = settingsRows[0] || {};
    const configUrl = (appSettings.evolutionApiUrl || "").trim().replace(/\/+$/, "");
    const configApiKey = (appSettings.evolutionApiKey || "").trim();

    if (!configUrl || !configApiKey) {
      throw new Error("Evolution API 未配置，发送终止。");
    }

    // 获取 API keys 用来调用 AI 改写
    const [userRows]: any = await conn.execute(
      "SELECT apiKeys FROM User WHERE id = ? LIMIT 1",
      [userId]
    );
    const user = userRows[0] || {};
    const apiKeys = typeof user.apiKeys === 'string' ? JSON.parse(user.apiKeys) : user.apiKeys || {};

    // 获取活动的配置（包括特定素材延迟、自定义报告收发实例/号码）
    const [campaignRows]: any = await conn.execute(
      "SELECT name, description, scheduleConfig FROM Campaign WHERE id = ? LIMIT 1",
      [campaignId]
    );
    const campaignRow = campaignRows[0] || {};
    const campaignScheduleConfig = safeParseJson(campaignRow.scheduleConfig || "{}", {});
    const materialDelays = campaignScheduleConfig.materialDelays || {};

    const sentHistoryList: string[] = [];

    // 解析活动指定实例，或从数据库查出用户绑定的第一个在线实例
    let resolvedInstanceName = campaignInstanceName;
    if (!resolvedInstanceName) {
      // 从 InstanceConfig 取出该用户所有实例名，逐一查在线状态
      const [icRows]: any = await conn.execute(
        "SELECT instanceName FROM InstanceConfig WHERE userId = ? ORDER BY id ASC",
        [userId]
      );
      for (const row of icRows) {
        const iName = row.instanceName;
        try {
          const stateRes = await fetch(`${configUrl}/instance/connectionState/${iName}`, {
            headers: { "apikey": configApiKey }
          });
          if (stateRes.ok) {
            const stateJson = await stateRes.json();
            const state = stateJson?.instance?.state || stateJson?.state || "";
            if (state === "open") {
              resolvedInstanceName = iName;
              console.log(`[Campaign Background] Auto-selected online instance: ${iName}`);
              break;
            }
          }
        } catch (e) {
          // ignore individual check error, try next
        }
      }
      if (!resolvedInstanceName && icRows.length > 0) {
        resolvedInstanceName = icRows[0].instanceName;
        console.warn(`[Campaign Background] No online instance found, falling back to first: ${resolvedInstanceName}`);
      }
    }
    if (!resolvedInstanceName) {
      throw new Error("未找到可用的 WhatsApp 实例，请在系统设置中绑定实例后重试。");
    }
    console.log(`[Campaign Background] Using instance: ${resolvedInstanceName}`);

    const maxSendLimit = Number(appSettings.maxSendLimit) || 0;
    let sentCountLast24h = 0;
    if (maxSendLimit > 0) {
      const [sentRows]: any = await conn.execute(
        `SELECT COUNT(*) as count 
         FROM SendLog s 
         JOIN Campaign c ON s.campaignId = c.id 
         WHERE c.instanceName = ? 
           AND s.status = 'SENT' 
           AND s.createdAt >= NOW() - INTERVAL 1 DAY`,
        [resolvedInstanceName]
      );
      sentCountLast24h = sentRows[0]?.count || 0;
      console.log(`[Campaign Background] Instance ${resolvedInstanceName} has sent ${sentCountLast24h} messages in the last 24h. Limit is ${maxSendLimit}.`);
    }

    // 2. 循环遍历每个联系人发送
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      
      const instanceName = resolvedInstanceName;
      const phoneJid = normalizeContactJid(contact);

      // 流量控制校验：如果已达到全局每日发送限制，则拦截并记录剩余发送失败
      if (maxSendLimit > 0 && sentCountLast24h >= maxSendLimit) {
        console.warn(`[Campaign Background] Instance ${instanceName} reached 24h max send limit (${maxSendLimit}). Blocking remaining contacts.`);
        for (let k = i; k < contacts.length; k++) {
          const skipContact = contacts[k];
          for (let m = 0; m < materials.length; m++) {
            const skipMat = materials[m];
            const logId = "log" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
            await conn.execute(
              `INSERT INTO SendLog (id, campaignId, phone, message, status, sentAt, error, userId, createdAt)
               VALUES (?, ?, ?, ?, 'FAILED', NULL, ?, ?, NOW())`,
              [
                logId,
                campaignId,
                skipContact.phone,
                skipMat.type === "TEXT" || skipMat.type === "RANDOM_GROUP" ? "已达24小时上限被拦截" : skipMat.url,
                `已达到实例 24 小时最大发送量限制 (${maxSendLimit})`,
                userId
              ]
            );
          }
        }
        break;
      }

      const contactProps = safeParseJson(contact.properties, {});

      // 依次发送每个素材
      for (let j = 0; j < materials.length; j++) {
        const mat = materials[j];

        // 计算随机延迟
        const specificDelay = materialDelays[mat.id];
        let min = campaignScheduleConfig.minDelay || settings.minDelay || 20;
        let max = campaignScheduleConfig.maxDelay || settings.maxDelay || 60;
        if (specificDelay) {
          min = parseInt(specificDelay.min) || min;
          max = parseInt(specificDelay.max) || max;
        }
        const randomDelaySeconds = Math.floor(Math.random() * (max - min + 1)) + min;

        // 构造发送文案
        let finalContent = "";
        let isTextMat = mat.type === "TEXT" || mat.type === "RANDOM_GROUP";
        
        if (mat.type === "TEXT") {
          finalContent = mat.content;
        } else if (mat.type === "RANDOM_GROUP") {
          try {
            const list = typeof mat.content === "string" ? JSON.parse(mat.content) : mat.content;
            if (Array.isArray(list) && list.length > 0) {
              const rIdx = Math.floor(Math.random() * list.length);
              finalContent = list[rIdx];
            } else {
              finalContent = String(mat.content);
            }
          } catch(e) {
            finalContent = String(mat.content);
          }
        } else {
          finalContent = mat.url;
        }

        // 替换占位符
        if (finalContent && typeof finalContent === "string") {
          finalContent = finalContent.replace(/\{name\}/g, contact.name || "");
          finalContent = finalContent.replace(/\{phone\}/g, contact.phone || "");
          finalContent = finalContent.replace(/\{note\}/g, contact.note || "");
          finalContent = finalContent.replace(/\{properties\.([a-zA-Z0-9_-]+)\}/g, (match: string, propKey: string) => {
            return contactProps[propKey] !== undefined ? String(contactProps[propKey]) : "";
          });
        }

        // AI 改写文案
        if (isTextMat && campaignConfig.useAi) {
          try {
            const selectedBrand = campaignConfig.aiModel?.includes("deepseek") ? "deepseek" : campaignConfig.aiModel?.includes("gpt") ? "openai" : "gemini";
            const apiKey = apiKeys[selectedBrand] || "";

            if (apiKey) {
              let apiUrl = "https://api.deepseek.com/chat/completions";
              if (selectedBrand === "openai") {
                apiUrl = "https://api.openai.com/v1/chat/completions";
              } else if (selectedBrand === "gemini") {
                apiUrl = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
              }

              const aiRes = await fetch(apiUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                  model: campaignConfig.aiModel || (selectedBrand === "deepseek" ? "deepseek-chat" : "gemini-2.5-pro"),
                  messages: [
                    { role: "system", content: "你是一位顶级的私域流量与文案高手。请帮我改写文案，保留链接、联系方式和Emoji。请直接输出改写结果，不要有任何多余问候。" },
                    { role: "user", content: `原案内容：\n${finalContent}\n\n改写要求：\n${campaignConfig.aiPrompt || "做表达上的微细修改，更加幽默生动"}` }
                  ],
                  temperature: 0.7
                })
              });

              if (aiRes.ok) {
                const aiJson = await aiRes.json();
                const aiRewriteText = aiJson.choices?.[0]?.message?.content;
                if (aiRewriteText) {
                  finalContent = aiRewriteText.trim();
                }
              }
            }
          } catch (aiErr) {
            console.error("[Campaign Background] AI Rewrite failed:", aiErr);
          }
        }

        // 调用 Evolution API 发送
        let sendSuccess = false;
        let errorMsg = null;
        let messageText = "";

        try {
          if (mat.type === "TEXT" || mat.type === "RANDOM_GROUP") {
            messageText = finalContent;
            const isGroup = phoneJid.endsWith("@g.us");
            const res = await fetch(`${configUrl}/message/sendText/${instanceName}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": configApiKey
              },
              body: JSON.stringify({
                number: phoneJid,
                text: finalContent,
                options: isGroup ? { isGroup: true } : {}
              })
            });

            if (res.ok) {
              sendSuccess = true;
            } else {
              const errBody = await res.text();
              let detailMsg = errBody;
              try {
                const errObj = JSON.parse(errBody);
                const msg = errObj?.response?.message || errObj?.message || errObj?.error;
                if (Array.isArray(msg)) {
                  detailMsg = msg.map(m => typeof m === 'object' ? JSON.stringify(m) : String(m)).join("; ");
                } else if (typeof msg === 'object') {
                  detailMsg = JSON.stringify(msg);
                } else if (msg) {
                  detailMsg = String(msg);
                }
              } catch (e) {}
              errorMsg = `HTTP ${res.status}: ${detailMsg.slice(0, 250)}`;
              console.error(`[Campaign Background] Evolution API sendText failed:`, errorMsg);
            }
          } else {
            // 重定向使用系统的媒体代理服务接口（支持 INTERNAL_BASE_URL 环境变量，解决 Docker 容器间 NAT 回环与 SSL 无法内网解析的问题）
            let ext = ".jpg";
             if (mat.type === "VIDEO") ext = ".mp4";
             else if (mat.type === "AUDIO") ext = ".ogg";
             else if (mat.type === "DOCUMENT") ext = ".pdf";
            
            if (mat.url) {
              const urlParts = mat.url.split("?")[0].split("/");
              const lastPart = urlParts[urlParts.length - 1];
              if (lastPart.includes(".")) {
                const parsedExt = lastPart.substring(lastPart.lastIndexOf(".")).toLowerCase();
                if (parsedExt && parsedExt.length <= 5) {
                  ext = parsedExt;
                }
              }
            }

            const mediaBaseUrl = process.env.INTERNAL_BASE_URL || baseUrl;
            // 拼接符合规范的带后缀文件名路径，确保 Evolution API 和 Baileys 能够通过后缀名判断多媒体流并成功发送至 WhatsApp
            // 带 HMAC 签名：Evolution 服务端没有浏览器会话，靠签名才能取到媒体文件
            const finalMediaUrl = mediaProxyUrl(mediaBaseUrl, mat.id, ext);
            const mediaTypeMap: any = { IMAGE: "image", AUDIO: "audio", VIDEO: "video", DOCUMENT: "document" };
            const mediatype = mediaTypeMap[mat.type] || "image";
            
            let safeFileName = (mat.name || "file").replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, "");
            if (!safeFileName.toLowerCase().endsWith(ext)) {
              safeFileName += ext;
            }

            const typeNames: any = { IMAGE: "图片", AUDIO: "音频", VIDEO: "视频", DOCUMENT: "文件" };
            const typeName = typeNames[mat.type] || "媒体";
            messageText = `[${typeName}] ${mat.name || "未命名"}`;

            const isGroup = phoneJid.endsWith("@g.us");

            let targetUrl = `${configUrl}/message/sendMedia/${instanceName}`;
            let requestBody: any = {
              number: phoneJid,
              mediatype: mediatype,
              media: finalMediaUrl,
              fileName: safeFileName,
              caption: "",
              ptt: mat.type === "AUDIO",
              options: isGroup ? { isGroup: true } : {}
            };

            if (mat.type === "AUDIO") {
              targetUrl = `${configUrl}/message/sendWhatsAppAudio/${instanceName}`;
              requestBody = {
                number: phoneJid,
                options: isGroup ? { isGroup: true, delay: 1200, presence: "recording", encoding: true } : {
                  delay: 1200,
                  presence: "recording",
                  encoding: true
                },
                audio: finalMediaUrl,
                audioMessage: {
                  audio: finalMediaUrl
                }
              };
            }

            const res = await fetch(targetUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": configApiKey
              },
              body: JSON.stringify(requestBody)
            });

            if (res.ok) {
              sendSuccess = true;
            } else {
              const errBody = await res.text();
              let detailMsg = errBody;
              try {
                const errObj = JSON.parse(errBody);
                const msg = errObj?.response?.message || errObj?.message || errObj?.error;
                if (Array.isArray(msg)) {
                  detailMsg = msg.map(m => typeof m === 'object' ? JSON.stringify(m) : String(m)).join("; ");
                } else if (typeof msg === 'object') {
                  detailMsg = JSON.stringify(msg);
                } else if (msg) {
                  detailMsg = String(msg);
                }
              } catch (e) {}
              errorMsg = `HTTP ${res.status}: ${detailMsg.slice(0, 250)}`;
              console.error(`[Campaign Background] Evolution API sendMedia failed:`, errorMsg);
            }
          }
        } catch (sendErr: any) {
          errorMsg = sendErr.message || "Network Error";
          console.error("[Campaign Background] Evolution API Connection Error:", sendErr);
        }

        // 将发送记录存入 SendLog 日志表，确保前端能实时查看到统计和失败详情
        try {
          const logId = "log" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
          await conn.execute(
            `INSERT INTO SendLog (id, campaignId, phone, message, status, sentAt, error, userId, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              logId,
              campaignId,
              phoneJid,
              messageText,
              sendSuccess ? "SENT" : "FAILED",
              sendSuccess ? new Date() : null,
              errorMsg,
              userId,
              new Date() // 传入 Node 系统当前时间对象以确保时区（Asia/Kuala_Lumpur）一致，避免采用 DB 自带 NOW() 导致的 8 小时时差
            ]
          );
          if (sendSuccess) {
            sentCountLast24h++;
          }
        } catch (logDbErr) {
          console.error("[Campaign Background] Failed to write SendLog:", logDbErr);
        }

        // 素材间隔延时
        if (materials.length > 1 && j < materials.length - 1) {
          await sleep(randomDelaySeconds * 1000);
        }
      }

      // 3. 更新联系人已发送状态
      try {
        await conn.execute(
          "UPDATE Contact SET sent = 1, sendCount = COALESCE(sendCount, 0) + 1, lastSentAt = NOW() WHERE id = ? AND userId = ?",
          [contact.id, userId]
        );
        sentHistoryList.push(`${contact.name || "客户"} (${contact.phone})`);
      } catch (dbErr) {
        console.error("[Campaign Background] DB Update Contact status failed:", dbErr);
      }

      // 人与人之间随机延时
      if (i < contacts.length - 1) {
        const minDelay = settings.minDelay || 20;
        const maxDelay = settings.maxDelay || 60;
        const randomDelaySeconds = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        await sleep(randomDelaySeconds * 1000);
      }
    }

    // 4. 发送完成，状态重置回 ACTIVE（可继续触发下一次）
    await conn.execute(
      "UPDATE Campaign SET status = 'ACTIVE', updatedAt = NOW() WHERE id = ? AND userId = ?",
      [campaignId, userId]
    );
    console.log(`[Campaign Background] Finished sending to ${contacts.length} contacts. Status reset to ACTIVE.`);

    // 5. 管理员通知推送 (如果活动配置了报告接收号码，或全局配置了通知号码)
    let targetReportPhone = campaignScheduleConfig.reportReceiverPhone || "";
    if (!targetReportPhone) {
      // 自动获取发信实例绑定的手机号，实现默认“谁发谁收”报告，避免多租户用户报告交叉发往主号
      try {
        const listRes = await fetch(`${configUrl}/instance/fetchInstances`, {
          method: "GET",
          headers: { "apikey": configApiKey }
        });
        if (listRes.ok) {
          const listJson = await listRes.json();
          if (Array.isArray(listJson)) {
            const targetInst = listJson.find((item: any) => {
              const inst = item.instance ? { ...item.instance, ...item } : item;
              const name = inst.instanceName || inst.name || "";
              return name === resolvedInstanceName;
            });
            if (targetInst) {
              const inst = targetInst.instance ? { ...targetInst.instance, ...targetInst } : targetInst;
              const ownerJid = inst.ownerJid || inst.owner || "";
              const cleanOwnerPhone = ownerJid.split("@")[0].replace(/[^0-9]/g, "");
              if (cleanOwnerPhone) {
                targetReportPhone = cleanOwnerPhone;
                console.log(`[Campaign Background] Auto-detected report receiver phone from sender instance list: ${targetReportPhone}`);
              }
            }
          }
        }
      } catch (err) {
        console.error("[Campaign Background] Failed to fetch instances list for auto report receiver:", err);
      }

      // 兜底：如果还是拿不到，则使用系统全局通知号码
      if (!targetReportPhone) {
        targetReportPhone = appSettings.notificationPhone;
      }
    }

    if (targetReportPhone) {
      try {
        const endTime = new Date();
        const durationMs = endTime.getTime() - startTime.getTime();
        const durationMinutes = Math.floor(durationMs / 60000);
        const durationSeconds = Math.floor((durationMs % 60000) / 1000);
        const durationStr = durationMinutes > 0 ? `${durationMinutes}分${durationSeconds}秒` : `${durationSeconds}秒`;

        const todayStr = getMalaysiaDateStr(endTime);
        const startTimeStr = getMalaysiaTimeStr(startTime);
        const endTimeStr = getMalaysiaTimeStr(endTime);

        const summaryText = `✅ 任务执行完毕
📋 任务名称：${campaignRow.name || "未命名"}
📝 任务描述：${campaignRow.description || "无"}
📅 发送日期：${todayStr}
⏱️ 开始时间：${startTimeStr} (马华时间)
⏱️ 结束时间：${endTimeStr} (马华时间)
⏳ 任务耗时：${durationStr}
🔢 总计发送：${contacts.length} 条

名单详情：
` + (sentHistoryList.length > 0 ? sentHistoryList.map((item, idx) => `${idx + 1}. ${item}`).join('\n') : "无");

        // 优先使用活动配置中的报告发送实例，否则使用群发发信实例
        const reportSender = campaignScheduleConfig.reportSenderInstance || resolvedInstanceName;

        await fetch(`${configUrl}/message/sendText/${reportSender || configUrl}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": configApiKey
          },
          body: JSON.stringify({
            number: targetReportPhone,
            text: summaryText,
            options: {}
          })
        });
      } catch (notifyErr) {
        console.error("[Campaign Background] Admin notification sending failed:", notifyErr);
      }
    }

  } catch (err: any) {
    console.error("[Campaign Background Campaign Failed]", err);
    if (conn) {
      try {
        await conn.execute(
          "UPDATE Campaign SET status = 'ACTIVE', updatedAt = NOW() WHERE id = ? AND userId = ?",
          [campaignId, userId]
        );
        console.error("[Campaign Background] Sending failed, status reset to ACTIVE:", err.message);
      } catch (dbErr) {}
    }
  } finally {
    if (conn) {
      try {
        const [cRows]: any = await conn.execute("SELECT scheduleConfig FROM Campaign WHERE id = ? LIMIT 1", [campaignId]);
        if (cRows.length > 0) {
          const sc = typeof cRows[0].scheduleConfig === 'string' ? JSON.parse(cRows[0].scheduleConfig) : (cRows[0].scheduleConfig || {});
          if (!sc.state) sc.state = {};
          sc.state.isSending = false;
          await conn.execute("UPDATE Campaign SET scheduleConfig = ? WHERE id = ?", [JSON.stringify(sc), campaignId]);
          console.log(`[Campaign Background] Released sending lock for campaign ${campaignId}.`);
        }
      } catch (lockReleaseErr: any) {
        console.error("[Campaign Background] Failed to release sending lock:", lockReleaseErr.message);
      }
      await conn.end();
    }
  }
}
