import mysql from "mysql2/promise";

// 异步后台同步逻辑
export async function startAsyncSync({
  userId,
  sourceId,
  notionSecret,
  notionDatabaseId,
  mapping,
  selectedFields
}: {
  userId: string;
  sourceId: string;
  notionSecret: string;
  notionDatabaseId: string;
  mapping: Record<string, string>;
  selectedFields: string[];
}) {
  let conn;
  try {
    conn = await mysql.createConnection(process.env.DATABASE_URL!);

    // 1. 获取 Notion 数据库的列结构
    const schemaRes = await fetch(`https://api.notion.com/v1/databases/${notionDatabaseId}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${notionSecret}`,
        "Notion-Version": "2022-06-28"
      }
    });

    if (!schemaRes.ok) {
      const errorText = await schemaRes.text();
      throw new Error(`获取 Notion 数据库 Schema 失败: ${errorText}`);
    }

    const schemaData = await schemaRes.json();
    const notionSchema = schemaData?.properties || {};

    // 2. 读取本地 MySQL 需要反向同步的联系人
    let selectSql = "SELECT id, name, phone, sendCount, sent, properties FROM Contact WHERE userId = ?";
    const params = [userId];
    if (sourceId) {
      selectSql += " AND sourceId = ?";
      params.push(sourceId);
    }
    const [contacts]: any = await conn.execute(selectSql, params);

    if (contacts.length === 0) {
      // 记录空日志
      await conn.execute(
        "INSERT INTO SyncLog (syncType, status, summary, details, userId, createdAt) VALUES ('REVERSE_SYNC', 'SUCCESS', '反向同步成功：本地没有需要更新的属性数据', 'No contacts found.', ?, NOW())",
        [userId]
      );
      return;
    }

    // 3. 构建待更新列表
    const updates: Array<{ pageId: string; payload: any }> = [];
    contacts.forEach((row: any) => {
      let props: any = {};
      try { props = JSON.parse(row.properties || '{}'); } catch(e) {}

      const localData: any = {
        ...props,
        sendCount: row.sendCount,
        isSent: row.sent ? '是' : '否',
        system_sent: row.sent,
        id: row.id
      };

      const notionPayload: any = { properties: {} };

      if (selectedFields.length > 0) {
        selectedFields.forEach(field => {
          const targetColName = mapping[field];
          if (!targetColName) return;
          
          const val = localData[field];
          if (val === undefined || val === null || val === '') return;

          const colSchema = notionSchema[targetColName];
          if (!colSchema) return;

          const type = colSchema.type;
          let payloadVal = null;

          if (type === 'rich_text' || type === 'title') {
            payloadVal = [{ text: { content: String(val) } }];
          } else if (type === 'number') {
            payloadVal = Number(val);
          } else if (type === 'select') {
            payloadVal = { name: String(val) };
          } else if (type === 'multi_select') {
            payloadVal = String(val).split(',').map(s => ({ name: s.trim() }));
          } else if (type === 'checkbox') {
            payloadVal = val === '是' || val === true || val === 1 || val === 'true';
          } else if (type === 'date') {
            try {
              payloadVal = { start: new Date(val).toISOString() };
            } catch(e) {}
          } else if (type === 'url' || type === 'phone_number' || type === 'email') {
            payloadVal = String(val);
          }

          if (payloadVal !== null) {
            notionPayload.properties[targetColName] = { [type]: payloadVal };
          }
        });
      } else {
        // 默认更新 发送次数 和 是否已发送
        if (notionSchema['发送次数'] && notionSchema['发送次数'].type === 'number') {
          notionPayload.properties['发送次数'] = { number: row.sendCount || 0 };
        }
        if (notionSchema['是否已发送'] && notionSchema['是否已发送'].type === 'select') {
          notionPayload.properties['是否已发送'] = { select: { name: row.sent ? '是' : '否' } };
        }
      }

      if (Object.keys(notionPayload.properties).length > 0) {
        updates.push({
          pageId: row.id,
          payload: notionPayload
        });
      }
    });

    if (updates.length === 0) {
      await conn.execute(
        "INSERT INTO SyncLog (syncType, status, summary, details, userId, createdAt) VALUES ('REVERSE_SYNC', 'SUCCESS', '反向同步成功：本地没有需要更新的属性数据', 'No updates assembled.', ?, NOW())",
        [userId]
      );
      return;
    }

    // 4. 批量向 Notion 发送更新（并发控制）
    const successUpdates: Array<{ pageId: string }> = [];
    const failedUpdates: Array<{ pageId: string; error: string }> = [];

    const limit = 5; // 控制并发量，避免被限流
    for (let i = 0; i < updates.length; i += limit) {
      const chunk = updates.slice(i, i + limit);
      await Promise.all(
        chunk.map(async (u) => {
          if (u.pageId.length < 32) {
            failedUpdates.push({
              pageId: u.pageId,
              error: "不是合法的 Notion Page ID，可能是 Excel 导入数据"
            });
            return;
          }

          try {
            const pageRes = await fetch(`https://api.notion.com/v1/pages/${u.pageId}`, {
              method: "PATCH",
              headers: {
                "Authorization": `Bearer ${notionSecret}`,
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json"
              },
              body: JSON.stringify(u.payload)
            });

            if (pageRes.ok) {
              successUpdates.push({ pageId: u.pageId });
            } else {
              const errTxt = await pageRes.text();
              failedUpdates.push({ pageId: u.pageId, error: errTxt });
            }
          } catch (pe: any) {
            failedUpdates.push({ pageId: u.pageId, error: pe.message });
          }
        })
      );
    }

    const successCount = successUpdates.length;
    const failedCount = failedUpdates.length;

    const status = failedCount === 0 ? 'SUCCESS' : (successCount === 0 ? 'FAILED' : 'PARTIAL');
    const summary = failedCount === 0
      ? `成功反向同步了 ${successCount} 个联系人的数据至 Notion`
      : `反向同步完成：成功 ${successCount} 个，失败 ${failedCount} 个`;
    const details = JSON.stringify({
      success: successUpdates,
      failed: failedUpdates
    });

    await conn.execute(
      "INSERT INTO SyncLog (syncType, status, summary, details, userId, createdAt) VALUES ('REVERSE_SYNC', ?, ?, ?, ?, NOW())",
      [status, summary, details, userId]
    );

  } catch (err: any) {
    console.error("[Async Sync Error]", err);
    if (conn) {
      try {
        await conn.execute(
          "INSERT INTO SyncLog (syncType, status, summary, details, userId, createdAt) VALUES ('REVERSE_SYNC', 'FAILED', '反向同步失败', ?, ?, NOW())",
          [err.message, userId]
        );
      } catch (logErr) {}
    }
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}
