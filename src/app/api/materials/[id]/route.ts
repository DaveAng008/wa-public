import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

// 素材的删除/编辑必须校验归属：普通用户只能操作自己的素材，管理员可操作全部。

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = session.user.id;
  const isAdmin = (session.user as any).role?.toUpperCase() === "ADMIN";

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [result]: any = await conn.execute(
      `DELETE FROM Material WHERE id = ?${isAdmin ? "" : " AND userId = ?"}`,
      isAdmin ? [id] : [id, userId]
    );
    if (!isAdmin && result?.affectedRows === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[materials/:id] DELETE failed:", error?.message);
    return NextResponse.json({ error: "删除素材失败" }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = session.user.id;
  const isAdmin = (session.user as any).role?.toUpperCase() === "ADMIN";
  const body = await req.json();
  const { name, type, content, url, folderId } = body;

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [result]: any = await conn.execute(
      `UPDATE Material SET name = ?, type = ?, content = ?, url = ?, folderId = ?
        WHERE id = ?${isAdmin ? "" : " AND userId = ?"}`,
      isAdmin
        ? [name, type, content || null, url || null, folderId || null, id]
        : [name, type, content || null, url || null, folderId || null, id, userId]
    );
    if (!isAdmin && result?.affectedRows === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[materials/:id] PUT failed:", error?.message);
    return NextResponse.json({ error: "保存素材失败" }, { status: 500 });
  } finally {
    await conn.end();
  }
}
