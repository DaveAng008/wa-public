import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export const dynamic = 'force-dynamic';

function parseMultiSelectParam(param: string | null): string[] {
  if (!param) return [];
  const trimmed = param.trim();
  if (trimmed === "all" || trimmed === "undefined" || trimmed === "") {
    return [];
  }
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      return [];
    }
  }
  return trimmed.split(",").map(s => s.trim()).filter(Boolean);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session?.user?.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  
  try {
    // 1. 获取 Contact 表中所有静态列结构
    const [columns]: any = await conn.execute(
      "SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Contact' AND TABLE_SCHEMA = DATABASE()"
    );

    const staticFields = columns.map((col: any) => ({
      name: col.COLUMN_NAME,
      type: col.DATA_TYPE,
      isDynamic: false
    }));

    // 获取特定数据源的过滤条件
    const { searchParams } = new URL(req.url);
    const sourceId = searchParams.get("sourceId") || "";

    // 2. 从 AppSettings 获取用户定义的自定义列列表
    const [settingsRows]: any = await conn.execute(
      "SELECT customSchema FROM AppSettings WHERE userId = ? LIMIT 1",
      [userId]
    );
    let customSchemaArray: string[] = [];
    if (settingsRows.length > 0 && settingsRows[0].customSchema) {
      try {
        const parsed = typeof settingsRows[0].customSchema === 'string'
          ? JSON.parse(settingsRows[0].customSchema)
          : settingsRows[0].customSchema;
        if (Array.isArray(parsed)) {
          customSchemaArray = parsed;
        }
      } catch (e) {}
    }

    // 3. 扫描当前用户特定数据源的联系人，提取 properties 里的所有动态 JSON 键
    let query = "SELECT properties FROM Contact WHERE userId = ? AND properties IS NOT NULL AND properties != ''";
    const params = [userId];
    const parsedSourceIds = parseMultiSelectParam(sourceId);
    if (parsedSourceIds.length > 0) {
      const placeholders = parsedSourceIds.map(() => "?").join(",");
      query += ` AND sourceId IN (${placeholders})`;
      params.push(...parsedSourceIds);
    }
    const [rows]: any = await conn.execute(query, params);

    const dynamicKeys = new Set<string>();
    
    // 首先添加用户自定义列，确保即使没有任何联系人拥有此列，也能正常渲染和勾选
    customSchemaArray.forEach(key => {
      if (key) dynamicKeys.add(key);
    });

    rows.forEach((row: any) => {
      try {
        let props = row.properties;
        if (typeof props === 'string') {
          props = JSON.parse(props);
        }
        if (props && typeof props === 'object' && !Array.isArray(props)) {
          Object.keys(props).forEach(key => dynamicKeys.add(key));
        }
      } catch (e) {}
    });

    const dynamicFields = Array.from(dynamicKeys).map(key => ({
      name: key,
      type: "json_property",
      isDynamic: true
    }));

    return NextResponse.json({
      success: true,
      staticFields,
      dynamicFields,
      allFields: [...staticFields, ...dynamicFields]
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const body = await req.json();
    const { action } = body;
    
    // RENAME 动作兼容前端的多变量命名格式 (name/oldName/newName)
    const oldColName = body.oldName || (body.newName ? body.name : undefined);
    const newColName = body.newName || (body.oldName ? body.name : undefined);
    const name = body.name; // 用于 ADD 和 DELETE

    // 1. 获取已存在的 customSchema
    const [settingsRows]: any = await conn.execute(
      "SELECT id, customSchema FROM AppSettings WHERE userId = ? LIMIT 1",
      [userId]
    );

    let customSchemaArray: string[] = [];
    let settingsId = "";
    if (settingsRows.length > 0) {
      settingsId = settingsRows[0].id;
      if (settingsRows[0].customSchema) {
        try {
          const parsed = typeof settingsRows[0].customSchema === 'string'
            ? JSON.parse(settingsRows[0].customSchema)
            : settingsRows[0].customSchema;
          if (Array.isArray(parsed)) {
            customSchemaArray = parsed;
          }
        } catch (e) {}
      }
    }

    if (action === "ADD") {
      if (!name || customSchemaArray.includes(name)) {
        return NextResponse.json({ success: true, columns: customSchemaArray });
      }
      customSchemaArray.push(name);
    } else if (action === "DELETE") {
      if (!name) {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
      }
      customSchemaArray = customSchemaArray.filter(n => n !== name);
      
      // 1. 获取当前用户所有具有 properties 的联系人 (附带真实的 name, phone 传递以避免唯一索引冲突)
      const [rows]: any = await conn.execute(
        "SELECT id, name, phone, properties FROM Contact WHERE userId = ? AND properties IS NOT NULL AND properties != ''",
        [userId]
      );

      const updates: any[] = [];
      rows.forEach((row: any) => {
        try {
          let props = row.properties;
          if (typeof props === 'string') {
            props = JSON.parse(props);
          }
          if (props && typeof props === 'object' && !Array.isArray(props)) {
            if (name in props) {
              delete props[name];
              updates.push({ 
                id: row.id, 
                name: row.name, 
                phone: row.phone, 
                properties: JSON.stringify(props) 
              });
            }
          }
        } catch (e) {}
      });

      // 2. 批量更新数据库中受影响的联系人，使用 ON DUPLICATE KEY UPDATE 以确保极高性能且安全防崩溃
      if (updates.length > 0) {
        for (let i = 0; i < updates.length; i += 100) {
          const chunk = updates.slice(i, i + 100);
          const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
          const sql = `INSERT INTO Contact (id, userId, name, phone, properties) VALUES ${placeholders} 
                       ON DUPLICATE KEY UPDATE properties = VALUES(properties), updatedAt = NOW()`;
          const params: any[] = [];
          chunk.forEach(item => {
            params.push(item.id, userId, item.name, item.phone, item.properties);
          });
          await conn.execute(sql, params);
        }
      }
    } else if (action === "RENAME") {
      if (!oldColName || !newColName || oldColName === newColName) {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
      }
      customSchemaArray = customSchemaArray.map(n => n === oldColName ? newColName : n);

      // 1. 获取当前用户所有具有 properties 的联系人 (附带真实的 name, phone 传递以避免唯一索引冲突)
      const [rows]: any = await conn.execute(
        "SELECT id, name, phone, properties FROM Contact WHERE userId = ? AND properties IS NOT NULL AND properties != ''",
        [userId]
      );

      const updates: any[] = [];
      rows.forEach((row: any) => {
        try {
          let props = row.properties;
          if (typeof props === 'string') {
            props = JSON.parse(props);
          }
          if (props && typeof props === 'object' && !Array.isArray(props)) {
            if (oldColName in props) {
              props[newColName] = props[oldColName];
              delete props[oldColName];
              updates.push({ 
                id: row.id, 
                name: row.name, 
                phone: row.phone, 
                properties: JSON.stringify(props) 
              });
            }
          }
        } catch (e) {}
      });

      // 2. 批量更新数据库中受影响的联系人，使用 ON DUPLICATE KEY UPDATE 以确保极高性能且安全防崩溃
      if (updates.length > 0) {
        for (let i = 0; i < updates.length; i += 100) {
          const chunk = updates.slice(i, i + 100);
          const placeholders = chunk.map(() => "(?, ?, ?, ?, ?)").join(", ");
          const sql = `INSERT INTO Contact (id, userId, name, phone, properties) VALUES ${placeholders} 
                       ON DUPLICATE KEY UPDATE properties = VALUES(properties), updatedAt = NOW()`;
          const params: any[] = [];
          chunk.forEach(item => {
            params.push(item.id, userId, item.name, item.phone, item.properties);
          });
          await conn.execute(sql, params);
        }
      }
    }

    // 2. 保存回 AppSettings
    if (settingsId) {
      await conn.execute(
        "UPDATE AppSettings SET customSchema = ?, updatedAt = NOW() WHERE id = ?",
        [JSON.stringify(customSchemaArray), settingsId]
      );
    } else {
      const newSettingsId = "set_" + Math.random().toString(36).slice(2, 12);
      await conn.execute(
        "INSERT INTO AppSettings (id, userId, customSchema, updatedAt) VALUES (?, ?, ?, NOW())",
        [newSettingsId, userId, JSON.stringify(customSchemaArray)]
      );
    }

    return NextResponse.json({ success: true, columns: customSchemaArray });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

