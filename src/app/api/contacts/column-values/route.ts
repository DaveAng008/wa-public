import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export const dynamic = 'force-dynamic';

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { 
      field, 
      markets = [], 
      relations = [], 
      matchMode = "ANY", 
      ruleMatchMode = "AND", 
      sent, 
      rules = [], 
      sourceId 
    } = body;

    if (!field) {
      return NextResponse.json({ error: "Missing field" }, { status: 400 });
    }

    const userId = session.user.id;
    const conn = await getConn();

    try {
      const isStaticField = ["market", "relation", "name", "phone", "sent"].includes(field);
      
      let sqlField = "";
      if (isStaticField) {
        sqlField = `\`${field}\``;
      } else {
        sqlField = `CASE WHEN JSON_VALID(properties) = 1 THEN JSON_UNQUOTE(JSON_EXTRACT(properties, '$."${field.replace(/"/g, '\\"').replace(/'/g, "''")}"')) ELSE NULL END`;
      }

      let selectSql = `SELECT ${sqlField} AS val, COUNT(*) AS count FROM Contact WHERE userId = ?`;
      const queryParams: any[] = [userId];

      if (sourceId && sourceId !== "all") {
        selectSql += " AND sourceId = ?";
        queryParams.push(sourceId);
      }

      // 1. 市场筛选
      if (markets.length > 0 && markets[0] !== "") {
        selectSql += ` AND market IN (${markets.map(() => "?").join(",")})`;
        queryParams.push(...markets);
      }

      // 2. 关系筛选
      if (relations.length > 0 && relations[0] !== "") {
        const relationConditions = relations.map(() => "relation LIKE ?");
        const joiner = matchMode === "ALL" ? " AND " : " OR ";
        selectSql += ` AND (${relationConditions.join(joiner)})`;
        relations.forEach((r: string) => queryParams.push(`%${r}%`));
      }

      // 3. 发送状态
      if (sent) {
        selectSql += " AND sent = ?";
        queryParams.push(sent === "true");
      }

      // 4. 高级过滤规则
      if (rules.length > 0) {
        const ruleConditions: string[] = [];
        rules.forEach((rule: any) => {
          const { field: ruleField, operator, value: ruleVal } = rule;
          if (!ruleField || !operator) return;

          let rSqlField = "";
          if (["name", "phone", "market", "relation"].includes(ruleField)) {
            rSqlField = `\`${ruleField}\``;
          } else {
            rSqlField = `CASE WHEN JSON_VALID(properties) = 1 THEN JSON_UNQUOTE(JSON_EXTRACT(properties, '$."${ruleField.replace(/"/g, '\\"').replace(/'/g, "''")}"')) ELSE NULL END`;
          }

          switch (operator) {
            case "contains":
              ruleConditions.push(`${rSqlField} LIKE ?`);
              queryParams.push(`%${ruleVal}%`);
              break;
            case "not_contains":
              ruleConditions.push(`(${rSqlField} NOT LIKE ? OR ${rSqlField} IS NULL)`);
              queryParams.push(`%${ruleVal}%`);
              break;
            case "equals":
              ruleConditions.push(`${rSqlField} = ?`);
              queryParams.push(ruleVal);
              break;
            case "not_equals":
              ruleConditions.push(`(${rSqlField} != ? OR ${rSqlField} IS NULL)`);
              queryParams.push(ruleVal);
              break;
            case "is_empty":
              ruleConditions.push(`(${rSqlField} IS NULL OR ${rSqlField} = '' OR ${rSqlField} = 'null')`);
              break;
            case "is_not_empty":
              ruleConditions.push(`(${rSqlField} IS NOT NULL AND ${rSqlField} != '' AND ${rSqlField} != 'null')`);
              break;
          }
        });

        if (ruleConditions.length > 0) {
          const joiner = ruleMatchMode === "OR" ? " OR " : " AND ";
          selectSql += ` AND (${ruleConditions.join(joiner)})`;
        }
      }

      selectSql += ` GROUP BY val`;

      const [rows]: any = await conn.execute(selectSql, queryParams);

      const valueMap: Record<string, number> = {};
      rows.forEach((row: any) => {
        const v = row.val;
        const normalized = (v === null || v === undefined || v === 'null' || v === '') ? "__EMPTY__" : v;
        valueMap[normalized] = (valueMap[normalized] || 0) + row.count;
      });

      const values = Object.entries(valueMap).map(([value, count]) => ({
        value,
        count
      }));

      return NextResponse.json({ success: true, values });
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
