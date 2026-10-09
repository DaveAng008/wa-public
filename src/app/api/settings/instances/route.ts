import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const conn = await getConn();
  try {
    const [rows]: any = await conn.execute(
      "SELECT instanceName, allowKanban, allowHub, allowSync, alias FROM InstanceConfig WHERE userId = ?",
      [userId]
    );
    return NextResponse.json(rows);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const isAdmin = (session.user as any).role?.toUpperCase() === "ADMIN";
  try {
    const body = await req.json();
    const { instanceName, allowKanban, allowHub, allowSync, alias } = body;
    if (!instanceName) {
      return NextResponse.json({ error: "Missing instanceName" }, { status: 400 });
    }

    // 归属校验：普通用户只能维护自己前缀下的实例，防止把别人的实例写进自己名下
    // （实例命名规则为 usr_<userId>_<别名>，租户解析依赖该前缀）
    if (!isAdmin && !String(instanceName).startsWith(`usr_${userId}_`)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const conn = await getConn();
    try {
      const id = "ic_" + Math.random().toString(36).slice(2, 22);
      await conn.execute(
        `INSERT INTO InstanceConfig (id, instanceName, allowKanban, allowHub, allowSync, alias, userId) 
         VALUES (?, ?, ?, ?, ?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
           allowKanban = VALUES(allowKanban), 
           allowHub = VALUES(allowHub), 
           allowSync = VALUES(allowSync), 
           alias = VALUES(alias), 
           updatedAt = NOW()`,
        [
          id,
          instanceName,
          allowKanban === true || allowKanban === 1 ? 1 : 0,
          allowHub === true || allowHub === 1 ? 1 : 0,
          allowSync === true || allowSync === 1 ? 1 : 0,
          alias !== undefined ? alias : null,
          userId
        ]
      );
      return NextResponse.json({ success: true });
    } catch (e: any) {
      console.error("[settings/instances] POST failed:", e?.message);
      return NextResponse.json({ error: "保存实例配置失败" }, { status: 500 });
    } finally {
      await conn.end();
    }
  } catch (e: any) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}
