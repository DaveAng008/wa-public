import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

function parseMultiSelectParam(param: string | null): string[] {
  if (!param) return [];
  const trimmed = param.trim();
  if (trimmed === "all" || trimmed === "undefined" || trimmed === "") {
    return [];
  }
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      return [];
    }
  }
  return trimmed.split(",").map(s => s.trim()).filter(Boolean);
}

function buildGroupFilterSql(cfg: any, params: any[]): string {
  const clauses: string[] = [];
  
  if (cfg.sourceId) {
    clauses.push("sourceId = ?");
    params.push(cfg.sourceId);
  }
  
  if (cfg.markets && Array.isArray(cfg.markets) && cfg.markets.length > 0) {
    clauses.push(`market IN (${cfg.markets.map(() => "?").join(",")})`);
    params.push(...cfg.markets);
  }
  
  if (cfg.relations && Array.isArray(cfg.relations) && cfg.relations.length > 0) {
    const relationConditions = cfg.relations.map(() => "relation LIKE ?");
    const joiner = cfg.matchMode === "ALL" ? " AND " : " OR ";
    clauses.push(`(${relationConditions.join(joiner)})`);
    cfg.relations.forEach((r: string) => params.push(`%${r}%`));
  }

  if (cfg.rules && Array.isArray(cfg.rules) && cfg.rules.length > 0) {
    const ruleConditions: string[] = [];
    cfg.rules.forEach((rule: any) => {
      const { field, operator, value } = rule;
      if (!field || !operator) return;
      let sqlField = ["name", "phone", "market", "relation"].includes(field) 
        ? `\`${field}\`` 
        : `CASE WHEN JSON_VALID(properties) = 1 THEN JSON_UNQUOTE(JSON_EXTRACT(properties, '$."${field.replace(/"/g, '\\"').replace(/'/g, "''")}"')) ELSE NULL END`;

      switch (operator) {
        case "contains": ruleConditions.push(`${sqlField} LIKE ?`); params.push(`%${value}%`); break;
        case "not_contains": ruleConditions.push(`(${sqlField} NOT LIKE ? OR ${sqlField} IS NULL)`); params.push(`%${value}%`); break;
        case "equals": ruleConditions.push(`${sqlField} = ?`); params.push(value); break;
        case "not_equals": ruleConditions.push(`(${sqlField} != ? OR ${sqlField} IS NULL)`); params.push(value); break;
        case "is_empty": ruleConditions.push(`(${sqlField} IS NULL OR ${sqlField} = '' OR ${sqlField} = 'null')`); break;
        case "is_not_empty": ruleConditions.push(`(${sqlField} IS NOT NULL AND ${sqlField} != '' AND ${sqlField} != 'null')`); break;
      }
    });

    if (ruleConditions.length > 0) {
      const joiner = cfg.ruleMatchMode === "OR" ? " OR " : " AND ";
      clauses.push(`(${ruleConditions.join(joiner)})`);
    }
  }

  if (clauses.length === 0) return "1=1";
  return `(${clauses.join(" AND ")})`;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  try {
    const url = new URL(req.url);
    const sourceId = url.searchParams.get("sourceId") || "";
    const groupId = url.searchParams.get("groupId") || "";
    const excludedGroupId = url.searchParams.get("excludedGroupId") || "";
    const viewId = url.searchParams.get("viewId") || "";

    let activeSourceIds = parseMultiSelectParam(sourceId);
    let activeGroupIds = parseMultiSelectParam(groupId);
    let excludedGroupIds = parseMultiSelectParam(excludedGroupId);

    let activeHiddenStepIds: string[] = [];
    let activeSlaConfig: any = null;
    let activeStepsConfig: any[] | null = null;
    let activeCardLayout: any = null;
    let activeInstances: string[] = [];

    if (viewId && viewId !== "all" && viewId !== "undefined") {
      const [vRows]: any = await conn.execute("SELECT * FROM KanbanView WHERE id = ? LIMIT 1", [viewId]);
      if (vRows.length > 0) {
        const v = vRows[0];
        if ((!sourceId || sourceId === "all") && v.sourceId) {
          activeSourceIds = parseMultiSelectParam(v.sourceId);
        }
        if ((!groupId || groupId === "all") && v.groupId) {
          activeGroupIds = parseMultiSelectParam(v.groupId);
        }
        if (v.hiddenStepIds) {
          try {
            activeHiddenStepIds = typeof v.hiddenStepIds === "string" ? JSON.parse(v.hiddenStepIds) : v.hiddenStepIds;
          } catch {}
        }
        if (v.slaConfig) {
          try {
            activeSlaConfig = typeof v.slaConfig === "string" ? JSON.parse(v.slaConfig) : v.slaConfig;
          } catch {}
        }
        if (v.stepsConfig) {
          try {
            activeStepsConfig = typeof v.stepsConfig === "string" ? JSON.parse(v.stepsConfig) : v.stepsConfig;
          } catch {}
        }
        if (v.cardLayout) {
          try {
            activeCardLayout = typeof v.cardLayout === "string" ? JSON.parse(v.cardLayout) : v.cardLayout;
          } catch {}
        }
        if (v.instances) {
          try {
            activeInstances = typeof v.instances === "string" ? JSON.parse(v.instances) : v.instances;
          } catch {}
        }
      }
    }

    // 1. 获取当前用户的所有看板列 (Steps)
    const [stepRows]: any = await conn.execute(
      "SELECT id, name, color, automationConfig as automation_config, orderIndex as `order` FROM ContactStep WHERE userId = ? ORDER BY orderIndex ASC",
      [userId]
    );

    let steps = stepRows.map((s: any) => ({
      ...s,
      automation_config: s.automation_config ? (typeof s.automation_config === "string" ? JSON.parse(s.automation_config) : s.automation_config) : []
    }));

    // 合并自定义看板列配置
    if (activeStepsConfig && Array.isArray(activeStepsConfig)) {
      const stepMap = new Map<string, any>(steps.map((s: any) => [s.id, s]));
      const mergedSteps: any[] = [];
      activeStepsConfig.forEach((cfg: any) => {
        const dbStep = stepMap.get(cfg.id);
        if (dbStep) {
          mergedSteps.push({
            ...dbStep,
            name: cfg.name || dbStep.name,
            color: cfg.color || dbStep.color,
            order: cfg.order !== undefined ? cfg.order : dbStep.order
          });
          stepMap.delete(cfg.id);
        }
      });
      stepMap.forEach((dbStep) => {
        mergedSteps.push(dbStep);
      });
      steps = mergedSteps.sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    const firstStepId = steps.length > 0 ? steps[0].id : null;

    // 2. 获取所有的联系人作为卡片 (Tasks)，若 stepId 为空，则归属到第一列
    let contactSql = "SELECT id, name as title, phone, stepId as step_id, priority, lastActivityAt as last_activity_at, dueDate as due_date, note, orderIndex as `order`, relation, properties, sendCount FROM Contact WHERE userId = ?";
    const contactParams = [userId];

    if (activeInstances && Array.isArray(activeInstances) && activeInstances.length > 0) {
      // 兼容处理：展开查询参数以包含 displayName，从而支持匹配 Notion/Excel 导入的无 usr_ 前缀的数据
      const expandedInstances: string[] = [];
      activeInstances.forEach((inst: any) => {
        if (typeof inst !== "string") return;
        expandedInstances.push(inst); // 保留 rawName (如 usr_cmcXXXX_my-whatsapp)
        const stripped = inst.replace(/^usr_cmc\w+?_/, "");
        if (stripped !== inst && !expandedInstances.includes(stripped)) {
          expandedInstances.push(stripped); // 增加 displayName (如 my-whatsapp)
        }
      });

      const placeholders = expandedInstances.map(() => "?").join(",");
      contactSql += ` AND (
        (JSON_VALID(properties) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(properties, '$."实例"')) IN (${placeholders}))
        OR
        (JSON_VALID(properties) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(properties, '$.sourceInstance')) IN (${placeholders}))
      )`;
      contactParams.push(...expandedInstances);
      contactParams.push(...expandedInstances);
    }

    const activeDays = url.searchParams.get("activeDays") || "15";
    if (activeDays !== "all") {
      const days = parseInt(activeDays, 10);
      if (!isNaN(days) && days > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoffStr = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
        contactSql += " AND lastActivityAt >= ? AND (responded = 1 OR sendCount > 0 OR lastSentAt IS NOT NULL OR sourceId = 'evolution' OR lastActivityAt > createdAt)";
        contactParams.push(cutoffStr);
      }
    }

    // 获取所有的 Group 用于 filterConfig 解析
    const [allGroups]: any = await conn.execute(
      "SELECT id, filterConfig FROM `Group` WHERE userId = ?",
      [userId]
    );
    const groupMap = new Map<string, any>();
    allGroups.forEach((g: any) => {
      if (g.filterConfig) {
        try {
          groupMap.set(g.id, typeof g.filterConfig === "string" ? JSON.parse(g.filterConfig) : g.filterConfig);
        } catch {}
      }
    });

    // 如果前端只传了 viewId 导致没有传 excludedGroupId，我们根据视图关联的数据源和群组关系动态推导排除项
    if (excludedGroupIds.length === 0 && activeSourceIds.length > 0) {
      allGroups.forEach((g: any) => {
        const cfg = groupMap.get(g.id);
        const assocSourceId = cfg?.sourceId;
        if (assocSourceId && activeSourceIds.includes(assocSourceId) && !activeGroupIds.includes(g.id)) {
          excludedGroupIds.push(g.id);
        }
      });
    }

    // A. 包含逻辑
    if (activeSourceIds.length > 0 || activeGroupIds.length > 0) {
      const includeClauses: string[] = [];
      
      if (activeSourceIds.length > 0) {
        includeClauses.push(`sourceId IN (${activeSourceIds.map(() => "?").join(",")})`);
        contactParams.push(...activeSourceIds);
      }
      
      activeGroupIds.forEach(gid => {
        const cfg = groupMap.get(gid);
        if (cfg) {
          const assocSourceId = cfg.sourceId;
          if (!assocSourceId || !activeSourceIds.includes(assocSourceId)) {
            const groupParams: any[] = [];
            const groupSql = buildGroupFilterSql(cfg, groupParams);
            includeClauses.push(groupSql);
            contactParams.push(...groupParams);
          }
        }
      });
      
      if (includeClauses.length > 0) {
        contactSql += ` AND (${includeClauses.join(" OR ")})`;
      }
    }

    // B. 排除逻辑
    excludedGroupIds.forEach(gid => {
      const cfg = groupMap.get(gid);
      if (cfg) {
        const groupParams: any[] = [];
        const groupSql = buildGroupFilterSql(cfg, groupParams);
        contactSql += ` AND NOT ${groupSql}`;
        contactParams.push(...groupParams);
      }
    });

    // C. 收集所有选中群组的特定 excludedIds
    const allExcludedIds = new Set<string>();
    activeGroupIds.forEach(gid => {
      const cfg = groupMap.get(gid);
      if (cfg && Array.isArray(cfg.excludedIds)) {
        cfg.excludedIds.forEach((id: string) => allExcludedIds.add(id));
      }
    });

    const [contactRows]: any = await conn.execute(contactSql, contactParams);

    // 排除被剔除的人群包联系人
    let filteredContactRows = contactRows;
    if (allExcludedIds.size > 0) {
      filteredContactRows = contactRows.filter((c: any) => !allExcludedIds.has(c.id));
    }

    const tasks = filteredContactRows.map((c: any) => {
      let labels: string[] = [];
      if (c.relation) {
        try {
          const parsed = JSON.parse(c.relation);
          labels = Array.isArray(parsed) ? parsed : [c.relation];
        } catch {
          labels = [c.relation];
        }
      }

      let parsedProperties = {};
      if (c.properties) {
        try {
          parsedProperties = typeof c.properties === "string" ? JSON.parse(c.properties) : c.properties;
        } catch {}
      }

      return {
        id: c.id,
        step_id: c.step_id || firstStepId, // 兜底到第一列
        title: c.title,
        phone: c.phone,
        priority: c.priority || "medium",
        last_activity_at: c.last_activity_at,
        due_date: c.due_date,
        note: c.note,
        order: c.order || 0,
        labels,
        source: "Notion",
        properties: parsedProperties,
        sendCount: c.sendCount || 0,
        avatar_url: null,
        conversation_id: null,
        assigned_agent_ids: null,
        na_status: "待处理"
      };
    });

    // 3. 获取 AppSettings 里的 SLA 配置及全局自动化配置
    const [settingsRows]: any = await conn.execute(
      "SELECT slaIdleHours, slaExpiringHours, slaOverdueLabel, automationConfig FROM AppSettings WHERE userId = ? LIMIT 1",
      [userId]
    );

    let slaConfig = { idle_hours: 24, expiring_hours: 2, overdue_label: "已逾期" };
    let globalAutomationConfig: any[] = [];

    if (settingsRows.length > 0) {
      const s = settingsRows[0];
      slaConfig = {
        idle_hours: s.slaIdleHours !== null && s.slaIdleHours !== undefined ? s.slaIdleHours : 24,
        expiring_hours: s.slaExpiringHours !== null && s.slaExpiringHours !== undefined ? s.slaExpiringHours : 2,
        overdue_label: s.slaOverdueLabel || "已逾期"
      };
      if (s.automationConfig) {
        try {
          globalAutomationConfig = typeof s.automationConfig === "string" ? JSON.parse(s.automationConfig) : s.automationConfig;
        } catch {}
      }
    }

    if (activeSlaConfig) {
      slaConfig = {
        ...slaConfig,
        ...activeSlaConfig
      };
    }

    // 拼装成前端看板所期望的数据结构
    const responseData = [
      {
        locked: false,
        destroy_warning: false,
        company_name: session.user.name || "我的 CRM",
        account_status: "商业版",
        template_type: "5.通用初始看板",
        trial_info: {
          days_left: 9999
        },
        has_master_password: false,
        sla_config: slaConfig,
        boards: [
          { name: session.user.name || "我的 CRM" }
        ],
        steps: steps,
        tasks: tasks,
        relation_options: steps.map((s: any) => ({ name: s.name })),
        automation_config: globalAutomationConfig,
        saved_hidden_step_ids: activeHiddenStepIds,
        card_layout: activeCardLayout,
        saved_instances: activeInstances
      }
    ];

    return NextResponse.json(responseData);
  } catch (error: any) {
    console.error("GET Kanban Data Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
