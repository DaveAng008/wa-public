import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import crypto from "crypto";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const role = (session.user as any).role?.toUpperCase() || "OPERATOR";
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    let rows;
    if (role === "ADMIN") {
      // 管理员获取自己的素材，以及操作员提交审核的素材
      try {
        [rows] = await conn.execute(
          "SELECT m.*, u.name as userName FROM Material m LEFT JOIN User u ON m.userId = u.id WHERE m.userId = ? OR m.sharedType = 'ADMIN_REVIEW' ORDER BY m.createdAt DESC",
          [userId]
        );
      } catch (sqlError: any) {
        if (sqlError.code === "ER_BAD_FIELD_ERROR" || sqlError.message.includes("sharedType")) {
          [rows] = await conn.execute(
            "SELECT m.*, u.name as userName FROM Material m LEFT JOIN User u ON m.userId = u.id WHERE m.userId = ? ORDER BY m.createdAt DESC",
            [userId]
          );
        } else {
          throw sqlError;
        }
      }
    } else {
      // 操作员获取自己的素材，以及管理员共享给全体或特定本人的素材
      try {
        [rows] = await conn.execute(
          "SELECT m.*, u.name as userName FROM Material m LEFT JOIN User u ON m.userId = u.id WHERE m.userId = ? OR m.sharedType = 'SYSTEM' OR (m.sharedType = 'SPECIFIC' AND m.sharedTo LIKE ?) ORDER BY m.createdAt DESC",
          [userId, `%\"${userId}\"%`]
        );
      } catch (sqlError: any) {
        if (sqlError.code === "ER_BAD_FIELD_ERROR" || sqlError.message.includes("sharedType")) {
          [rows] = await conn.execute(
            "SELECT m.*, u.name as userName FROM Material m LEFT JOIN User u ON m.userId = u.id WHERE m.userId = ? ORDER BY m.createdAt DESC",
            [userId]
          );
        } else {
          throw sqlError;
        }
      }
    }
    return NextResponse.json(rows);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  try {
    const data = await req.json();
    const id = "mat_" + crypto.randomBytes(5).toString("hex");
    const { name, type, content, url, folderId } = data;

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      await conn.execute(
        "INSERT INTO Material (id, name, type, content, url, folderId, userId) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, name, type, content || null, url || null, folderId || null, userId]
      );
      return NextResponse.json({ success: true, id });
    } finally {
      await conn.end();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
