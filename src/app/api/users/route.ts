import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";

// ─── DB connection helper ────────────────────────────────────────────────────
async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

function generateId() {
  return "cmc" + Math.random().toString(36).slice(2, 22);
}

// Helper to check admin role
async function isAdmin() {
  const session = await auth();
  return session?.user?.role?.toUpperCase() === "ADMIN";
}

// ─── GET /api/users — list all users ────────────────────────────────────────
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await getConn();
  try {
    const isUserAdmin = session?.user?.role?.toUpperCase() === "ADMIN";
    if (isUserAdmin) {
      const [rows] = await conn.execute<any[]>(
        "SELECT id, name, email, role, maxInstances, kanbanEnabled, automationsEnabled, createdAt FROM User ORDER BY createdAt ASC"
      );
      const users = rows.map((u) => ({
        ...u,
        role: u.role?.toLowerCase(),
        kanbanEnabled: !!u.kanbanEnabled,
        automationsEnabled: !!u.automationsEnabled
      }));
      return NextResponse.json(users);
    } else {
      const [rows] = await conn.execute<any[]>(
        "SELECT id, name FROM User ORDER BY name ASC"
      );
      return NextResponse.json(rows);
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

// ─── POST /api/users — create a new user ────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!await isAdmin()) {
    return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
  }

  const { name, email, password, role, maxInstances, kanbanEnabled, automationsEnabled } = await req.json();

  if (!name || !email || !password) {
    return NextResponse.json({ error: "缺少必填字段" }, { status: 400 });
  }

  const conn = await getConn();
  try {
    const [existing] = await conn.execute<any[]>(
      "SELECT id FROM User WHERE email = ? LIMIT 1",
      [email]
    );
    if (existing.length > 0) {
      return NextResponse.json({ error: "该邮箱已存在" }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const id = generateId();
    const normalizedRole = (role || "operator").toUpperCase();
    const limit = maxInstances !== undefined ? parseInt(maxInstances) || 1 : 1;
    const kbEnabled = kanbanEnabled === true || kanbanEnabled === "true" || kanbanEnabled === 1 ? 1 : 0;
    const autoEnabled = automationsEnabled === true || automationsEnabled === "true" || automationsEnabled === 1 ? 1 : 0;
    const now = new Date();

    await conn.execute(
      "INSERT INTO User (id, name, email, passwordHash, role, maxInstances, kanbanEnabled, automationsEnabled, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, name, email, passwordHash, normalizedRole, limit, kbEnabled, autoEnabled, now, now]
    );

    return NextResponse.json({
      id,
      name,
      email,
      role: normalizedRole.toLowerCase(),
      maxInstances: limit,
      kanbanEnabled: !!kbEnabled,
      automationsEnabled: !!autoEnabled,
      createdAt: now.toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

// ─── PATCH /api/users?id=xxx — update role ──────────────────────────────────
export async function PATCH(req: NextRequest) {
  if (!await isAdmin()) {
    return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const { role, password, name, email, maxInstances, kanbanEnabled, automationsEnabled } = await req.json();

  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  const conn = await getConn();
  try {
    let sql = "UPDATE User SET updatedAt = ?";
    let params: any[] = [new Date()];

    if (role) {
      sql += ", role = ?";
      params.push(role.toUpperCase());
    }
    if (name) {
      sql += ", name = ?";
      params.push(name);
    }
    if (email) {
      sql += ", email = ?";
      params.push(email);
    }
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      sql += ", passwordHash = ?";
      params.push(passwordHash);
    }
    if (maxInstances !== undefined) {
      sql += ", maxInstances = ?";
      params.push(parseInt(maxInstances) || 1);
    }
    if (kanbanEnabled !== undefined) {
      sql += ", kanbanEnabled = ?";
      params.push(kanbanEnabled === true || kanbanEnabled === "true" || kanbanEnabled === 1 ? 1 : 0);
    }
    if (automationsEnabled !== undefined) {
      sql += ", automationsEnabled = ?";
      params.push(automationsEnabled === true || automationsEnabled === "true" || automationsEnabled === 1 ? 1 : 0);
    }

    sql += " WHERE id = ?";
    params.push(id);

    await conn.execute(sql, params);
    const [rows] = await conn.execute<any[]>(
      "SELECT id, name, email, role, maxInstances, kanbanEnabled, automationsEnabled, createdAt FROM User WHERE id = ? LIMIT 1",
      [id]
    );
    const user = rows[0];
    return NextResponse.json({
      ...user,
      role: user.role?.toLowerCase(),
      kanbanEnabled: !!user.kanbanEnabled,
      automationsEnabled: !!user.automationsEnabled
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

// ─── DELETE /api/users?id=xxx — delete a user ───────────────────────────────
export async function DELETE(req: NextRequest) {
  if (!await isAdmin()) {
    return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  const conn = await getConn();
  try {
    await conn.execute("DELETE FROM User WHERE id = ?", [id]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
