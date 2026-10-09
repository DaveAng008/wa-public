import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

function cleanPhoneString(rawPhone: string): string {
  if (!rawPhone) return "";
  // 彻底移除所有非数字字符（包含 + 符号），保持全网统一纯数字格式
  return String(rawPhone).replace(/[^\d]/g, "");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

  try {
    const body = await req.json();
    const { sourceName, description, contacts, duplicateStrategy = "SKIP" } = body;

    if (!sourceName || !Array.isArray(contacts) || contacts.length === 0) {
      return NextResponse.json({ error: "Missing required fields: sourceName, contacts" }, { status: 400 });
    }

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      // 1. 创建 EXCEL 类型的数据源
      const sourceId = "ds_" + Math.random().toString(36).slice(2, 22);
      await conn.execute(
        "INSERT INTO DataSource (id, name, type, description, userId, createdAt, updatedAt) VALUES (?, ?, 'EXCEL', ?, ?, NOW(), NOW())",
        [sourceId, sourceName, description || null, userId]
      );

      const phoneMap = new Map<string, any>();
      const modifiedIds = new Set<string>();
      let importedCount = 0;

      // 2. 处理导入数据
      const phoneCountMap = new Map<string, number>();

      contacts.forEach((c: any, index: number) => {
        const rawPhone = String(c.phone || "").trim();
        let cleanPhone = cleanPhoneString(rawPhone);
        
        // 如果无号码但用户选择了导入，则分配随机空号码标记防止数据库唯一索引冲突
        if (!cleanPhone) {
          cleanPhone = `NO_PHONE_${index}_` + Math.random().toString(36).slice(2, 8);
        }

        const name = c.name || "未命名";
        const market = c.market || null;
        
        let incomingRelations: string[] = [];
        if (c.relation) {
          if (Array.isArray(c.relation)) {
            incomingRelations = c.relation;
          } else if (typeof c.relation === 'string') {
            incomingRelations = c.relation.split(',').map((s: string) => s.trim()).filter(Boolean);
          }
        }

        const incomingProperties = c.properties || {};
        const isNoPhone = cleanPhone.startsWith("NO_PHONE_");

        if (phoneMap.has(cleanPhone) && !isNoPhone) {
          if (duplicateStrategy === "SKIP") {
            // 跳过重复
            return;
          }

          if (duplicateStrategy === "OVERWRITE") {
            // 覆盖重复
            const existing = phoneMap.get(cleanPhone);
            existing.name = name;
            existing.market = market;
            existing.relation = JSON.stringify(incomingRelations);
            existing.properties = incomingProperties;
            modifiedIds.add(existing.id);
            return;
          }

          if (duplicateStrategy === "ALLOW") {
            // 允许重复并发：为后续重复记录建立独有一条联系人记录，通过后缀规避 MySQL 唯一索引冲突
            const count = (phoneCountMap.get(cleanPhone) || 1) + 1;
            phoneCountMap.set(cleanPhone, count);
            const dbPhoneKey = `${cleanPhone}_dup${count}`;
            const contactId = "ct_" + Math.random().toString(36).slice(2, 22) + Math.random().toString(36).slice(2, 10);
            
            phoneMap.set(dbPhoneKey, {
              id: contactId,
              name,
              phone: dbPhoneKey,
              market,
              relation: JSON.stringify(incomingRelations),
              properties: incomingProperties
            });
            modifiedIds.add(contactId);
            importedCount++;
            return;
          }

          // 如果是 MERGE (数据合并)
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
            ...incomingProperties
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
          phoneCountMap.set(cleanPhone, 1);
          const contactId = "ct_" + Math.random().toString(36).slice(2, 22) + Math.random().toString(36).slice(2, 10);
          const finalPhone = isNoPhone ? "" : cleanPhone;
          phoneMap.set(cleanPhone, {
            id: contactId,
            name,
            phone: finalPhone,
            market,
            relation: JSON.stringify(incomingRelations),
            properties: incomingProperties
          });
          modifiedIds.add(contactId);
          importedCount++;
        }
      });

      // 3. 批量写入 Contact 表
      const rows: any[][] = [];
      phoneMap.forEach((c: any) => {
        if (modifiedIds.has(c.id)) {
          rows.push([
            c.id,
            c.name,
            c.phone,
            c.market,
            c.relation,
            JSON.stringify(c.properties),
            sourceId,
            userId,
            new Date()
          ]);
        }
      });

      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const sql = `REPLACE INTO Contact (id, name, phone, market, relation, properties, sourceId, userId, updatedAt) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",")}`;
          const values = chunk.flat();
          await conn.execute(sql, values);
        }
      }

      return NextResponse.json({ success: true, count: importedCount, sourceId });
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
