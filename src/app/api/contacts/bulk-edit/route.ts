import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

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
      value, 
      editMode = "OVERWRITE", // OVERWRITE | APPEND | ADD_PREFIX | REMOVE_PREFIX
      markets = [], 
      relations = [], 
      matchMode = "ANY", 
      ruleMatchMode = "AND", 
      sent, 
      rules = [], 
      sourceId,
      targetValues = []
    } = body;

    if (!field) {
      return NextResponse.json({ error: "Missing field" }, { status: 400 });
    }

    const userId = session.user.id;
    const conn = await getConn();

    try {
      const isStaticField = ["name", "phone", "market", "relation"].includes(field);

      let updateSql = "";
      const queryParams: any[] = [];

      if (isStaticField) {
        let updateVal = value;
        if (field === "relation" && typeof value !== "string" && Array.isArray(value)) {
          updateVal = JSON.stringify(value);
        }

        if (editMode === "ADD_PREFIX") {
          updateSql = `UPDATE Contact SET \`${field}\` = CONCAT(?, COALESCE(\`${field}\`, '')), updatedAt = NOW() WHERE userId = ?`;
          queryParams.push(String(value || ""), userId);
        } else if (editMode === "REMOVE_PREFIX") {
          const prefix = String(value || "");
          const prefixLen = prefix.length;
          updateSql = `UPDATE Contact SET \`${field}\` = CASE WHEN \`${field}\` LIKE CONCAT(?, '%') THEN SUBSTRING(\`${field}\`, ? + 1) ELSE \`${field}\` END, updatedAt = NOW() WHERE userId = ?`;
          queryParams.push(prefix, prefixLen, userId);
        } else if (editMode === "APPEND") {
          const appendStr = String(value || "");
          updateSql = `UPDATE Contact SET \`${field}\` = CASE WHEN \`${field}\` IS NULL OR \`${field}\` = '' OR \`${field}\` = '[]' THEN ? ELSE CONCAT(\`${field}\`, ',', ?) END, updatedAt = NOW() WHERE userId = ?`;
          queryParams.push(appendStr, appendStr, userId);
        } else {
          // OVERWRITE
          updateSql = `UPDATE Contact SET \`${field}\` = ?, updatedAt = NOW() WHERE userId = ?`;
          queryParams.push(updateVal, userId);
        }

        if (targetValues && targetValues.length > 0) {
          const hasEmpty = targetValues.includes("__EMPTY__");
          const nonEmptyValues = targetValues.filter((v: string) => v !== "__EMPTY__");
          
          const conditions: string[] = [];
          if (nonEmptyValues.length > 0) {
            conditions.push(`\`${field}\` IN (${nonEmptyValues.map(() => "?").join(",")})`);
            queryParams.push(...nonEmptyValues);
          }
          if (hasEmpty) {
            conditions.push(`(\`${field}\` IS NULL OR \`${field}\` = '' OR \`${field}\` = 'null')`);
          }
          if (conditions.length > 0) {
            updateSql += ` AND (${conditions.join(" OR ")})`;
          }
        }
      } else {
        // 自定义 JSON 字段：路径一律通过占位符传入，绝不再拼进 SQL 字符串，杜绝注入
        const jsonPath = `$."${String(field).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        const readExpr = `COALESCE(JSON_UNQUOTE(JSON_EXTRACT(properties, ?)), '')`;
        const valStr = String(value || "");

        if (editMode === "ADD_PREFIX") {
          updateSql = `UPDATE Contact SET properties = JSON_SET(COALESCE(properties, '{}'), ?, CONCAT(?, ${readExpr})), updatedAt = NOW() WHERE userId = ?`;
          queryParams.push(jsonPath, valStr, jsonPath, userId);
        } else if (editMode === "REMOVE_PREFIX") {
          const prefixLen = valStr.length;
          updateSql = `UPDATE Contact SET properties = JSON_SET(COALESCE(properties, '{}'), ?, CASE WHEN ${readExpr} LIKE CONCAT(?, '%') THEN SUBSTRING(${readExpr}, ? + 1) ELSE ${readExpr} END), updatedAt = NOW() WHERE userId = ?`;
          queryParams.push(jsonPath, jsonPath, valStr, jsonPath, prefixLen, jsonPath, userId);
        } else if (editMode === "APPEND") {
          updateSql = `UPDATE Contact SET properties = JSON_SET(COALESCE(properties, '{}'), ?, CASE WHEN ${readExpr} = '' THEN ? ELSE CONCAT(${readExpr}, ',', ?) END), updatedAt = NOW() WHERE userId = ?`;
          queryParams.push(jsonPath, jsonPath, valStr, jsonPath, valStr, userId);
        } else {
          // OVERWRITE
          updateSql = `UPDATE Contact SET properties = JSON_SET(COALESCE(properties, '{}'), ?, ?), updatedAt = NOW() WHERE userId = ?`;
          queryParams.push(jsonPath, value, userId);
        }

        if (targetValues && targetValues.length > 0) {
          const hasEmpty = targetValues.includes("__EMPTY__");
          const nonEmptyValues = targetValues.filter((v: string) => v !== "__EMPTY__");
          const sqlField = `CASE WHEN JSON_VALID(properties) = 1 THEN JSON_UNQUOTE(JSON_EXTRACT(properties, '$."${String(field).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/'/g, "''")}"')) ELSE NULL END`;
          
          const conditions: string[] = [];
          if (nonEmptyValues.length > 0) {
            conditions.push(`${sqlField} IN (${nonEmptyValues.map(() => "?").join(",")})`);
            queryParams.push(...nonEmptyValues);
          }
          if (hasEmpty) {
            conditions.push(`(${sqlField} IS NULL OR ${sqlField} = '' OR ${sqlField} = 'null')`);
          }
          if (conditions.length > 0) {
            updateSql += ` AND (${conditions.join(" OR ")})`;
          }
        }
      }

      // Add exactly the same filters as GET /api/contacts
      if (sourceId && sourceId !== "all") {
        updateSql += " AND sourceId = ?";
        queryParams.push(sourceId);
      }

      // --- 1. 市场筛选 ---
      if (markets.length > 0 && markets[0] !== "") {
        updateSql += ` AND market IN (${markets.map(() => "?").join(",")})`;
        queryParams.push(...markets);
      }

      // --- 2. 关系筛选 ---
      if (relations.length > 0 && relations[0] !== "") {
        const relationConditions = relations.map(() => "relation LIKE ?");
        const joiner = matchMode === "ALL" ? " AND " : " OR ";
        updateSql += ` AND (${relationConditions.join(joiner)})`;
        relations.forEach((r: string) => queryParams.push(`%${r}%`));
      }

      // --- 3. 发送状态 ---
      if (sent) {
        updateSql += " AND sent = ?";
        queryParams.push(sent === "true");
      }

      // --- 4. 高级过滤规则 ---
      if (rules.length > 0) {
        const ruleConditions: string[] = [];
        rules.forEach((rule: any) => {
          const { field: ruleField, operator, value: ruleVal } = rule;
          if (!ruleField || !operator) return;

          let sqlField = "";
          if (["name", "phone", "market", "relation"].includes(ruleField)) {
            sqlField = `\`${ruleField}\``;
          } else {
            sqlField = `CASE WHEN JSON_VALID(properties) = 1 THEN JSON_UNQUOTE(JSON_EXTRACT(properties, '$."${ruleField.replace(/"/g, '\\"').replace(/'/g, "''")}"')) ELSE NULL END`;
          }

          switch (operator) {
            case "contains":
              ruleConditions.push(`${sqlField} LIKE ?`);
              queryParams.push(`%${ruleVal}%`);
              break;
            case "not_contains":
              ruleConditions.push(`(${sqlField} NOT LIKE ? OR ${sqlField} IS NULL)`);
              queryParams.push(`%${ruleVal}%`);
              break;
            case "equals":
              ruleConditions.push(`${sqlField} = ?`);
              queryParams.push(ruleVal);
              break;
            case "not_equals":
              ruleConditions.push(`(${sqlField} != ? OR ${sqlField} IS NULL)`);
              queryParams.push(ruleVal);
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
          updateSql += ` AND (${ruleConditions.join(joiner)})`;
        }
      }

      const [res]: any = await conn.execute(updateSql, queryParams);
      return NextResponse.json({ success: true, updatedCount: res.affectedRows });
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
