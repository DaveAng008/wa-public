import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  try {
    const { materialIds } = await req.json();
    if (!materialIds || !Array.isArray(materialIds) || materialIds.length === 0) {
      return NextResponse.json({ error: "Missing materialIds list" }, { status: 400 });
    }

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      // 仅能申请共享自己名下的素材
      const placeholders = materialIds.map(() => "?").join(",");
      await conn.execute(
        `UPDATE \`Material\` SET sharedType = 'ADMIN_REVIEW' WHERE id IN (${placeholders}) AND userId = ?`,
        [...materialIds, userId]
      );
      return NextResponse.json({ success: true });
    } finally {
      await conn.end();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
