import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import { getEvolutionConfig, maskToken } from "@/lib/evolutionConfig";

export const dynamic = "force-dynamic";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

// Evolution 连接配置统一走 @/lib/evolutionConfig（环境变量优先，其次用户/管理员配置）


// ─── GET /api/instances — 获取当前用户的实例列表 ────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role = session.user.role?.toUpperCase();
  const conn = await getConn();

  try {
    const config = await getEvolutionConfig(conn, userId);
    if (!config) {
      return NextResponse.json({ error: "Evolution API 未配置，请先在系统设置中配置 API 地址和密钥" }, { status: 400 });
    }

    // 调用 Evolution API 获取所有实例
    const response = await fetch(`${config.url}/instance/fetchInstances`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "apikey": config.apikey
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: `无法获取实例列表: ${errText}` }, { status: response.status });
    }

    const allInstances = await response.json();
    if (!Array.isArray(allInstances)) {
      return NextResponse.json([]);
    }

    // 查询系统中的所有用户（用来帮管理员进行前缀匹配映射和配额判定）
    const [users]: any = await conn.execute("SELECT id, name, email, maxInstances FROM User");
    const userMap = new Map(users.map((u: any) => [u.id, u]));
    const userQuotaMap = new Map<string, number>(users.map((u: any) => [u.id, Number(u.maxInstances ?? 1)]));

    // 查询 InstanceConfig 获取别名映射
    let dbConfigs: any[] = [];
    if (role === "ADMIN") {
      const [rows]: any = await conn.execute("SELECT instanceName, alias FROM InstanceConfig");
      dbConfigs = rows;
    } else {
      const [rows]: any = await conn.execute(
        "SELECT instanceName, alias FROM InstanceConfig WHERE userId = ?",
        [userId]
      );
      dbConfigs = rows;
    }
    const aliasMap = new Map<string, string>(
      dbConfigs.map((c: any) => [c.instanceName, c.alias])
    );

    const filteredInstances = allInstances
      .map((item: any) => {
        // 兼容 Evolution API v2 的嵌套 instance 格式
        const inst = item.instance ? { ...item.instance, ...item } : item;
        const name = inst.instanceName || inst.name || "";
        const match = name.match(/^usr_(cmc[a-zA-Z0-9]+)_(.+)$/i);

        // 实例 token 只允许在服务端使用，绝不返回给浏览器：
        // 这里取出后仅生成掩码，并从对象里彻底剔除 token / apikey / hash 字段。
        const rawToken =
          inst.token || inst.apikey || inst.hash?.apikey || inst.hash || item.hash?.apikey || item.hash || "";
        const { token: _dropToken, apikey: _dropApikey, hash: _dropHash, ...safeInst } = inst as any;

        if (match) {
          const ownerId = match[1];
          const displayName = aliasMap.get(name) || match[2];
          const owner = userMap.get(ownerId) as any;

          return {
            ...safeInst,
            rawName: name,
            displayName: displayName, // 剥离前缀后的显示名称，或使用别名
            ownerId: ownerId,
            ownerName: owner?.name || "未知用户",
            ownerEmail: owner?.email || "未知邮箱",
            tokenMask: maskToken(rawToken)
          };
        }

        // 没有 usr_ 前缀的，归类为管理员或全局公共实例
        return {
          ...safeInst,
          rawName: name,
          displayName: aliasMap.get(name) || name,
          ownerId: "system",
          ownerName: "系统全局",
          ownerEmail: "system",
          tokenMask: maskToken(rawToken)
        };
      })
      .filter((inst: any) => {
        // 如果是管理员，可以看到全量实例
        if (role === "ADMIN") return true;
        // 如果是普通操作员，只能看到前缀匹配属于自己的实例
        return inst.ownerId === userId;
      });

    // ─── 配额计算逻辑 (方案 A：置灰并停止使用，重新升配后可直接恢复) ───
    const groups: Record<string, any[]> = {};
    filteredInstances.forEach((inst: any) => {
      const ownerId = inst.ownerId || "system";
      if (!groups[ownerId]) groups[ownerId] = [];
      groups[ownerId].push(inst);
    });

    const processedInstances: any[] = [];
    Object.entries(groups).forEach(([ownerId, list]) => {
      const quota = ownerId === "system" ? 999999 : (userQuotaMap.get(ownerId) ?? 1);
      
      // 排序以确定哪些属于超配额：若有创建时间则按创建时间升序（最旧的实例排在前面，优先保留），否则按别名排序
      list.sort((a, b) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeA && timeB) return timeA - timeB;
        return (a.displayName || "").localeCompare(b.displayName || "");
      });

      list.forEach((inst, index) => {
        inst.isOverQuota = index >= quota;
        inst.quotaIndex = index + 1;
        inst.maxInstances = quota;
        processedInstances.push(inst);
      });
    });

    return NextResponse.json(processedInstances);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

