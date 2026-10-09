import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

// 素材文件夹的删除/重命名必须校验归属，并且递归删除只能作用在该用户自己的树上。

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const userId = session.user.id;
  const isAdmin = (session.user as any).role?.toUpperCase() === "ADMIN";

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    // 先确认这个文件夹确实属于当前用户（管理员跳过）
    if (!isAdmin) {
      const [own]: any = await conn.execute(
        "SELECT id FROM MaterialFolder WHERE id = ? AND userId = ? LIMIT 1",
        [id, userId]
      );
      if (!own || own.length === 0) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    const scopeFolder = isAdmin ? "" : " AND userId = ?";
    const scopeMaterial = isAdmin ? "" : " AND userId = ?";

    const deleteFolderRecursive = async (folderId: string) => {
      const [rows]: any = await conn.execute(
        `SELECT id FROM MaterialFolder WHERE parentId = ?${scopeFolder}`,
        isAdmin ? [folderId] : [folderId, userId]
      );
      for (const row of rows) {
        await deleteFolderRecursive(row.id);
      }
      await conn.execute(
        `DELETE FROM Material WHERE folderId = ?${scopeMaterial}`,
        isAdmin ? [folderId] : [folderId, userId]
      );
      await conn.execute(
        `DELETE FROM MaterialFolder WHERE id = ?${scopeFolder}`,
        isAdmin ? [folderId] : [folderId, userId]
      );
    };

    await deleteFolderRecursive(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[material-folders/:id] DELETE failed:", error?.message);
    return NextResponse.json({ error: "删除文件夹失败" }, { status: 500 });
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
  const { name, parentId } = body;

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const scope = isAdmin ? "" : " AND userId = ?";
    const [result]: any =
      parentId !== undefined
        ? await conn.execute(
            `UPDATE MaterialFolder SET name = ?, parentId = ? WHERE id = ?${scope}`,
            isAdmin ? [name, parentId || null, id] : [name, parentId || null, id, userId]
          )
        : await conn.execute(
            `UPDATE MaterialFolder SET name = ? WHERE id = ?${scope}`,
            isAdmin ? [name, id] : [name, id, userId]
          );

    if (!isAdmin && result?.affectedRows === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[material-folders/:id] PUT failed:", error?.message);
    return NextResponse.json({ error: "保存文件夹失败" }, { status: 500 });
  } finally {
    await conn.end();
  }
}
