import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import crypto from "crypto";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminId = session.user.id;
  const role = (session.user as any).role?.toUpperCase() || "OPERATOR";
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });

  try {
    const { id, action, sharedTo } = await req.json();
    if (!id || !action) return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      // 获取提交的素材，并验证其是否处于审核状态
      const [rows]: any = await conn.execute(
        "SELECT * FROM `Material` WHERE id = ? AND sharedType = 'ADMIN_REVIEW' LIMIT 1",
        [id]
      );
      if (rows.length === 0) {
        return NextResponse.json({ error: "素材不存在或未处于审核状态" }, { status: 404 });
      }
      const material = rows[0];

      if (action === "APPROVE_ALL") {
        // 1. 同意并全员/特定共享：设置 sharedType 和 sharedTo
        const sharedTypeVal = Array.isArray(sharedTo) && sharedTo.length > 0 ? "SPECIFIC" : "SYSTEM";
        const sharedToVal = Array.isArray(sharedTo) && sharedTo.length > 0 ? JSON.stringify(sharedTo) : null;
        await conn.execute(
          "UPDATE `Material` SET sharedType = ?, sharedTo = ? WHERE id = ?",
          [sharedTypeVal, sharedToVal, id]
        );
      } else if (action === "SAVE_SELF") {
        // 2. 仅自己收藏：克隆一份归属于管理员的名下，并将原素材归位为不共享
        const newId = "mat_" + crypto.randomBytes(5).toString("hex");
        await conn.execute(
          "INSERT INTO `Material` (id, name, type, content, url, folderId, userId, sharedType) VALUES (?, ?, ?, ?, ?, ?, ?, 'NONE')",
          [newId, material.name, material.type, material.content, material.url, null, adminId]
        );
        await conn.execute(
          "UPDATE `Material` SET sharedType = 'NONE' WHERE id = ?",
          [id]
        );
      } else if (action === "REJECT") {
        // 3. 驳回：把 sharedType 设回 NONE 即可
        await conn.execute(
          "UPDATE `Material` SET sharedType = 'NONE' WHERE id = ?",
          [id]
        );
      } else {
        return NextResponse.json({ error: "无效的审批动作" }, { status: 400 });
      }

      return NextResponse.json({ success: true });
    } finally {
      await conn.end();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