// ─── POST /api/instances/create — 创建新的绑定实例 ──────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role = session.user.role?.toUpperCase();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const { instanceName, phoneNumber } = body;
  if (!instanceName || !phoneNumber) {
    return NextResponse.json({ error: "实例名称和手机号为必填字段" }, { status: 400 });
  }

  const conn = await getConn();
  try {
    // 1. 进行配额校验 (如果是普通操作员)
    if (role !== "ADMIN") {
      const [userRows]: any = await conn.execute(
        "SELECT maxInstances FROM User WHERE id = ? LIMIT 1",
        [userId]
      );
      const maxInstances = userRows[0]?.maxInstances ?? 1;

      // 从 Evolution API 拉取属于该用户的实例数量
      const config = await getEvolutionConfig(conn, userId);
      if (!config) {
        return NextResponse.json({ error: "Evolution API 未配置，请联系管理员" }, { status: 400 });
      }

      const listResponse = await fetch(`${config.url}/instance/fetchInstances`, {
        method: "GET",
        headers: { "apikey": config.apikey },
        cache: "no-store"
      });

      if (listResponse.ok) {
        const allInstances = await listResponse.json();
        if (Array.isArray(allInstances)) {
          const userPrefix = `usr_${userId}_`;
          const myInstancesCount = allInstances.filter((item: any) => {
            const inst = item.instance ? { ...item.instance, ...item } : item;
            const name = inst.instanceName || inst.name || "";
            return name.toLowerCase().startsWith(userPrefix.toLowerCase());
          }).length;

          if (myInstancesCount >= maxInstances) {
            return NextResponse.json({
              error: "QuotaExceeded",
              message: `已达到您的最大实例绑定上限（当前配额：${maxInstances} 个），如需绑定更多请联系管理员提升额度。`
            }, { status: 400 });
          }
        }
      }
    }

    // 2. 调用 Evolution API 真实创建实例
    const config = await getEvolutionConfig(conn, userId);
    if (!config) {
      return NextResponse.json({ error: "Evolution API 未配置，请先在系统设置中配置" }, { status: 400 });
    }

    // 将实例名称强制加上用户 ID 前缀进行多租户隔离
    const prefixedName = `usr_${userId}_${instanceName.trim()}`;

    const createPayload = {
      instanceName: prefixedName,
      number: phoneNumber.trim(),
      qrcode: true,
      integration: "WHATSAPP-BAILEYS"
    };

    const response = await fetch(`${config.url}/instance/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": config.apikey
      },
      body: JSON.stringify(createPayload)
    });

    const resJson = await response.json();
    if (!response.ok) {
      return NextResponse.json({ 
        error: resJson.response?.message || resJson.message || "创建实例失败", 
        details: resJson 
      }, { status: response.status });
    }

    // 2.1 自动注册 Webhook 到该新创建的实例 (方案 B 核心逻辑)
    try {
      // 尝试获取该用户的 webhook 地址
      const [settingsRows]: any = await conn.execute(
        "SELECT evolutionWebhookUrl FROM AppSettings WHERE userId COLLATE utf8mb4_unicode_ci = ? LIMIT 1",
        [userId]
      );
      let evolutionWebhookUrl = settingsRows[0]?.evolutionWebhookUrl || "";

      // 兜底：如果为空，则获取系统管理员的 webhook 配置作为主渠道共享
      if (!evolutionWebhookUrl) {
        const [adminUsers]: any = await conn.execute(
          "SELECT id FROM User WHERE role = 'ADMIN' LIMIT 1"
        );
        if (adminUsers[0]) {
          const adminId = adminUsers[0].id;
          const [adminSettings]: any = await conn.execute(
            "SELECT evolutionWebhookUrl FROM AppSettings WHERE userId COLLATE utf8mb4_unicode_ci = ? LIMIT 1",
            [adminId]
          );
          evolutionWebhookUrl = adminSettings[0]?.evolutionWebhookUrl || "";
        }
      }

      // 再次兜底：获取全局默认配置
      if (!evolutionWebhookUrl) {
        const [defaultSettings]: any = await conn.execute(
          "SELECT evolutionWebhookUrl FROM AppSettings WHERE id = 'default' LIMIT 1"
        );
        evolutionWebhookUrl = defaultSettings[0]?.evolutionWebhookUrl || "";
      }

      if (evolutionWebhookUrl) {
        await fetch(`${config.url}/webhook/set/${prefixedName}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": config.apikey
          },
          body: JSON.stringify({
            enabled: true,
            url: evolutionWebhookUrl,
            webhookByEvents: false,
            events: ["MESSAGES_UPSERT"],
            webhook: {
              enabled: true,
              url: evolutionWebhookUrl,
              webhookByEvents: false,
              events: ["MESSAGES_UPSERT"]
            }
          })
        });
      }
    } catch (webhookErr) {
      console.error("[Evolution Webhook] Failed to register webhook automatically:", webhookErr);
    }

    // 实例 token 由 Evolution 在创建时返回，属于服务端机密：
    // 这里不返回给前端，前端只需要二维码来扫码绑定。
    return NextResponse.json({
      success: true,
      instanceName: instanceName.trim(),
      rawName: prefixedName,
      qrcode: resJson.qrcode?.base64 || null
    });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}

// ─── DELETE /api/instances — 解绑并删除实例 ────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const role = session.user.role?.toUpperCase();

  const { searchParams } = new URL(req.url);
  const rawName = searchParams.get("instanceName"); // 这是带有 usr_ 前缀的真实名称

  if (!rawName) {
    return NextResponse.json({ error: "缺少 instanceName 参数" }, { status: 400 });
  }

  // 安全检查：如果不是管理员，必须以自己的用户 ID 前缀开头，防止越权删除别人的实例
  const userPrefix = `usr_${userId}_`;
  if (role !== "ADMIN" && !rawName.startsWith(userPrefix)) {
    return NextResponse.json({ error: "Forbidden: 您无权删除或解绑此实例" }, { status: 403 });
  }

  const conn = await getConn();
  try {
    const config = await getEvolutionConfig(conn, userId);
    if (!config) {
      return NextResponse.json({ error: "Evolution API 未配置" }, { status: 400 });
    }

    // 调用 Evolution API 进行删除
    const response = await fetch(`${config.url}/instance/delete/${rawName}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "apikey": config.apikey
      }
    });

    const resJson = await response.json();
    if (!response.ok && response.status !== 404) {
      return NextResponse.json({ 
        error: resJson.message || "解绑实例失败", 
        details: resJson 
      }, { status: response.status });
    }

    return NextResponse.json({ success: true, message: "解绑并删除实例成功" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
