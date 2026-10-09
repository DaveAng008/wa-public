import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

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
  // 如果是 WhatsApp 群组编码特征（120363/120xx 开头的 17+ 位数字，或含有连字符），保留/补齐 @g.us 后缀
  if (/^120363\d{12}$/.test(digits) || (digits.length >= 17 && digits.startsWith("120")) || /^\d+-\d+$/.test(trimmed)) {
    return `${digits}@g.us`;
  }
  return (hasPlus ? "+" : "") + digits;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session?.user?.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    let mapping: Record<string, string> | null = null;
    let selectedFields: string[] | null = null;
    let purge = false;
    let sourceId: string | null = null;

    try {
      const url = new URL(req.url);
      purge = url.searchParams.get("purge") === "true";

      const body = await req.json();
      if (body.mapping) mapping = body.mapping;
      if (body.selectedFields) selectedFields = body.selectedFields;
      if (body.sourceId && body.sourceId !== "all") sourceId = body.sourceId;
    } catch (e) {
      // Ignored — body 解析失败时使用默认值
    }

    // ─── 凭据读取逻辑：优先读取指定数据源 ────────────────────
    let notionSecret = "";
    let notionDatabaseId = "";

    // 1. 如果指定了数据源 ID，优先从 DataSource 表中读取凭据
    if (sourceId) {
      const [ds]: any = await conn.execute(
        "SELECT notionSecret, notionDatabaseId FROM DataSource WHERE id = ? AND userId = ? LIMIT 1",
        [sourceId, userId]
      );
      if (ds[0]) {
        notionSecret = ds[0].notionSecret || "";
        notionDatabaseId = ds[0].notionDatabaseId || "";
      }
    }

    // 2. 兜底：读取当前用户的 AppSettings
    if (!notionSecret || !notionDatabaseId) {
      const [userSettings]: any = await conn.execute(
        "SELECT notionSecret, notionDatabaseId FROM AppSettings WHERE userId = ? LIMIT 1",
        [userId]
      );
      notionSecret = userSettings[0]?.notionSecret || "";
      notionDatabaseId = userSettings[0]?.notionDatabaseId || "";
    }

    // 3. 再次兜底：读取全局默认设置（id='default'）
    if (!notionSecret || !notionDatabaseId) {
      const [defaultSettings]: any = await conn.execute(
        "SELECT notionSecret, notionDatabaseId FROM AppSettings WHERE id = 'default' LIMIT 1"
      );
      notionSecret = notionSecret || defaultSettings[0]?.notionSecret || "";
      notionDatabaseId = notionDatabaseId || defaultSettings[0]?.notionDatabaseId || "";
    }

    if (!notionSecret || !notionDatabaseId) {
      return NextResponse.json({
        error: "配置缺失，请先在「系统设置 → Notion 数据库」或数据源设置中保存 Integration Secret 和 Database ID"
      }, { status: 400 });
    }
    // ────────────────────────────────────────────────────────────────────

    const notion = new Client({ auth: notionSecret });
    const databaseId = notionDatabaseId;

    let allResults: any[] = [];
    let hasMore = true;
    let nextCursor: string | undefined = undefined;

    while (hasMore && allResults.length < 5000) {
      const response: any = await notion.databases.query({
        database_id: databaseId,
        start_cursor: nextCursor,
        page_size: 100,
      });
      allResults = [...allResults, ...response.results];
      hasMore = response.has_more;
      nextCursor = response.next_cursor || undefined;
    }

    if (allResults.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    const rows: any[][] = [];
    const debugList: any[] = [];
    for (const page of allResults) {
      const props = page.properties;

      let name = "未命名";
      let phone = "";
      let market = "";
      let relation = "[]";
      const extraProps: any = {};

      const extractValue = (val: any) => {
        if (!val) return null;
        try {
          const type = val.type;
          if (type === "title") return val.title?.[0]?.plain_text || null;
          if (type === "select") return val.select?.name || null;
          if (type === "multi_select") return val.multi_select?.map((m: any) => m.name) || null;
          if (type === "rich_text") return val.rich_text?.map((t: any) => t.plain_text).join("") || null;
          if (type === "date") return val.date?.start || null;
          if (type === "number") return val.number;
          if (type === "checkbox") return val.checkbox ? "是" : "否";
          if (type === "status") return val.status?.name || null;
          if (type === "formula") return val.formula?.string || val.formula?.number || val.formula?.date?.start || null;
          if (type === "phone_number") return val.phone_number || null;
          if (type === "email") return val.email || null;
          if (type === "url") return val.url || null;
          if (type === "files") {
            return val.files?.map((f: any) => f.file?.url || f.external?.url).filter(Boolean).join(", ") || null;
          }
        } catch (e) {}
        return null;
      };

      if (mapping && selectedFields) {
        // --- 高级映射模式 (由前端 Modal 触发) ---
        for (const p of Object.values(props) as any[]) {
          if (p.type === "title" && p.title?.[0]?.plain_text) {
            name = p.title[0].plain_text;
            break;
          }
        }

        Object.entries(props).forEach(([key, val]: [string, any]) => {
          if (!selectedFields!.includes(key)) return;
          const mappedName = mapping![key];
          if (!mappedName) return;

          let value = extractValue(val);
          if (value === null || value === undefined || value === "") return;

          if (mappedName === "name") name = typeof value === "string" ? value : String(value);
          else if (mappedName === "phone") phone = typeof value === "string" ? value : String(value);
          else if (mappedName === "market") market = typeof value === "string" ? value : String(value);
          else if (mappedName === "relation") relation = Array.isArray(value) ? JSON.stringify(value) : JSON.stringify([String(value)]);
          else {
            extraProps[mappedName] = Array.isArray(value) ? value.join(", ") : value;
          }
        });
      } else {
        // --- 传统兼容模式 ---
        for (const p of Object.values(props) as any[]) {
          if (p.type === "title" && p.title?.[0]?.plain_text) {
            name = p.title[0].plain_text;
            break;
          }
        }

        const phoneProp = props["电话号码"] || props.Phone || props["电话"];
        if (phoneProp) {
          const val = extractValue(phoneProp);
          phone = val ? String(val) : "";
        }

        const m = props["市场"] || props.Market;
        if (m) {
          const mVal = extractValue(m);
          market = mVal ? String(mVal) : "";
        }

        const r = props["关系"] || props.Relation;
        if (r) {
          const rVal = extractValue(r);
          relation = Array.isArray(rVal) ? JSON.stringify(rVal) : JSON.stringify(rVal ? [String(rVal)] : []);
        }

        Object.entries(props).forEach(([key, val]: [string, any]) => {
          if (["姓名", "Name", "电话", "Phone", "电话号码", "市场", "Market", "关系", "Relation"].includes(key)) return;
          if (val.type === "title") return;

          const value = extractValue(val);
          if (value !== null && value !== undefined && value !== "") {
            extraProps[key] = Array.isArray(value) ? value.join(", ") : value;
          }
        });
      }

      if (phone) {
        rows.push([page.id, name, phone, market, relation, JSON.stringify(extraProps), userId, sourceId, new Date()]);
      } else {
        if (debugList.length < 5) {
          debugList.push({
            id: page.id,
            name,
            phone,
            rawPropsKeys: Object.keys(props),
            rawPropsSample: Object.entries(props).slice(0, 8).map(([k, v]: [string, any]) => ({
              key: k,
              type: v.type,
              val: extractValue(v)
            }))
          });
        }
      }
    }

    if (purge) {
      if (sourceId) {
        await conn.execute("DELETE FROM Contact WHERE userId = ? AND sourceId = ?", [userId, sourceId]);
      } else {
        await conn.execute("DELETE FROM Contact WHERE userId = ? AND (sourceId IS NULL OR sourceId = '')", [userId]);
      }
    }

    // 只拉取当前目标数据源下的已存在联系人，防止跨数据源合并导致其他来源联系人被篡改/消失
    const targetSourceId = sourceId || "";
    const [existingRows]: any = await conn.execute(
      "SELECT id, name, phone, market, relation, properties FROM Contact WHERE userId = ? AND sourceId = ?",
      [userId, targetSourceId]
    );
    
    const phoneMap = new Map<string, any>();
    existingRows.forEach((r: any) => {
      const cleanP = cleanPhoneString(r.phone);
      if (cleanP) {
        phoneMap.set(cleanP, {
          id: r.id,
          name: r.name,
          phone: r.phone,
          market: r.market,
          relation: r.relation,
          properties: typeof r.properties === 'string' ? JSON.parse(r.properties || "{}") : (r.properties || {})
        });
      }
    });

    const modifiedIds = new Set<string>();

    // 重新处理 rows 数组中的拉取项进行合并
    rows.forEach((r: any) => {
      const pageId = r[0];
      const name = r[1];
      const rawPhone = r[2];
      const market = r[3];
      const relationStr = r[4];
      const extraProps = typeof r[5] === 'string' ? JSON.parse(r[5]) : r[5];

      const cleanPhone = cleanPhoneString(rawPhone);
      if (!cleanPhone) return;

      let incomingRelations: string[] = [];
      try {
        const parsed = JSON.parse(relationStr);
        if (Array.isArray(parsed)) incomingRelations = parsed;
      } catch {}

      if (phoneMap.has(cleanPhone)) {
        // 发现重复项，进行合并
        const existing = phoneMap.get(cleanPhone);
        let changed = false;

        if (existing.name === "未命名" || (name && name !== "未命名" && name.length > existing.name.length)) {
          existing.name = name;
          changed = true;
        }
        if (!existing.market && market) {
          existing.market = market;
          changed = true;
        }

        let existingRelations: string[] = [];
        try {
          const parsed = typeof existing.relation === 'string' ? JSON.parse(existing.relation) : existing.relation;
          if (Array.isArray(parsed)) existingRelations = parsed;
        } catch {}
        const mergedRelations = Array.from(new Set([...existingRelations, ...incomingRelations]));
        const newRelationStr = JSON.stringify(mergedRelations);
        if (existing.relation !== newRelationStr) {
          existing.relation = newRelationStr;
          changed = true;
        }

        const newProperties = {
          ...existing.properties,
          ...extraProps
        };
        if (JSON.stringify(existing.properties) !== JSON.stringify(newProperties)) {
          existing.properties = newProperties;
          changed = true;
        }

        if (changed) {
          modifiedIds.add(existing.id);
        }
      } else {
        // 全新联系人
        phoneMap.set(cleanPhone, {
          id: pageId,
          name,
          phone: cleanPhone,
          market,
          relation: relationStr,
          properties: extraProps
        });
        modifiedIds.add(pageId);
      }
    });

    // 重新组装 rows 数组，仅写入发生改变的或新增的记录
    const finalRows: any[][] = [];
    phoneMap.forEach((c: any) => {
      if (modifiedIds.has(c.id)) {
        finalRows.push([
          c.id,
          c.name,
          c.phone,
          c.market,
          c.relation,
          JSON.stringify(c.properties),
          userId,
          targetSourceId,
          new Date()
        ]);
      }
    });

    // 分批写入，每批 500 条
    if (finalRows.length > 0) {
      for (let i = 0; i < finalRows.length; i += 500) {
        const chunk = finalRows.slice(i, i + 500);
        const sql = `REPLACE INTO Contact (id, name, phone, market, relation, properties, userId, sourceId, updatedAt) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",")}`;
        const values = chunk.flat();
        await conn.execute(sql, values);
      }
    }

    const debugObj = {
      receivedMapping: mapping,
      receivedSelectedFields: selectedFields,
      receivedSourceId: sourceId,
      notionDbId: databaseId ? `${databaseId.substring(0, 4)}...${databaseId.substring(databaseId.length - 4)}` : "empty",
      rowsCount: rows.length,
      totalFetched: allResults.length,
      skippedPagesSample: debugList
    };

    // 记录成功同步日志到数据库
    try {
      const summaryMsg = `Notion拉取完成：共拉取到 ${allResults.length} 条，成功同步导入/更新 ${rows.length} 条数据`;
      await conn.execute(
        "INSERT INTO SyncLog (syncType, status, summary, details, userId) VALUES (?, ?, ?, ?, ?)",
        [
          "FORWARD_SYNC",
          rows.length > 0 ? "SUCCESS" : "WARNING",
          summaryMsg,
          JSON.stringify(debugObj, null, 2),
          userId
        ]
      );
    } catch (logErr) {
      console.error("Failed to write success SyncLog:", logErr);
    }

    return NextResponse.json({ 
      success: true, 
      count: allResults.length, 
      synced: rows.length, 
      version: "V3_STABLE",
      debug: debugObj
    });
  } catch (e: any) {
    console.error("Sync error:", e);
    let errorMsg = e.message;

    if (e.message.includes("Could not find database")) {
      errorMsg = `找不到 Notion 数据库。请确保：1. Database ID 填写正确；2. 在 Notion 中已点击「...」→「Add connections」授权了您的 Integration。`;
    } else if (e.message.includes("Unauthorized")) {
      errorMsg = "Notion Integration Secret 错误或已过期，请在系统设置中更新。";
    }

    // 记录失败同步日志到数据库
    try {
      await conn.execute(
        "INSERT INTO SyncLog (syncType, status, summary, details, userId) VALUES (?, ?, ?, ?, ?)",
        [
          "FORWARD_SYNC",
          "FAILED",
          `Notion拉取失败：${errorMsg.substring(0, 100)}`,
          JSON.stringify({ error: e.message, stack: e.stack }, null, 2),
          userId
        ]
      );
    } catch (logErr) {
      console.error("Failed to write error SyncLog:", logErr);
    }

    return NextResponse.json({ error: errorMsg }, { status: 500 });
  } finally {
    await conn.end();
  }
}
