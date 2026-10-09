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
      // 管理员获取自己的文件夹
      [rows] = await conn.execute("SELECT f.*, u.name as userName FROM MaterialFolder f LEFT JOIN User u ON f.userId = u.id WHERE f.userId = ? ORDER BY f.createdAt DESC", [userId]);
    } else {
      // 操作员获取自己的文件夹，以及管理员共享给全体或特定本人的文件夹
      try {
        [rows] = await conn.execute(
          "SELECT f.*, u.name as userName FROM MaterialFolder f LEFT JOIN User u ON f.userId = u.id WHERE f.userId = ? OR f.sharedType = 'SYSTEM' OR (f.sharedType = 'SPECIFIC' AND f.sharedTo LIKE ?) ORDER BY f.createdAt DESC",
          [userId, `%\"${userId}\"%`]
        );
      } catch (sqlError: any) {
        if (sqlError.code === "ER_BAD_FIELD_ERROR" || sqlError.message.includes("sharedType")) {
          [rows] = await conn.execute(
            "SELECT f.*, u.name as userName FROM MaterialFolder f LEFT JOIN User u ON f.userId = u.id WHERE f.userId = ? ORDER BY f.createdAt DESC",
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
    const { name, parentId } = await req.json();
    if (!name) return NextResponse.json({ error: "Folder name is required" }, { status: 400 });

    const id = "fold_" + crypto.randomBytes(5).toString("hex");
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      await conn.execute(
        "INSERT INTO MaterialFolder (id, name, userId, parentId) VALUES (?, ?, ?, ?)",
        [id, name, userId, parentId || null]
      );
      return NextResponse.json({ success: true, id, name, parentId });
    } finally {
      await conn.end();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
