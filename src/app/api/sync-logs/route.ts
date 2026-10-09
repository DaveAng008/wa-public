import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session?.user?.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [logs]: any = await conn.execute(
      "SELECT * FROM SyncLog WHERE userId = ? ORDER BY createdAt DESC LIMIT 50",
      [userId]
    );

    return NextResponse.json(logs);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
