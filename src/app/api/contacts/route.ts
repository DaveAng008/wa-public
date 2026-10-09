import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  // 获取复杂参数
  const marketsStr = searchParams.get("markets") || "";
  const relationsStr = searchParams.get("relations") || "";
  const matchMode = searchParams.get("matchMode") || "ANY"; 
  const ruleMatchMode = searchParams.get("ruleMatchMode") || "AND"; 
  const sent = searchParams.get("sent");
  const rulesStr = searchParams.get("rules") || "[]";

  const markets = marketsStr ? marketsStr.split(",") : [];
  const relations = relationsStr ? relationsStr.split(",") : [];
  let rules: any[] = [];
  try { rules = JSON.parse(rulesStr); } catch (e) { rules = []; }

  const userId = session.user.id;
  const sourceId = searchParams.get("sourceId") || "";
  const conn = await getConn();
  try {
    let query = "SELECT * FROM Contact WHERE userId = ? AND phone NOT IN (SELECT phone FROM Blacklist WHERE userId = ?)";
    const values: any[] = [userId, userId];

    if (sourceId && sourceId !== "all") {
      if (sourceId === "unassigned") {
        query += " AND (sourceId IS NULL OR sourceId = '' OR sourceId NOT IN (SELECT id FROM DataSource))";
      } else {
        query += " AND sourceId = ?";
        values.push(sourceId);
      }
    }

    // --- 1. 市场筛选 (OR 逻辑) ---
    if (markets.length > 0 && markets[0] !== "") {
      query += ` AND market IN (${markets.map(() => "?").join(",")})`;
      values.push(...markets);
    }

    // --- 2. 关系筛选 ---
    if (relations.length > 0 && relations[0] !== "") {
      const relationConditions = relations.map(() => "relation LIKE ?");
      const joiner = matchMode === "ALL" ? " AND " : " OR ";
      query += ` AND (${relationConditions.join(joiner)})`;
      relations.forEach(r => values.push(`%${r}%`));
    }

    // --- 3. 发送状态 ---
    if (sent) {
      query += " AND sent = ?";
      values.push(sent === "true");
    }

    // --- 4. 高级过滤规则 (核心引擎) ---
    if (rules.length > 0) {
      const ruleConditions: string[] = [];
      rules.forEach((rule: any) => {
        const { field, operator, value } = rule;
        if (!field || !operator) return;

        let sqlField = "";
        if (["name", "phone", "market", "relation"].includes(field)) {
          sqlField = `\`${field}\``;
        } else {
          // 处理动态 JSON 字段，防止 mysql json_extract 因空字符串等报错崩溃
          sqlField = `CASE WHEN JSON_VALID(properties) = 1 THEN JSON_UNQUOTE(JSON_EXTRACT(properties, '$."${field.replace(/"/g, '\\"').replace(/'/g, "''")}"')) ELSE NULL END`;
        }

        switch (operator) {
          case "contains":
            ruleConditions.push(`${sqlField} LIKE ?`);
            values.push(`%${value}%`);
            break;
          case "not_contains":
            ruleConditions.push(`(${sqlField} NOT LIKE ? OR ${sqlField} IS NULL)`);
            values.push(`%${value}%`);
            break;
          case "equals":
            ruleConditions.push(`${sqlField} = ?`);
            values.push(value);
            break;
          case "not_equals":
            ruleConditions.push(`(${sqlField} != ? OR ${sqlField} IS NULL)`);
            values.push(value);
            break;
          case "is_empty":
            ruleConditions.push(`(${sqlField} IS NULL OR ${sqlField} = '' OR ${sqlField} = 'null')`);
            break;
          case "is_not_empty":
            ruleConditions.push(`(${sqlField} IS NOT NULL AND ${sqlField} != '' AND ${sqlField} != 'null')`);
            break;
        }
      });

      if (ruleConditions.length > 0) {
        const joiner = ruleMatchMode === "OR" ? " OR " : " AND ";
        query += ` AND (${ruleConditions.join(joiner)})`;
      }
    }

    const [totalRows]: any = await conn.execute(query.replace("*", "COUNT(*) as count"), values);
    // LIMIT 和 OFFSET 在部分 MySQL 预处理 (execute) 中不能作为 ? 占位符，
    // 这里直接将已通过 parseInt 校验为安全整数的 limit/offset 拼入 SQL
    let selectQuery = query.replace("SELECT *", "SELECT *, EXISTS(SELECT 1 FROM BlacklistHistory bh WHERE bh.phone = Contact.phone AND bh.userId = Contact.userId) as isHistoricallyBlacklisted");
    selectQuery += ` ORDER BY createdAt DESC LIMIT ${limit} OFFSET ${offset}`;

    const [rows]: any = await conn.execute(selectQuery, values);

    // 关键修复：确保 properties 字段被正确解析为对象
    const processedRows = rows.map((row: any) => {
      let props = row.properties;
      if (typeof props === 'string') {
        try { props = JSON.parse(props); } catch (e) { props = {}; }
      }
      return { ...row, properties: props || {} };
    });

    return NextResponse.json({
      contacts: processedRows,
      total: totalRows[0].count,
      version: "V4_ADVANCED_FILTER"
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const userId = session.user.id;
    const conn = await getConn();

    try {
      // 支持合并批量提交
      const batches = body.batch && Array.isArray(body.batch) 
        ? body.batch 
        : [body];

      let totalUpdated = 0;

      for (const item of batches) {
        const { contactIds, field, value } = item;
        if (!Array.isArray(contactIds) || contactIds.length === 0 || !field) {
          continue;
        }

        const isStaticField = ["name", "phone", "market", "relation", "sent", "responded"].includes(field);

        if (isStaticField) {
          let updateVal = value;
          if (field === "relation" && typeof value !== "string") {
            updateVal = JSON.stringify(value);
          } else if (field === "sent" || field === "responded") {
            updateVal = value === true || value === "true" || value === 1 ? 1 : 0;
          }

          const sql = `UPDATE Contact SET \`${field}\` = ?, updatedAt = NOW() WHERE id IN (${contactIds.map(() => "?").join(",")}) AND userId = ?`;
          await conn.execute(sql, [updateVal, ...contactIds, userId]);
        } else {
          // Notion dynamic custom properties JSON column
          const jsonPath = `$."${field.replace(/"/g, '\\"')}"`;
          const sql = `UPDATE Contact SET properties = JSON_SET(CASE WHEN JSON_VALID(properties) = 1 THEN properties ELSE '{}' END, ?, ?), updatedAt = NOW() WHERE id IN (${contactIds.map(() => "?").join(",")}) AND userId = ?`;
          await conn.execute(sql, [jsonPath, value, ...contactIds, userId]);
        }
        totalUpdated += contactIds.length;
      }

      return NextResponse.json({ success: true, updatedCount: totalUpdated });
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const userId = session.user.id;
    const contactIds = Array.isArray(body.contactIds) ? body.contactIds : (body.id ? [body.id] : []);

    if (contactIds.length === 0) {
      return NextResponse.json({ error: "No contactIds provided" }, { status: 400 });
    }

    const conn = await getConn();
    try {
      const placeholders = contactIds.map(() => "?").join(",");
      const sql = `DELETE FROM Contact WHERE id IN (${placeholders}) AND userId = ?`;
      const [res]: any = await conn.execute(sql, [...contactIds, userId]);
      return NextResponse.json({ success: true, deletedCount: res.affectedRows });
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

