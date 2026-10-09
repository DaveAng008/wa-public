import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import { getInternalToken } from "@/lib/authToken";

function generateId() {
  return "cmc" + Math.random().toString(36).slice(2, 22);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  // 内部调用令牌未配置时跳过后续内部触发，避免发出注定 401 的请求
  const triggerToken = getInternalToken();

  try {
    const url = new URL(req.url);
    let action = url.searchParams.get("action") || "";
    let taskId = url.searchParams.get("taskId") || "";

    const body = await req.json().catch(() => ({}));
    if (!action && body.action) action = body.action;
    if (!taskId && body.taskId) taskId = body.taskId;
    if (!taskId && body.task_id) taskId = body.task_id;

    switch (action) {
      case "createTask": {
        const contactId = "con_" + generateId();
        const name = body.title || "新客户";
        const phone = body.phone || "";
        const stepId = body.step_id || body.stepId;
        const priority = body.priority || "medium";
        const note = body.note || null;
        const rawDueDate = body.due_date || body.dueDate || null;
        const dueDate = rawDueDate ? new Date(rawDueDate) : null;
        const properties = body.properties ? (typeof body.properties === 'string' ? body.properties : JSON.stringify(body.properties)) : '{}';
        
        // 查找当前步骤的最大排序位置
        const [maxRows]: any = await conn.execute(
          "SELECT MAX(orderIndex) as maxOrder FROM Contact WHERE stepId = ? AND userId = ?",
          [stepId, userId]
        );
        const maxOrder = maxRows[0]?.maxOrder || 0;
        const newOrder = maxOrder + 100;

        await conn.execute(
          "INSERT INTO Contact (id, name, phone, stepId, priority, note, dueDate, orderIndex, userId, lastActivityAt, properties) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)",
          [contactId, name, phone, stepId, priority, note, dueDate, newOrder, userId, properties]
        );
        return NextResponse.json({ success: true, id: contactId });
      }

      case "updateTask": {
        const priority = body.priority;
        const note = body.note;
        const title = body.title;
        const phone = body.phone;
        const dueDate = body.due_date || body.dueDate;
        const stepId = body.step_id || body.stepId;
        const resetActivity = body.resetActivity || body.reset_activity;
        const properties = body.properties;

        const fields: string[] = [];
        const values: any[] = [];

        if (priority !== undefined) { fields.push("priority = ?"); values.push(priority); }
        if (note !== undefined) { fields.push("note = ?"); values.push(note); }
        if (title !== undefined) { fields.push("name = ?"); values.push(title); }
        if (phone !== undefined) { fields.push("phone = ?"); values.push(phone); }
        if (dueDate !== undefined) { fields.push("dueDate = ?"); values.push(dueDate ? new Date(dueDate) : null); }
        if (stepId !== undefined) { fields.push("stepId = ?"); values.push(stepId); }
        if (resetActivity === true) { fields.push("lastActivityAt = NOW()"); }

        if (properties !== undefined && typeof properties === 'object' && properties !== null) {
          let jsonSetExpr = "CASE WHEN JSON_VALID(properties) = 1 THEN properties ELSE '{}' END";
          const jsonSetParams: any[] = [];
          Object.keys(properties).forEach(k => {
            const escapedKey = k.replace(/"/g, '\\"');
            jsonSetExpr = `JSON_SET(${jsonSetExpr}, ?, ?)`;
            jsonSetParams.push(`$."${escapedKey}"`, properties[k]);
          });
          fields.push(`properties = ${jsonSetExpr}`);
          values.push(...jsonSetParams);
        }

        if (fields.length > 0) {
          // 除非显式声明，并且没有主动reset，否则重置闲置计时 (lastActivityAt = NOW())
          if (!body.no_reset && resetActivity === undefined) {
            if (!fields.includes("lastActivityAt = NOW()")) {
              fields.push("lastActivityAt = NOW()");
            }
          }
          const query = `UPDATE Contact SET ${fields.join(", ")} WHERE id = ? AND userId = ?`;
          values.push(taskId, userId);
          const [result]: any = await conn.execute(query, values);
          console.log(`[updateTask] taskId: ${taskId}, userId: ${userId}, affectedRows: ${result?.affectedRows}, changedRows: ${result?.changedRows}`);
          if (result?.affectedRows === 0) {
            return NextResponse.json({ error: "未找到要更新的联系人卡片，或该卡片不属于当前用户" }, { status: 404 });
          }
        }
        return NextResponse.json({ success: true });
      }

      case "deleteTask": {
        const [result]: any = await conn.execute("DELETE FROM Contact WHERE id = ? AND userId = ?", [taskId, userId]);
        console.log(`[deleteTask] taskId: ${taskId}, userId: ${userId}, affectedRows: ${result?.affectedRows}`);
        return NextResponse.json({ success: true });
      }

      case "moveCard": {
        const stepId = body.board_step_id || body.stepId;
        const newOrder = body.new_order || body.orderIndex || 0;
        const [result]: any = await conn.execute(
          "UPDATE Contact SET stepId = ?, orderIndex = ?, lastActivityAt = NOW() WHERE id = ? AND userId = ?",
          [stepId, newOrder, taskId, userId]
        );
        console.log(`[moveCard] taskId: ${taskId}, userId: ${userId}, stepId: ${stepId}, affectedRows: ${result?.affectedRows}`);
        if (result?.affectedRows === 0) {
          return NextResponse.json({ error: "移动卡片失败：未找到对应的联系人卡片，或该卡片不属于当前用户" }, { status: 404 });
        }

        // Find active campaigns for this user that trigger on COLUMN_ENTER and enterStepId = stepId
        try {
          const [campaigns]: any = await conn.execute(
            "SELECT id, scheduleConfig FROM Campaign WHERE status = 'ACTIVE' AND userId = ?",
            [userId]
          );
          
          for (const campaign of campaigns) {
            let sc: any;
            try {
              sc = typeof campaign.scheduleConfig === 'string' ? JSON.parse(campaign.scheduleConfig) : campaign.scheduleConfig;
            } catch (e) {
              continue;
            }
            if (sc && sc.triggerType === "COLUMN_ENTER" && sc.enterStepId === stepId) {
              // 令牌未配置则跳过该次内部触发
              if (!triggerToken) {
                console.warn("COLUMN_ENTER campaign trigger skipped: CRON_TOKEN is not configured");
                continue;
              }
              // Trigger campaign for this contact in the background!
              const host = req.headers.get('host') || 'localhost:3000';
              const protocol = host.includes('localhost') ? 'http' : 'https';
              const triggerUrl = `${protocol}://${host}/api/campaigns/${campaign.id}/trigger?token=${encodeURIComponent(triggerToken)}`;
              
              fetch(triggerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  targetContactId: taskId
                })
              }).catch(err => console.error("Error triggering COLUMN_ENTER campaign:", err));
            }
          }
        } catch (err) {
          console.error("Failed to check COLUMN_ENTER triggers:", err);
        }

        return NextResponse.json({ success: true });
      }

      case "createStep": {
        const stepId = "step_" + generateId();
        const name = body.title || body.name || "新阶段";
        const color = body.color || "#3b82f6";
        
        const [maxRows]: any = await conn.execute(
          "SELECT MAX(orderIndex) as maxOrder FROM ContactStep WHERE userId = ?",
          [userId]
        );
        const maxOrder = maxRows[0]?.maxOrder || 0;
        const newOrder = maxOrder + 100;

        await conn.execute(
          "INSERT INTO ContactStep (id, name, color, orderIndex, userId) VALUES (?, ?, ?, ?, ?)",
          [stepId, name, color, newOrder, userId]
        );
        return NextResponse.json({ success: true, id: stepId });
      }

      case "updateStep": {
        const stepId = body.stepId;
        const name = body.name;
        const color = body.color;

        const fields: string[] = [];
        const values: any[] = [];

        if (name !== undefined) { fields.push("name = ?"); values.push(name); }
        if (color !== undefined) { fields.push("color = ?"); values.push(color); }

        if (fields.length > 0) {
          const query = `UPDATE ContactStep SET ${fields.join(", ")} WHERE id = ? AND userId = ?`;
          values.push(stepId, userId);
          await conn.execute(query, values);
        }
        return NextResponse.json({ success: true });
      }

      case "deleteStep": {
        const stepId = body.stepId;
        // 删除该步骤
        await conn.execute("DELETE FROM ContactStep WHERE id = ? AND userId = ?", [stepId, userId]);
        // 将原步骤下的卡片归属重置
        await conn.execute("UPDATE Contact SET stepId = NULL WHERE stepId = ? AND userId = ?", [stepId, userId]);
        return NextResponse.json({ success: true });
      }

      case "saveSlaConfig": {
        const idleHours = body.idle_hours !== undefined ? body.idle_hours : 24;
        const expiringHours = body.expiring_hours !== undefined ? body.expiring_hours : 2;
        const overdueLabel = body.overdue_label || "已逾期";

        const [rows]: any = await conn.execute("SELECT id FROM AppSettings WHERE userId = ? LIMIT 1", [userId]);
        if (rows.length === 0) {
          const settingsId = "settings_" + generateId();
          await conn.execute(
            "INSERT INTO AppSettings (id, userId, slaIdleHours, slaExpiringHours, slaOverdueLabel, updatedAt) VALUES (?, ?, ?, ?, ?, NOW())",
            [settingsId, userId, idleHours, expiringHours, overdueLabel]
          );
        } else {
          await conn.execute(
            "UPDATE AppSettings SET slaIdleHours = ?, slaExpiringHours = ?, slaOverdueLabel = ?, updatedAt = NOW() WHERE userId = ?",
            [idleHours, expiringHours, overdueLabel, userId]
          );
        }
        return NextResponse.json({ success: true });
      }

      case "saveAutomationConfig": {
        const stepId = body.stepId;
        const config = body.config || [];

        if (stepId) {
          await conn.execute(
            "UPDATE ContactStep SET automationConfig = ? WHERE id = ? AND userId = ?",
            [JSON.stringify(config), stepId, userId]
          );
        } else {
          const [rows]: any = await conn.execute("SELECT id FROM AppSettings WHERE userId = ? LIMIT 1", [userId]);
          if (rows.length === 0) {
            const settingsId = "settings_" + generateId();
            await conn.execute(
              "INSERT INTO AppSettings (id, userId, automationConfig, updatedAt) VALUES (?, ?, ?, NOW())",
              [settingsId, userId, JSON.stringify(config)]
            );
          } else {
            await conn.execute(
              "UPDATE AppSettings SET automationConfig = ?, updatedAt = NOW() WHERE userId = ?",
              [JSON.stringify(config), userId]
            );
          }
        }
        return NextResponse.json({ success: true });
      }

      case "alert": {
        await conn.execute(
          "UPDATE Contact SET priority = 'urgent', lastActivityAt = NOW() WHERE id = ? AND userId = ?",
          [taskId, userId]
        );
        return NextResponse.json({ success: true });
      }

      case "quote": {
        // 极速出单：重置活跃时间表示刚跟进过
        await conn.execute(
          "UPDATE Contact SET lastActivityAt = NOW() WHERE id = ? AND userId = ?",
          [taskId, userId]
        );
        return NextResponse.json({ success: true });
      }

      case "bulkImport": {
        const data = body.data || [];
        if (data.length === 0) {
          return NextResponse.json({ success: true, count: 0 });
        }

        // 获取该用户的第一个步骤 (ContactStep)
        const [stepRows]: any = await conn.execute(
          "SELECT id FROM ContactStep WHERE userId = ? ORDER BY orderIndex ASC LIMIT 1",
          [userId]
        );
        const firstStepId = stepRows[0]?.id;
        if (!firstStepId) {
          return NextResponse.json({ error: "No steps configured. Please create a step first." }, { status: 400 });
        }

        // 查找当前步骤的最大排序位置
        const [maxRows]: any = await conn.execute(
          "SELECT MAX(orderIndex) as maxOrder FROM Contact WHERE stepId = ? AND userId = ?",
          [firstStepId, userId]
        );
        let maxOrder = maxRows[0]?.maxOrder || 0;

        for (const row of data) {
          maxOrder += 100;
          const contactId = "con_" + generateId();
          const name = row.name || "未命名客户";
          const phone = row.phone || "";
          const note = row.note || null;
          const priority = (row.priority || "medium").toLowerCase();
          const sourceLabel = row.source || "看板导入";
          const relationJson = JSON.stringify([sourceLabel]);

          // 使用 INSERT INTO ... ON DUPLICATE KEY UPDATE 确保即使电话已存在也不会报错，而是更新该客户
          await conn.execute(
            `INSERT INTO Contact (id, name, phone, stepId, priority, note, orderIndex, userId, sourceId, relation, lastActivityAt) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, NOW()) 
             ON DUPLICATE KEY UPDATE 
               name = VALUES(name), 
               stepId = VALUES(stepId), 
               priority = VALUES(priority), 
               note = VALUES(note), 
               orderIndex = VALUES(orderIndex),
               relation = VALUES(relation),
               lastActivityAt = NOW()`,
            [contactId, name, phone, firstStepId, priority, note, maxOrder, userId, relationJson]
          );
        }
        return NextResponse.json({ success: true, count: data.length });
      }

      default:
        return NextResponse.json({ error: "Action not supported" }, { status: 400 });
    }
  } catch (error: any) {
    console.error("POST Kanban Action Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
