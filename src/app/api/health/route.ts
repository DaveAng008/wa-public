import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// 容器健康检查端点（docker-compose healthcheck / Coolify 健康检查用）
export async function GET() {
  return NextResponse.json({ ok: true, ts: Date.now() });
}
