import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = (session.user as any).role?.toUpperCase() || "OPERATOR";
  if (role !== "ADMIN") return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });

  try {
    const { id, isFolder, sharedType, sharedTo } = await req.json();
    if (!id || !sharedType) return NextResponse.json({ error: "Missing required parameters" }, { status: 400 });

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      const table = isFolder ? "`MaterialFolder`" : "`Material`";
      const sharedToVal = Array.isArray(sharedTo) ? JSON.stringify(sharedTo) : null;

      await conn.execute(
        `UPDATE ${table} SET sharedType = ?, sharedTo = ? WHERE id = ?`,
        [sharedType, sharedToVal, id]
      );
      return NextResponse.json({ success: true });
    } finally {
      await conn.end();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
