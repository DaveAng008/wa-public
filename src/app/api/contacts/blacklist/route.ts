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
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const conn = await getConn();
  try {
    const [rows]: any = await conn.execute(
      `SELECT b.*, u.name as addedByName 
       FROM Blacklist b 
       LEFT JOIN User u ON b.addedById = u.id 
       WHERE b.userId = ? 
       ORDER BY b.createdAt DESC`,
      [userId]
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

  const userId = session.user.id;
  const body = await req.json();

  const conn = await getConn();
  try {
    const contactsToBlacklist = Array.isArray(body.contacts) ? body.contacts : [body];
    if (contactsToBlacklist.length === 0) {
      return NextResponse.json({ error: "No contacts provided" }, { status: 400 });
    }

    for (const item of contactsToBlacklist) {
      const { phone, name, reason } = item;
      if (!phone) continue;
      const id = generateId();
      await conn.execute(
        "INSERT IGNORE INTO Blacklist (id, phone, name, reason, addedById, userId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, phone.trim(), name?.trim() || null, reason?.trim() || "用户手动批量删除并拉黑", userId, userId, new Date()]
      );
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const { searchParams } = new URL(req.url);
  const idStr = searchParams.get("id") || searchParams.get("phone") || "";
  const permanent = searchParams.get("permanent") === "true";
  const history = searchParams.get("history") === "true";

  if (!idStr) return NextResponse.json({ error: "Missing ID or phone" }, { status: 400 });

  const ids = idStr.split(",").map(x => x.trim()).filter(Boolean);
  if (ids.length === 0) {
    return NextResponse.json({ error: "No valid IDs provided" }, { status: 400 });
  }

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    if (history) {
      // 洗白：从 BlacklistHistory 删除
      const placeholders = ids.map(() => "?").join(",");
      await conn.execute(
        `DELETE FROM BlacklistHistory WHERE (id IN (${placeholders}) OR phone IN (${placeholders})) AND userId = ?`,
        [...ids, ...ids, userId]
      );
    } else if (permanent) {
      // 永久删除：从 Blacklist 查询号码，插入 BlacklistHistory，然后从 Contact 和 Blacklist 彻底删除
      for (const id of ids) {
        const [rows]: any = await conn.execute(
          "SELECT phone, reason FROM Blacklist WHERE (id = ? OR phone = ?) AND userId = ? LIMIT 1",
          [id, id, userId]
        );
        if (rows[0]) {
          const phone = rows[0].phone;
          const reason = rows[0].reason || "用户手动批量永久删除";
          const histId = "hbl_" + Math.random().toString(36).slice(2, 12);
          
          await conn.execute(
            "INSERT IGNORE INTO BlacklistHistory (id, phone, userId, reason, createdAt) VALUES (?, ?, ?, ?, NOW())",
            [histId, phone, userId, reason]
          );

          await conn.execute(
            "DELETE FROM Contact WHERE phone = ? AND userId = ?",
            [phone, userId]
          );
        }
      }

      const placeholders = ids.map(() => "?").join(",");
      await conn.execute(
        `DELETE FROM Blacklist WHERE (id IN (${placeholders}) OR phone IN (${placeholders})) AND userId = ?`,
        [...ids, ...ids, userId]
      );
    } else {
      // 普通恢复（从黑名单移出）
      const placeholders = ids.map(() => "?").join(",");
      await conn.execute(
        `DELETE FROM Blacklist WHERE (id IN (${placeholders}) OR phone IN (${placeholders})) AND userId = ?`,
        [...ids, ...ids, userId]
      );
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

