import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    // 获取当前用户的所有看板视图，以及共享给该团队的看板视图
    const [views]: any = await conn.execute(
      "SELECT * FROM KanbanView WHERE userId = ? OR isShared = 1 ORDER BY isDefault DESC, createdAt DESC",
      [userId]
    );

    const formattedViews = views.map((v: any) => ({
      ...v,
      hiddenStepIds: v.hiddenStepIds ? JSON.parse(v.hiddenStepIds) : [],
      slaConfig: v.slaConfig ? JSON.parse(v.slaConfig) : null,
      stepsConfig: v.stepsConfig ? JSON.parse(v.stepsConfig) : null,
      cardLayout: v.cardLayout ? JSON.parse(v.cardLayout) : null,
      instances: v.instances ? JSON.parse(v.instances) : [],
      isDefault: !!v.isDefault,
      isShared: !!v.isShared,
    }));

    return NextResponse.json(formattedViews);
  } catch (error: any) {
    console.error("GET Kanban Views Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    const body = await req.json();
    const {
      id,
      name,
      sourceId,
      groupId,
      hiddenStepIds,
      slaConfig,
      stepsConfig,
      cardLayout,
      instances,
      isDefault,
      isShared,
    } = body;

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const viewId = id || "kbv_" + Math.random().toString(36).slice(2, 12);

    // 如果设置为默认视图，先把其他视图的 isDefault 置为 0
    if (isDefault) {
      await conn.execute("UPDATE KanbanView SET isDefault = 0 WHERE userId = ?", [userId]);
    }

    // 检查是否已存在
    const [existing]: any = await conn.execute("SELECT id FROM KanbanView WHERE id = ? LIMIT 1", [viewId]);

    const hiddenStepIdsStr = hiddenStepIds ? JSON.stringify(hiddenStepIds) : "[]";
    const slaConfigStr = slaConfig ? JSON.stringify(slaConfig) : null;
    const stepsConfigStr = stepsConfig ? JSON.stringify(stepsConfig) : null;
    const cardLayoutStr = cardLayout ? JSON.stringify(cardLayout) : null;
    const instancesStr = instances ? JSON.stringify(instances) : "[]";
    const isDefaultVal = isDefault ? 1 : 0;
    const isSharedVal = isShared ? 1 : 0;

    if (existing.length > 0) {
      // 更新
      await conn.execute(
        "UPDATE KanbanView SET name = ?, sourceId = ?, groupId = ?, hiddenStepIds = ?, slaConfig = ?, stepsConfig = ?, cardLayout = ?, instances = ?, isDefault = ?, isShared = ?, updatedAt = NOW() WHERE id = ? AND userId = ?",
        [
          name,
          sourceId || null,
          groupId || null,
          hiddenStepIdsStr,
          slaConfigStr,
          stepsConfigStr,
          cardLayoutStr,
          instancesStr,
          isDefaultVal,
          isSharedVal,
          viewId,
          userId,
        ]
      );
    } else {
      // 插入
      await conn.execute(
        "INSERT INTO KanbanView (id, name, userId, sourceId, groupId, hiddenStepIds, slaConfig, stepsConfig, cardLayout, instances, isDefault, isShared, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())",
        [
          viewId,
          name,
          userId,
          sourceId || null,
          groupId || null,
          hiddenStepIdsStr,
          slaConfigStr,
          stepsConfigStr,
          cardLayoutStr,
          instancesStr,
          isDefaultVal,
          isSharedVal,
        ]
      );
    }

    return NextResponse.json({ success: true, id: viewId });
  } catch (error: any) {
    console.error("POST Kanban View Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    await conn.execute("DELETE FROM KanbanView WHERE id = ? AND userId = ?", [id, userId]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE Kanban View Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
