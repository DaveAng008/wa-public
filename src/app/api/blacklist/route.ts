import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

function generateId() {
  return "blk_" + Math.random().toString(36).slice(2, 12);
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await getConn();
  try {
    const [rows]: any = await conn.execute(
      `SELECT b.*, u.name as addedByName 
       FROM Blacklist b 
       LEFT JOIN User u ON b.addedById = u.id 
       ORDER BY b.createdAt DESC`
    );
    const entries = rows.map((row: any) => ({
      id: row.id,
      phone: row.phone,
      name: row.name,
      reason: row.reason,
      addedBy: {
        id: row.addedById,
        name: row.addedByName || "系统"
      },
      createdAt: row.createdAt
    }));
    return NextResponse.json(entries);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone, reason, name } = await req.json();
  if (!phone) return NextResponse.json({ error: "Phone is required" }, { status: 400 });

  const conn = await getConn();
  try {
    const id = generateId();
    await conn.execute(
      "INSERT INTO Blacklist (id, phone, name, reason, addedById, userId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, phone.trim(), name?.trim() || null, reason?.trim() || "", session.user.id, session.user.id, new Date()]
    );
    return NextResponse.json({ id, phone, name, reason, success: true });
  } catch (e: any) {
    if (e.message.includes("Duplicate entry")) {
      return NextResponse.json({ error: "该号码已在黑名单中" }, { status: 409 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") || searchParams.get("phone");

  if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    await conn.execute("DELETE FROM Blacklist WHERE id = ? OR phone = ?", [id, id]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

