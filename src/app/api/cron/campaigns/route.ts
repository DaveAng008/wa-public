import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { getInternalToken, isAuthorizedInternal } from "@/lib/authToken";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

function parseHHMM(timeStr: string) {
  const [h, m] = timeStr.split(":").map(Number);
  return { h, m, totalMinutes: h * 60 + m };
}

function isInsideSafeWindow(currentHHMM: string, safeStart: string, safeEnd: string) {
  if (!safeStart || !safeEnd) return true;
  const current = parseHHMM(currentHHMM).totalMinutes;
  const start = parseHHMM(safeStart).totalMinutes;
  const end = parseHHMM(safeEnd).totalMinutes;

  if (start <= end) {
    return current >= start && current <= end;
  } else {
    // 跨夜的情况，比如 22:00 到 06:00
    return current >= start || current <= end;
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedInternal(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 内部调用令牌未配置时跳过所有内部触发，避免发出注定 401 的请求
  const triggerToken = getInternalToken();

  const conn = await getConn();
  const triggeredCampaigns = [];

  try {
    const now = new Date();
    // 使用北京时间格式化 HH:MM
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const timeParts = timeFormatter.formatToParts(now);
    const hourVal = timeParts.find(p => p.type === 'hour')?.value || '00';
    const minVal = timeParts.find(p => p.type === 'minute')?.value || '00';
    const currentHHMM = `${hourVal}:${minVal}`;

    const historyTimeStr = now.toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit'
    }).replace(/\//g, '-');
    const currentMs = now.getTime();

    // 查询所有活跃的有调度配置的活动
    const [campaigns]: any = await conn.execute(
      "SELECT id, userId, scheduleConfig FROM Campaign WHERE status = 'ACTIVE' AND scheduleConfig IS NOT NULL"
    );

    for (const campaign of campaigns) {
      const { id } = campaign;
      let sc: any;
      try {
        sc = typeof campaign.scheduleConfig === 'string' ? JSON.parse(campaign.scheduleConfig) : campaign.scheduleConfig;
      } catch (e) {
        continue;
      }

      if (!sc) continue;
      const triggerType = sc.triggerType || "MANUAL";

      // 准备上海时区的当前日期字符串 YYYY-MM-DD
      const tzNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
      const yyyy = tzNow.getFullYear();
      const mm = String(tzNow.getMonth() + 1).padStart(2, '0');
      const dd = String(tzNow.getDate()).padStart(2, '0');
      const todayDateStr = `${yyyy}-${mm}-${dd}`;

      // 1. 生日触发与日期属性触发
      if (triggerType === "BIRTHDAY" || triggerType === "DATE_ATTRIBUTE") {
        const targetHourStr = triggerType === "BIRTHDAY" ? (sc.birthdayHour || "09:00") : (sc.dateAttrHour || "10:00");
        if (currentHHMM >= targetHourStr) {
          try {
            // 令牌未配置则跳过该次内部触发
            if (!triggerToken) {
              console.warn(`Campaign ${id} trigger skipped: CRON_TOKEN is not configured`);
              continue;
            }
            const host = req.headers.get('host') || 'localhost:3000';
            const protocol = host.includes('localhost') ? 'http' : 'https';
            const triggerUrl = `${protocol}://${host}/api/campaigns/${id}/trigger?token=${encodeURIComponent(triggerToken)}`;
            const res = await fetch(triggerUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
            if (res.ok) {
              const resData = await res.json();
              if (resData.contactsCount > 0) {
                triggeredCampaigns.push({ id, type: triggerType, contactsCount: resData.contactsCount });
              }
            }
          } catch (e) {
            console.error(`Error triggering daily campaign ${id}:`, e);
          }
        }
        continue;
      }

      // 2. 看板停留超时触发
      if (triggerType === "COLUMN_TIMEOUT") {
        if (isInsideSafeWindow(currentHHMM, sc.safeWindowStart, sc.safeWindowEnd)) {
          try {
            // 令牌未配置则跳过该次内部触发
            if (!triggerToken) {
              console.warn(`Campaign ${id} trigger skipped: CRON_TOKEN is not configured`);
              continue;
            }
            const host = req.headers.get('host') || 'localhost:3000';
            const protocol = host.includes('localhost') ? 'http' : 'https';
            const triggerUrl = `${protocol}://${host}/api/campaigns/${id}/trigger?token=${encodeURIComponent(triggerToken)}`;
            const res = await fetch(triggerUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
            if (res.ok) {
              const resData = await res.json();
              if (resData.contactsCount > 0) {
                triggeredCampaigns.push({ id, type: "COLUMN_TIMEOUT", contactsCount: resData.contactsCount });
              }
            }
          } catch (e) {
            console.error(`Error triggering timeout campaign ${id}:`, e);
          }
        }
        continue;
      }

      // 3. 看板进入触发 (完全是即时事件触发，cron不处理)
      if (triggerType === "COLUMN_ENTER") {
        continue;
      }

      // 4. 定时触发 (SCHEDULED)
      if (triggerType !== "SCHEDULED") continue;
      if (!sc.scheduledTime || !sc.selectedRounds || sc.selectedRounds.length === 0) continue;

      // 检查开始日期
      if (sc.scheduledDate && todayDateStr < sc.scheduledDate) {
        continue;
      }

      // 检查结束日期
      if (sc.endDate && todayDateStr > sc.endDate) {
        await conn.execute("UPDATE Campaign SET status = 'COMPLETED', scheduleConfig = ? WHERE id = ?", [JSON.stringify(sc), id]);
        continue;
      }

      // 检查星期过滤
      if (Array.isArray(sc.weekdays) && sc.weekdays.length > 0) {
        if (!sc.weekdays.includes(tzNow.getDay())) {
          continue;
        }
      }

      const state = sc.state || {};

      // 检查是否处于下一轮循环延迟等待中
      if (state.nextCycleStartTimeMs && currentMs < state.nextCycleStartTimeMs) {
        continue;
      }

      // 【核心防重】：按具体时间槽 (例如 "2026-10-07 22:22") 精准防重
      // 既避免同一时间槽被重复触发多次，又避免用户修改了时间后整天被锁死
      const currentSlot = `${todayDateStr} ${sc.scheduledTime}`;
      if (state.lastRunSlot === currentSlot) {
        continue;
      }

      // 60秒冷却保护：如果距离上一次触发不足 60 秒，跳过
      if (state.lastRunTimeMs && (currentMs - state.lastRunTimeMs) < 60 * 1000) {
        continue;
      }

      let shouldRun = false;
      const currentMins = parseHHMM(currentHHMM).totalMinutes;
      const targetMins = parseHHMM(sc.scheduledTime).totalMinutes;
      const diffMins = currentMins - targetMins;

      // 允许 0 到 2 分钟安全容错（应对定时器几秒误差或偶发的排队延迟）
      // 由于上方已锁定 lastRunSlot，同一次定时只会触发一次，绝不会多发！
      if (diffMins >= 0 && diffMins <= 2) {
        if (!state.lastRunTimeMs) {
          shouldRun = true;
        } else {
          // 再次触发：同一时间槽上面已经过滤，不同时间槽只要相隔 2 分钟以上即可
          const minsSinceLastRun = (currentMs - state.lastRunTimeMs) / (1000 * 60);
          if (minsSinceLastRun >= 2) {
            shouldRun = true;
          }
        }
      }

      if (shouldRun && isInsideSafeWindow(currentHHMM, sc.safeWindowStart, sc.safeWindowEnd)) {
        // 获取第一个待发送的轮次进行发送
        const roundToRun = sc.selectedRounds[0];

        if (roundToRun !== undefined) {
          try {
            const host = req.headers.get('host') || 'localhost:3000';
            const protocol = host.includes('localhost') ? 'http' : 'https';
            const port = process.env.PORT || 3000;

            // 令牌未配置则跳过该次内部触发
            if (!triggerToken) {
              console.warn(`Campaign ${id} trigger skipped: CRON_TOKEN is not configured`);
              continue;
            }

            // 【关键修复：先写锁再发送，防止竞态条件】
            // 记录 lastRunSlot 与 lastRunDate
            const preLockState = {
              ...sc.state,
              lastRunTimeMs: currentMs,
              lastRunDate: todayDateStr,
              lastRunSlot: currentSlot,
              nextCycleStartTimeMs: 0,
            };
            const preLockSc = { ...sc, state: preLockState };
            await conn.execute("UPDATE Campaign SET scheduleConfig = ? WHERE id = ?", [JSON.stringify(preLockSc), id]);

            // 双重通道：优先本地直连（避免容器内公网 Hairpin NAT 失败），如果本地不可用再使用公网地址
            const localUrl = `http://127.0.0.1:${port}/api/campaigns/${id}/trigger?token=${encodeURIComponent(triggerToken)}`;
            const publicUrl = `${protocol}://${host}/api/campaigns/${id}/trigger?token=${encodeURIComponent(triggerToken)}`;

            let res: Response;
            try {
              res = await fetch(localUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  batchRound: roundToRun,
                  batchSize: sc.batchSize
                }),
                signal: AbortSignal.timeout(15000)
              });
            } catch (localErr) {
              // 本地直连失败时回退到外部域名
              res = await fetch(publicUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  batchRound: roundToRun,
                  batchSize: sc.batchSize
                }),
                signal: AbortSignal.timeout(15000)
              });
            }

            if (res.ok) {
              triggeredCampaigns.push({ id, roundToRun });

              // 从 selectedRounds 剔除已发送轮次
              const newSelectedRounds = sc.selectedRounds.filter((r: number) => r !== roundToRun);

              const roundHistory = sc.state?.roundHistory || {};
              roundHistory[roundToRun] = historyTimeStr;

              sc.selectedRounds = newSelectedRounds;
              sc.state = {
                ...preLockState,
                roundHistory
              };

              // 如果所有选中的轮次都发送完毕
              if (newSelectedRounds.length === 0) {
                const currentCycle = sc.state?.currentCycle || 1;
                const repeatLimit = parseInt(sc.repeatLimit || 0, 10);

                if (sc.isRepeating && (repeatLimit === 0 || currentCycle < repeatLimit)) {
                  sc.selectedRounds = Array.from({ length: sc.totalRuns || 12 }, (_, i) => i + 1);

                  const delayDays = parseInt(sc.loopDelayDays || 0, 10);
                  const nextCycleStartTimeMs = delayDays > 0 ? (currentMs + delayDays * 24 * 60 * 60 * 1000) : 0;

                  sc.state = {
                    ...sc.state,
                    currentCycle: currentCycle + 1,
                    nextCycleStartTimeMs,
                    roundHistory: {}
                  };
                } else {
                  await conn.execute("UPDATE Campaign SET status = 'COMPLETED', scheduleConfig = ? WHERE id = ?", [JSON.stringify(sc), id]);
                  continue;
                }
              }

              await conn.execute("UPDATE Campaign SET scheduleConfig = ? WHERE id = ?", [JSON.stringify(sc), id]);
            } else {
              const errBody = await res.text().catch(() => "");
              console.error(`Failed to trigger campaign ${id}: Status ${res.status}, Body: ${errBody}`);
            }
          } catch (e) {
            console.error(`Error triggering campaign ${id}:`, e);
          }
        } else {
          await conn.execute("UPDATE Campaign SET status = 'COMPLETED' WHERE id = ?", [id]);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: `Checked ${campaigns.length} campaigns. Triggered ${triggeredCampaigns.length}.`,
      triggeredCampaigns
    });

  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}