import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import { Client } from "@notionhq/client";

function cleanPhoneString(rawPhone: string): string {
  if (!rawPhone) return "";
  const trimmed = rawPhone.trim();
  if (trimmed.endsWith("@g.us")) {
    const rawId = trimmed.split("@")[0];
    return `${rawId.replace(/\D/g, "")}@g.us`;
  }
  if (trimmed.endsWith("@lid")) {
    const rawId = trimmed.split("@")[0];
    return `${rawId.replace(/\D/g, "")}@lid`;
  }
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  return (hasPlus ? "+" : "") + digits;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  
  try {
    const body = await req.json().catch(() => ({}));
    const { 
      sourceIds, 
      targetSourceName, 
      saveMode = "NEW", 
      targetSourceId, 
      columnSettings = {}, 
      autoSyncNotion = false 
    } = body;

    if (!sourceIds || !Array.isArray(sourceIds) || sourceIds.length === 0) {
      return NextResponse.json({ error: "请选择至少一个要合并的数据库" }, { status: 400 });
    }
    if (saveMode === "NEW" && (!targetSourceName || !targetSourceName.trim())) {
      return NextResponse.json({ error: "请输入合并后的新数据库名称" }, { status: 400 });
    }
    if (saveMode === "EXISTING" && !targetSourceId) {
      return NextResponse.json({ error: "请选择要保存的现有数据库" }, { status: 400 });
    }

    // 1. 获取选定数据源的凭证信息 (用于判定是否为 Notion 类型的源，并用于后续自动归档)
    const dsPlaceholders = sourceIds.map(() => "?").join(",");
    const [dsRows]: any = await conn.execute(
      `SELECT id, type, notionSecret, notionDatabaseId FROM DataSource WHERE userId = ? AND id IN (${dsPlaceholders})`,
      [userId, ...sourceIds]
    );
    const dsMap = new Map<string, any>();
    dsRows.forEach((r: any) => dsMap.set(r.id, r));

    // 2. 获取选定数据源的联系人
    const placeholders = sourceIds.map(() => "?").join(",");
    const query = `
      SELECT id, name, phone, market, relation, properties, sourceId, stepId, priority, note, orderIndex
      FROM Contact 
      WHERE userId = ? AND sourceId IN (${placeholders})
    `;
    const [rows]: any = await conn.execute(query, [userId, ...sourceIds]);

    if (rows.length === 0) {
      return NextResponse.json({ error: "所选数据源中没有联系人数据" }, { status: 400 });
    }

    // 3. 按照清洗后的电话号码进行分组
    const phoneGroups = new Map<string, any[]>();
    rows.forEach((contact: any) => {
      let rawPhone = contact.phone || "";
      if (rawPhone.includes(",") || rawPhone.includes(":") || rawPhone.includes("：")) {
        const parts = rawPhone.split(/[,;\n\r]+/);
        if (parts.length > 0) {
          const firstPart = parts[0].trim();
          const match = firstPart.match(/^([^:+0-9]+)\s*[:：]\s*(.+)$/);
          rawPhone = match ? match[2].trim() : firstPart;
        }
      }
      
      const cleanPhone = cleanPhoneString(rawPhone);
      if (!cleanPhone) return;

      if (!phoneGroups.has(cleanPhone)) {
        phoneGroups.set(cleanPhone, []);
      }
      phoneGroups.get(cleanPhone)!.push(contact);
    });

    const toInsertContacts: any[] = [];
    let mergedCount = 0;
    const pagesToArchive: Array<{ pageId: string; secret: string }> = [];

    // 创建或指定新数据源 ID
    const destSourceId = saveMode === "EXISTING" ? targetSourceId : "ds_" + Math.random().toString(36).slice(2, 22);

    // 4. 开始分析每一组重复项
    for (const [phone, group] of phoneGroups.entries()) {
      if (group.length === 1) {
        const contact = group[0];
        
        // 判定新 ID：如果是覆盖现有源，且该联系人原 sourceId 不是目标源，需重新生成 ID 以防主键冲突
        let contactId = contact.id;
        if (saveMode === "EXISTING" && contact.sourceId !== destSourceId) {
          contactId = "ct_" + Math.random().toString(36).slice(2, 22) + Math.random().toString(36).slice(2, 10);
        } else if (saveMode === "NEW") {
          contactId = "ct_" + Math.random().toString(36).slice(2, 22) + Math.random().toString(36).slice(2, 10);
        }

        toInsertContacts.push({
          id: contactId,
          name: contact.name || "未命名",
          phone: phone,
          market: contact.market || null,
          relation: contact.relation || "[]",
          properties: contact.properties || "{}",
          stepId: contact.stepId || null,
          priority: contact.priority || "medium",
          note: contact.note || null,
          orderIndex: contact.orderIndex || 0
        });
        continue;
      }

      // 多于一个联系人，按照用户在勾选时确定的优先级顺序进行排序
      // 勾选越早 (在 sourceIds 中索引越靠前) 的数据源优先级越高，排序放在最前面作为 master 项
      const sorted = [...group].sort((a, b) => {
        const idxA = sourceIds.indexOf(a.sourceId);
        const idxB = sourceIds.indexOf(b.sourceId);
        // 如果不在列表中（兜底），给一个很大索引
        const posA = idxA === -1 ? 9999 : idxA;
        const posB = idxB === -1 ? 9999 : idxB;
        return posA - posB;
      });

      const master = sorted[0];
      const duplicates = sorted.slice(1);

      let masterName = master.name;
      let masterMarket = master.market;
      let masterStepId = master.stepId;
      let masterPriority = master.priority;
      let masterNote = master.note;
      let masterOrderIndex = master.orderIndex;
      
      let masterRelations: string[] = [];
      try {
        const parsed = typeof master.relation === 'string' ? JSON.parse(master.relation) : master.relation;
        if (Array.isArray(parsed)) masterRelations = parsed;
      } catch {}

      let masterProps: Record<string, any> = {};
      try {
        masterProps = typeof master.properties === 'string' ? JSON.parse(master.properties || "{}") : (master.properties || {});
      } catch {}

      // 读取针对各个字段的合并规则
      const nameSetting = columnSettings["姓名"] || columnSettings["name"] || "MERGE";
      const marketSetting = columnSettings["市场"] || columnSettings["market"] || "MERGE";
      const relationSetting = columnSettings["关系标签"] || columnSettings["relation"] || "MERGE";

      duplicates.forEach(dup => {
        // 1. 合并姓名 (仅在 MERGE 模式下填齐空白/无意义名字)
        if (nameSetting === "MERGE") {
          const isGeneric = !masterName || masterName === "未命名" || masterName === "新联系人" || masterName === "未命名群组";
          if (isGeneric && dup.name && dup.name !== "未命名" && dup.name !== "新联系人" && dup.name !== "未命名群组") {
            masterName = dup.name;
          }
        }

        // 2. 合并市场
        if (marketSetting === "MERGE") {
          if (!masterMarket && dup.market) {
            masterMarket = dup.market;
          }
        }

        // 3. 看板状态/备注字段默认填齐
        if (!masterStepId && dup.stepId) masterStepId = dup.stepId;
        if ((!masterNote || masterNote.trim() === "") && dup.note) masterNote = dup.note;

        // 4. 合并标签
        if (relationSetting === "MERGE") {
          try {
            const parsed = typeof dup.relation === 'string' ? JSON.parse(dup.relation) : dup.relation;
            if (Array.isArray(parsed)) {
              masterRelations = Array.from(new Set([...masterRelations, ...parsed]));
            }
          } catch {}
        }

        // 5. 合并自定义列属性 JSON
        try {
          const dupProps = typeof dup.properties === 'string' ? JSON.parse(dup.properties || "{}") : (dup.properties || {});
          Object.keys(dupProps).forEach(k => {
            const kSetting = columnSettings[k] || "MERGE";
            if (kSetting === "MERGE") {
              if (masterProps[k] === undefined || masterProps[k] === null || masterProps[k] === "") {
                masterProps[k] = dupProps[k];
              }
            }
          });
        } catch {}

        // 6. 收集需要进行 Notion 端自动归档的重复页面 ID
        if (autoSyncNotion) {
          const dsInfo = dsMap.get(dup.sourceId);
          if (dsInfo && dsInfo.type === 'NOTION' && dsInfo.notionSecret) {
            pagesToArchive.push({ pageId: dup.id, secret: dsInfo.notionSecret });
          }
        }
      });

      // 确定合并后插入的 ID
      let contactId = master.id;
      if (saveMode === "EXISTING" && master.sourceId !== destSourceId) {
        contactId = "ct_" + Math.random().toString(36).slice(2, 22) + Math.random().toString(36).slice(2, 10);
      } else if (saveMode === "NEW") {
        contactId = "ct_" + Math.random().toString(36).slice(2, 22) + Math.random().toString(36).slice(2, 10);
      }

      toInsertContacts.push({
        id: contactId,
        name: masterName || "未命名",
        phone: phone,
        market: masterMarket || null,
        relation: JSON.stringify(masterRelations),
        properties: JSON.stringify(masterProps),
        stepId: masterStepId || null,
        priority: masterPriority || "medium",
        note: masterNote || null,
        orderIndex: masterOrderIndex || 0
      });

      mergedCount += duplicates.length;
    }

    // 5. 事务批量执行插入和更新
    await conn.beginTransaction();
    try {
      if (saveMode === "EXISTING") {
        // A. 覆盖现有数据库：先删除该数据源下原有的所有联系人数据
        await conn.execute("DELETE FROM Contact WHERE userId = ? AND sourceId = ?", [userId, destSourceId]);
      } else {
        // B. 新建数据源：向 DataSource 表中插入新数据源记录
        await conn.execute(
          "INSERT INTO DataSource (id, name, type, description, userId, createdAt, updatedAt) VALUES (?, ?, 'EXCEL', ?, ?, NOW(), NOW())",
          [destSourceId, targetSourceName, `由 ${sourceIds.length} 个数据源去重合并生成`, userId]
        );
      }

      // C. 批量插入合并去重后的联系人数据
      for (const contact of toInsertContacts) {
        await conn.execute(
          `INSERT INTO Contact (id, name, phone, market, relation, properties, sourceId, stepId, priority, note, orderIndex, userId, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            contact.id,
            contact.name,
            contact.phone,
            contact.market,
            contact.relation,
            contact.properties,
            destSourceId,
            contact.stepId,
            contact.priority,
            contact.note,
            contact.orderIndex,
            userId
          ]
        );
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }

    // 6. 后台异步执行 Notion 重复页面的归档 (方案 A)
    if (autoSyncNotion && pagesToArchive.length > 0) {
      // 采用异步自执行函数在后台默默运行，不阻塞 HTTP 响应
      (async () => {
        console.log(`[Notion Archive] Background worker started. Need to archive ${pagesToArchive.length} pages.`);
        for (const item of pagesToArchive) {
          try {
            const notion = new Client({ auth: item.secret });
            await notion.pages.update({
              page_id: item.pageId,
              archived: true
            });
            console.log(`[Notion Archive] Archived duplicate page: ${item.pageId} ✅`);
          } catch (archiveErr: any) {
            console.error(`[Notion Archive] Failed to archive page ${item.pageId}:`, archiveErr.message);
          }
        }
        console.log(`[Notion Archive] Background worker completed.`);
      })();
    }

    return NextResponse.json({
      success: true,
      mergedCount,
      newSourceId: destSourceId,
      insertedCount: toInsertContacts.length,
      archivedCount: pagesToArchive.length
    });
  } catch (e: any) {
    console.error("[Deduplicate API] Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

