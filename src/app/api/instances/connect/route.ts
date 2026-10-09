import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import { getEvolutionConfig } from "@/lib/evolutionConfig";

export const dynamic = "force-dynamic";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}


// ─── GET /api/instances/connect — 刷新获取二维码或验证码（OTP） ─────────────────
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role = session.user.role?.toUpperCase();
  
  const { searchParams } = new URL(req.url);
  const rawName = searchParams.get("instanceName"); // 带有 usr_ 前缀的真实名称
  const method = searchParams.get("method") || "qr"; // qr 或 pairing
  const phoneNumber = searchParams.get("phoneNumber") || ""; // 手机号

  if (!rawName) {
    return NextResponse.json({ error: "缺少 instanceName 参数" }, { status: 400 });
  }

  // 安全检查：如果不是管理员，必须以自己的用户 ID 前缀开头，防止越权操作别人的实例
  const userPrefix = `usr_${userId}_`;
  if (role !== "ADMIN" && !rawName.startsWith(userPrefix)) {
    return NextResponse.json({ error: "Forbidden: 您无权连接或获取此实例的信息" }, { status: 403 });
  }

  const conn = await getConn();
  try {
    const config = await getEvolutionConfig(conn, userId);
    if (!config) {
      return NextResponse.json({ error: "Evolution API 未配置，请联系管理员配置接口地址" }, { status: 400 });
    }

    if (method === "pairing") {
      const cleanPhone = phoneNumber.replace(/[^0-9]/g, "");
      if (!cleanPhone) {
        return NextResponse.json({ error: "用验证码绑定时必须提供有效的手机号" }, { status: 400 });
      }

      // 获取验证码 (Pairing Code) 
      // Evolution API v2: GET /instance/connect/{instanceName}?number={phoneNumber}
      const response = await fetch(`${config.url}/instance/connect/${rawName}?number=${cleanPhone}`, {
        method: "GET",
        headers: {
          "apikey": config.apikey
        },
        cache: "no-store"
      });

      const resJson = await response.json();
      if (!response.ok) {
        return NextResponse.json({ 
          error: resJson.message || resJson.response?.message || "生成连接验证码失败", 
          details: resJson 
        }, { status: response.status });
      }

      let pCode = resJson.pairingCode || resJson.code || null;
      if (pCode && (pCode.includes(",") || pCode.length > 12)) {
        return NextResponse.json({ 
          error: "该实例在群发服务器上仍处于已连接（Open）状态，无法生成8位绑定码。请先在列表页点击“断开连接（Logout）”彻底断开，然后再试。" 
        }, { status: 400 });
      }

      return NextResponse.json({
        success: true,
        pairingCode: pCode
      });
    } else {
      // 获取/刷新二维码 (QR Code)
      // Evolution API v2: GET /instance/connect/{instanceName}
      const response = await fetch(`${config.url}/instance/connect/${rawName}`, {
        method: "GET",
        headers: {
          "apikey": config.apikey
        },
        cache: "no-store"
      });

      const resJson = await response.json();
      if (!response.ok) {
        return NextResponse.json({ 
          error: resJson.message || resJson.response?.message || "获取连接二维码失败", 
          details: resJson 
        }, { status: response.status });
      }

      const qrBase64 = resJson.qrcode?.base64 || resJson.base64 || null;
      return NextResponse.json({
        success: true,
        qrcode: qrBase64
      });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
