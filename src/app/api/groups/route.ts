import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const conn = await getConn();
  try {
    const [groups]: any = await conn.execute("SELECT * FROM `Group` WHERE userId = ? ORDER BY createdAt DESC", [userId]);
    
    // 为每个人群包实时计算匹配人数
    const groupsWithCount = await Promise.all(groups.map(async (group: any) => {
      let count = 0;
      try {
        const cfg = typeof group.filterConfig === 'string' ? JSON.parse(group.filterConfig) : group.filterConfig;
        let query = "SELECT COUNT(*) as total FROM Contact WHERE userId = ?";
        const values: any[] = [userId];

        // 0. 数据源筛选
        if (cfg.sourceId) {
          query += " AND sourceId = ?";
          values.push(cfg.sourceId);
        }

        // 1. 市场筛选
        if (cfg.markets?.length > 0) {
          query += ` AND market IN (${cfg.markets.map(() => "?").join(",")})`;
          values.push(...cfg.markets);
        }

        // 2. 关系筛选
        if (cfg.relations?.length > 0) {
          const relationConditions = cfg.relations.map(() => "relation LIKE ?");
          const joiner = cfg.matchMode === "ALL" ? " AND " : " OR ";
          query += ` AND (${relationConditions.join(joiner)})`;
          cfg.relations.forEach((r: string) => values.push(`%${r}%`));
        }

        // 3. 发送状态
        if (cfg.sent) {
          query += " AND sent = ?";
          values.push(cfg.sent === "true");
        }

        // 4. 高级规则
        if (cfg.rules?.length > 0) {
          const ruleConditions: string[] = [];
          cfg.rules.forEach((rule: any) => {
            const { field, operator, value } = rule;
            if (!field || !operator) return;
            let sqlField = ["name", "phone", "market", "relation"].includes(field) 
              ? `\`${field}\`` 
              : `CASE WHEN JSON_VALID(properties) = 1 THEN JSON_UNQUOTE(JSON_EXTRACT(properties, '$."${field.replace(/"/g, '\\"').replace(/'/g, "''")}"')) ELSE NULL END`;

            switch (operator) {
              case "contains": ruleConditions.push(`${sqlField} LIKE ?`); values.push(`%${value}%`); break;
              case "not_contains": ruleConditions.push(`(${sqlField} NOT LIKE ? OR ${sqlField} IS NULL)`); values.push(`%${value}%`); break;
              case "equals": ruleConditions.push(`${sqlField} = ?`); values.push(value); break;
              case "not_equals": ruleConditions.push(`(${sqlField} != ? OR ${sqlField} IS NULL)`); values.push(value); break;
              case "is_empty": ruleConditions.push(`(${sqlField} IS NULL OR ${sqlField} = '' OR ${sqlField} = 'null')`); break;
              case "is_not_empty": ruleConditions.push(`(${sqlField} IS NOT NULL AND ${sqlField} != '' AND ${sqlField} != 'null')`); break;
            }
          });

          if (ruleConditions.length > 0) {
            const joiner = cfg.ruleMatchMode === "OR" ? " OR " : " AND ";
            query += ` AND (${ruleConditions.join(joiner)})`;
          }
        }
        // 5. 手动排除
        if (Array.isArray(cfg.excludedIds) && cfg.excludedIds.length > 0) {
          query += ` AND id NOT IN (${cfg.excludedIds.map(() => "?").join(",")})`;
          values.push(...cfg.excludedIds);
        }

        const [res]: any = await conn.execute(query, values);
        count = res[0].total;
      } catch (e) { console.error("Count failed for group", group.id, e); }
      
      return { ...group, contactCount: count };
    }));

    return NextResponse.json(groupsWithCount);
  } catch (e: any) {
    return NextResponse.json({ error: "获取列表失败: " + e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  let conn;
  try {
    const body = await req.json();
    const { id: existingId, name, description, filterConfig, isUpdate } = body;
    
    conn = await getConn();
    const now = new Date();

    if (isUpdate && existingId) {
      // 执行更新逻辑 (带上 userId 校验)
      await conn.execute(
        "UPDATE `Group` SET name = ?, filterConfig = ?, updatedAt = ? WHERE id = ? AND userId = ?",
        [name, JSON.stringify(filterConfig), now, existingId, userId]
      );
      return NextResponse.json({ success: true, id: existingId, action: "updated" });
    } else {
      // 执行创建逻辑
      const id = "grp_" + Math.random().toString(36).slice(2, 10);
      await conn.execute(
        "INSERT INTO `Group` (id, name, description, filterConfig, userId, campaignId, contactIds, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, '', '', ?, ?)",
        [id, name, description || "", JSON.stringify(filterConfig), userId, now, now]
      );
      return NextResponse.json({ success: true, id, action: "created" });
    }
  } catch (e: any) {
    return NextResponse.json({ error: "操作失败", details: e.message }, { status: 500 });
  } finally {
    if (conn) await conn.end();
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

  const conn = await getConn();
  try {
    await conn.execute("DELETE FROM `Group` WHERE id = ? AND userId = ?", [id, userId]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: "删除失败: " + e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
