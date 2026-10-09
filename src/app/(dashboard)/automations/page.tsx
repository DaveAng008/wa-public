"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { Save, Loader2, Plus, Trash2, CheckCircle, AlertCircle, Brain, Cpu, MessageSquare, Phone, ArrowRight, Play, Clock, UserCheck, UserMinus, ToggleLeft, Edit2, ChevronUp, ChevronDown, GripVertical, RefreshCw, Smartphone, Maximize2, Minimize2, ZoomIn, ZoomOut, RotateCcw, Columns, AlignJustify, Eye, EyeOff, Move } from "lucide-react";
import { PageLoading } from "@/components/ui/LoadingSpinner";

interface ActionNode {
  id: string;
  type: "kanban_move" | "priority_change" | "auto_reply" | "admin_notify" | "next_campaign" | "delay" | "blacklist" | "relation_change" | "webhook" | "agent_assign" | "condition_branch";
  targetStepId?: string;
  priority?: "none" | "mark_urgent" | "normal" | "low";
  autoReplyText?: string;
  aiReplyEnabled?: boolean;
  aiReplyPrompt?: string;
  aiReplyProvider?: "openai" | "deepseek" | "gemini";
  aiReplyModel?: string;
  notifyPhone?: string;
  nextCampaignId?: string;
  delaySeconds?: number | "";
  relationTags?: string;
  replyTarget?: string;
  webhookUrl?: string;
  webhookMethod?: "GET" | "POST";
  webhookHeaders?: string;
  materialId?: string | number;
  propertyUpdates?: Array<{ field: string; value: string; updateMode?: string }>;
  assignUserId?: string;
  assignMode?: "specific" | "round_robin";
  enabled?: boolean;
  notifyTemplate?: string;
  onFailurePolicy?: "stop" | "continue";
  filters?: any[];
  actionsTrue?: ActionNode[];
  actionsFalse?: ActionNode[];
}

interface RoutingRule {
  name: string;
  enabled: boolean;
  triggerType: "all" | "campaign";
  campaignId?: string;
  conditionType?: string;
  keyword?: string;
  aiIntent?: "positive" | "negative" | "custom";
  aiModelProvider?: "openai" | "deepseek" | "gemini";
  aiModel?: string;
  actionsTrue: ActionNode[];
  actionsFalse: ActionNode[];
  timeConfig?: {
    enabled: boolean;
    days: number[];
    startTime: string;
    endTime: string;
  };
  filters?: Array<{
    field: string;
    operator: string;
    value: string;
    targetSubject?: "group_card" | "group_member";
  }>;
  targetSubject?: "group_card" | "group_member";
  triggerSender?: string;
  commandConfig?: {
    prefix: string;
    autoRecall: boolean;
  };
  applicableInstances?: string[];
}

export default function AutomationsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user) {
      if (user.role !== "admin" && !user.automationsEnabled) {
        router.replace("/");
      }
    }
  }, [user, authLoading, router]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Global settings state
  const [settings, setSettings] = useState({
    aiSpeechToTextEnabled: 0,
    aiNoiseFilterEnabled: 0,
    aiVisionEnabled: 0,
    aiVisionPrompt: "判断此图是否为支付凭证（水单），如果是请提取金额，如果是其他截图请做简单分类说明。",
    aiRoutingEnabled: 0,
    notificationPhone: "",
    globalTimeConfig: { enabled: false, days: [] as number[], startTime: "00:00", endTime: "23:59" },
    globalFilters: [] as any[],
  });

  // Rules & UI state
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [activeRuleIndex, setActiveRuleIndex] = useState<number>(0);
  const [steps, setSteps] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [instances, setInstances] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"ai_brain" | "rules" | "logs" | "admin_commands" | "materials">("ai_brain");

  // Log Tab UI State
  const [logs, setLogs] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLogsLoading(true);
    setLogsError("");
    try {
      const res = await fetch("/api/automations/logs?t=" + Date.now());
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data) ? data : []);
      } else {
        const err = await res.json();
        setLogsError(err.error || "获取日志失败");
      }
    } catch (e: any) {
      setLogsError("请求出错：" + e.message);
    } finally {
      setLogsLoading(false);
    }
  };

  const clearLogs = async () => {
    if (!confirm("确定要清空所有规则执行日志吗？此操作无法恢复。")) return;
    try {
      const res = await fetch("/api/automations/logs", {
        method: "DELETE"
      });
      if (res.ok) {
        setLogs([]);
      } else {
        const err = await res.json();
        alert(err.error || "清空日志失败");
      }
    } catch (e: any) {
      alert("请求出错：" + e.message);
    }
  };

  const deleteLog = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要删除这条日志吗？")) return;
    try {
      const res = await fetch(`/api/automations/logs?id=${id}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setLogs(prev => prev.filter(log => log.id !== id));
      } else {
        const err = await res.json();
        alert(err.error || "删除日志失败");
      }
    } catch (e: any) {
      alert("请求出错：" + e.message);
    }
  };

  useEffect(() => {
    if (activeTab === "logs") {
      fetchLogs();
    }
  }, [activeTab]);

  // Drag and drop sorting state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // New state variables for advanced features
  const [materials, setMaterials] = useState<any[]>([]);
  const [existingTags, setExistingTags] = useState<string[]>([]);
  const [draggedAction, setDraggedAction] = useState<{ index: number; isTrueBranch: boolean } | null>(null);
  const [dragOverAction, setDragOverAction] = useState<{ index: number; isTrueBranch: boolean } | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [contactFields, setContactFields] = useState<{ staticFields: any[]; dynamicFields: any[]; allFields: any[] }>({ staticFields: [], dynamicFields: [], allFields: [] });

  // Canvas Local Zoom, Fullscreen & View Mode State
  const [viewMode, setViewMode] = useState<"split" | "vertical">("split");
  const [canvasZoom, setCanvasZoom] = useState<number>(100);
  const [isFullscreenCanvas, setIsFullscreenCanvas] = useState<boolean>(false);
  const [rootTrueCollapsed, setRootTrueCollapsed] = useState<boolean>(false);
  const [rootFalseCollapsed, setRootFalseCollapsed] = useState<boolean>(false);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const reorderedRules = [...rules];
    const [removed] = reorderedRules.splice(draggedIndex, 1);
    reorderedRules.splice(targetIndex, 0, removed);
    
    setRules(reorderedRules);
    setDraggedIndex(null);
    
    if (activeRuleIndex === draggedIndex) {
      setActiveRuleIndex(targetIndex);
    } else if (activeRuleIndex > draggedIndex && activeRuleIndex <= targetIndex) {
      setActiveRuleIndex(activeRuleIndex - 1);
    } else if (activeRuleIndex < draggedIndex && activeRuleIndex >= targetIndex) {
      setActiveRuleIndex(activeRuleIndex + 1);
    }
  };

  const moveRuleUp = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (index === 0) return;
    const reorderedRules = [...rules];
    const temp = reorderedRules[index];
    reorderedRules[index] = reorderedRules[index - 1];
    reorderedRules[index - 1] = temp;
    setRules(reorderedRules);
    if (activeRuleIndex === index) {
      setActiveRuleIndex(index - 1);
    } else if (activeRuleIndex === index - 1) {
      setActiveRuleIndex(index);
    }
  };

  const moveRuleDown = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (index === rules.length - 1) return;
    const reorderedRules = [...rules];
    const temp = reorderedRules[index];
    reorderedRules[index] = reorderedRules[index + 1];
    reorderedRules[index + 1] = temp;
    setRules(reorderedRules);
    if (activeRuleIndex === index) {
      setActiveRuleIndex(index + 1);
    } else if (activeRuleIndex === index + 1) {
      setActiveRuleIndex(index);
    }
  };

  useEffect(() => {
    async function loadData() {
      try {
        const [settingsRes, kanbanRes, campaignsRes, materialsRes, schemaRes, usersRes, instancesRes] = await Promise.all([
          fetch("/api/settings?t=" + Date.now(), { cache: "no-store" }),
          fetch("/api/kanban/data?sourceId=all&groupId=all&viewId=all&activeDays=15&t=" + Date.now(), { cache: "no-store" }),
          fetch("/api/campaigns?t=" + Date.now(), { cache: "no-store" }),
          fetch("/api/materials?t=" + Date.now(), { cache: "no-store" }),
          fetch("/api/contacts/schema?t=" + Date.now(), { cache: "no-store" }).catch(() => null),
          fetch("/api/users?t=" + Date.now(), { cache: "no-store" }).catch(() => null),
          fetch("/api/instances?t=" + Date.now(), { cache: "no-store" }).catch(() => null)
        ]);

        if (schemaRes && schemaRes.ok) {
          const schemaData = await schemaRes.json();
          setContactFields(schemaData || { staticFields: [], dynamicFields: [], allFields: [] });
        }

        if (usersRes && usersRes.ok) {
          const usersData = await usersRes.json();
          setUsers(Array.isArray(usersData) ? usersData : []);
        }

        let loadedInstances: any[] = [];
        if (instancesRes && instancesRes.ok) {
          const instData = await instancesRes.json();
          loadedInstances = Array.isArray(instData) ? instData : [];
          setInstances(loadedInstances);
        }

        if (settingsRes.ok) {
          const sData = await settingsRes.json();
          let parsedGlobalTime = { enabled: false, days: [], startTime: "00:00", endTime: "23:59" };
          let parsedGlobalFilters: any[] = [];
          if (sData.globalTimeConfig) {
            try {
              parsedGlobalTime = typeof sData.globalTimeConfig === 'string' ? JSON.parse(sData.globalTimeConfig) : sData.globalTimeConfig;
            } catch (e) {}
          }
          if (sData.globalFilters) {
            try {
              parsedGlobalFilters = typeof sData.globalFilters === 'string' ? JSON.parse(sData.globalFilters) : sData.globalFilters;
            } catch (e) {}
          }
          setSettings({
            aiSpeechToTextEnabled: sData.aiSpeechToTextEnabled ? 1 : 0,
            aiNoiseFilterEnabled: sData.aiNoiseFilterEnabled ? 1 : 0,
            aiVisionEnabled: sData.aiVisionEnabled ? 1 : 0,
            aiVisionPrompt: sData.aiVisionPrompt || "判断此图是否为支付凭证（水单），如果是请提取金额，如果是其他截图请做简单分类说明。",
            aiRoutingEnabled: sData.aiRoutingEnabled ? 1 : 0,
            notificationPhone: sData.notificationPhone || "",
            globalTimeConfig: parsedGlobalTime,
            globalFilters: parsedGlobalFilters,
          });
          if (sData.aiRoutingConfig) {
            try {
              const parsed = JSON.parse(sData.aiRoutingConfig);
              // Clean rules structure mapping legacy configurations
              const cleaned = parsed.map((r: any) => ({
                name: r.name || r.keyword || "未命名规则",
                enabled: r.enabled !== undefined ? r.enabled : true,
                triggerType: r.triggerType || "all",
                campaignId: r.campaignId || "all",
                conditionType: r.conditionType || "keyword",
                keyword: r.keyword || "",
                aiIntent: r.aiIntent || "positive",
                aiModelProvider: r.aiModelProvider || "openai",
                aiModel: r.aiModel || "gpt-4o-mini",
                actionsTrue: r.actionsTrue || (r.targetStepId || r.autoReplyText || r.notifyPhone || r.nextCampaignId ? [
                  ...(r.targetStepId ? [{ id: "act_init_1", type: "kanban_move" as const, targetStepId: r.targetStepId }] : []),
                  ...(r.action === "mark_urgent" ? [{ id: "act_init_2", type: "priority_change" as const, priority: "mark_urgent" as const }] : []),
                  ...(r.autoReplyText ? [{ id: "act_init_3", type: "auto_reply" as const, autoReplyText: r.autoReplyText }] : []),
                  ...(r.notifyPhone ? [{ id: "act_init_4", type: "admin_notify" as const, notifyPhone: r.notifyPhone }] : []),
                  ...(r.nextCampaignId ? [{ id: "act_init_5", type: "next_campaign" as const, nextCampaignId: r.nextCampaignId }] : [])
                ] : []),
                actionsFalse: r.actionsFalse || [],
                timeConfig: r.timeConfig || { enabled: false, days: [], startTime: "00:00", endTime: "23:59" },
                filters: r.filters || [],
                targetSubject: r.targetSubject || "group_card",
                triggerSender: r.triggerSender || "client_only",
                commandConfig: r.commandConfig || { prefix: "", autoRecall: false },
                applicableInstances: (() => {
                  const raw = r.applicableInstances || ["all"];
                  const filtered = raw.filter((x: string) => x === "all" || loadedInstances.some((inst: any) => (inst.rawName || inst.name) === x));
                  return filtered.length === 0 ? ["all"] : filtered;
                })()
              }));
              setRules(cleaned);
            } catch (e) {
              setRules([]);
            }
          }
        }

        if (kanbanRes.ok) {
          const kData = await kanbanRes.json();
          if (kData && kData[0] && kData[0].steps) {
            setSteps(kData[0].steps);
          }
        }

        if (campaignsRes.ok) {
          const cData = await campaignsRes.json();
          setCampaigns(cData || []);
        }

        if (materialsRes.ok) {
          const mData = await materialsRes.json();
          setMaterials(mData || []);
        }

        // Fetch existing contact relation tags
        try {
          const tagsRes = await fetch("/api/contacts/column-values", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ field: "relation" })
          });
          if (tagsRes.ok) {
            const tData = await tagsRes.json();
            const rawValues = tData.values || [];
            const tagsSet = new Set<string>();
            rawValues.forEach((item: any) => {
              const val = item.value;
              if (val && val !== "__EMPTY__" && val !== "null") {
                try {
                  if (val.startsWith("[") && val.endsWith("]")) {
                    const arr = JSON.parse(val);
                    if (Array.isArray(arr)) {
                      arr.forEach(t => {
                        if (typeof t === 'string' && t.trim()) tagsSet.add(t.trim());
                      });
                      return;
                    }
                  }
                } catch (e) {}
                val.split(",").forEach((t: string) => {
                  if (t.trim()) tagsSet.add(t.trim());
                });
              }
            });
            setExistingTags(Array.from(tagsSet));
          }
        } catch (e) {
          console.error("Failed to load existing tags:", e);
        }

      } catch (err: any) {
        setError("加载配置失败：" + err.message);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSaved(false);

    try {
      // 方案A：先拉取数据库中当前的完整设置，再将自动规则字段合并进去后提交
      // 避免用不完整的对象覆盖掉 evolutionApiUrl、n8nWebhookUrl、notionSecret 等其他字段
      const currentRes = await fetch("/api/settings?t=" + Date.now(), { cache: "no-store" });
      if (!currentRes.ok) {
        setError("获取当前设置失败，请刷新后重试");
        setSaving(false);
        return;
      }
      const currentSettings = await currentRes.json();

      // 将自动规则专属字段合并到完整设置对象中
      const cleanedRules = rules.map(r => {
        if (r.filters && r.filters.length > 0) {
          return {
            ...r,
            conditionType: "filters"
          };
        }
        return r;
      });

      const payload = {
        ...currentSettings,
        aiSpeechToTextEnabled: settings.aiSpeechToTextEnabled,
        aiNoiseFilterEnabled: settings.aiNoiseFilterEnabled,
        aiVisionEnabled: settings.aiVisionEnabled,
        aiVisionPrompt: settings.aiVisionPrompt,
        aiRoutingEnabled: settings.aiRoutingEnabled,
        notificationPhone: settings.notificationPhone,
        globalTimeConfig: JSON.stringify(settings.globalTimeConfig || { enabled: false, days: [], startTime: "00:00", endTime: "23:59" }),
        globalFilters: JSON.stringify(settings.globalFilters || []),
        aiRoutingConfig: JSON.stringify(cleanedRules)
      };

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        const err = await res.json();
        setError(err.error || "保存失败");
      }
    } catch (err: any) {
      setError("保存配置出错：" + err.message);
    } finally {
      setSaving(false);
    }
  };

  const addRule = () => {
    const newRule: RoutingRule = {
      name: `自动规则 #${rules.length + 1}`,
      enabled: true,
      triggerType: "all",
      campaignId: "all",
      conditionType: "keyword",
      keyword: "",
      aiIntent: "positive",
      aiModelProvider: "openai",
      aiModel: "gpt-4o-mini",
      actionsTrue: [],
      actionsFalse: [],
      timeConfig: { enabled: false, days: [], startTime: "00:00", endTime: "23:59" },
      filters: [],
      targetSubject: "group_card",
      triggerSender: "client_only",
      applicableInstances: ["all"]
    };
    setRules([...rules, newRule]);
    setActiveRuleIndex(rules.length);
  };

  const removeRule = (index: number) => {
    const nextRules = rules.filter((_, idx) => idx !== index);
    setRules(nextRules);
    setActiveRuleIndex(Math.max(0, index - 1));
  };

  const updateRuleField = (index: number, field: keyof RoutingRule, value: any) => {
    const nextRules = [...rules];
    nextRules[index] = {
      ...nextRules[index],
      [field]: value
    };
    setRules(nextRules);
  };

  const addAction = (ruleIndex: number, isTrueBranch: boolean, type: ActionNode["type"]) => {
    const newAction: ActionNode = {
      id: "act_" + Math.random().toString(36).slice(2, 12),
      type,
      targetStepId: steps[0]?.id || "",
      priority: "mark_urgent",
      autoReplyText: "",
      aiReplyEnabled: false,
      aiReplyPrompt: "你是一个智能多语言客服助手。请根据客户发来的消息语种，自动用相同的语种进行热情专业的解答。如果对方发马来文，你就用马来文回复；对方发英文，用英文回复；发中文，用中文回复。报价与产品政策如下：",
      aiReplyProvider: "openai",
      aiReplyModel: "gpt-4o-mini",
      notifyPhone: "60123456789",
      nextCampaignId: campaigns[0]?.id || "",
      delaySeconds: 5,
      relationTags: "",
      webhookUrl: "",
      webhookMethod: "POST",
      webhookHeaders: "{\n  \"Content-Type\": \"application/json\"\n}",
      materialId: "",
      propertyUpdates: [],
      assignUserId: "",
      assignMode: "specific",
      onFailurePolicy: "stop",
      filters: [],
      actionsTrue: [],
      actionsFalse: []
    };

    const nextRules = [...rules];
    if (isTrueBranch) {
      nextRules[ruleIndex].actionsTrue = [...(nextRules[ruleIndex].actionsTrue || []), newAction];
    } else {
      nextRules[ruleIndex].actionsFalse = [...(nextRules[ruleIndex].actionsFalse || []), newAction];
    }
    setRules(nextRules);
  };

  const removeAction = (ruleIndex: number, isTrueBranch: boolean, actionId: string) => {
    const nextRules = [...rules];
    if (isTrueBranch) {
      nextRules[ruleIndex].actionsTrue = nextRules[ruleIndex].actionsTrue.filter(a => a.id !== actionId);
    } else {
      nextRules[ruleIndex].actionsFalse = nextRules[ruleIndex].actionsFalse.filter(a => a.id !== actionId);
    }
    setRules(nextRules);
  };

  const updateActionField = (ruleIndex: number, isTrueBranch: boolean, actionId: string, field: keyof ActionNode, value: any) => {
    const nextRules = [...rules];
    const list = isTrueBranch ? nextRules[ruleIndex].actionsTrue : nextRules[ruleIndex].actionsFalse;
    const idx = list.findIndex(a => a.id === actionId);
    if (idx > -1) {
      list[idx] = {
        ...list[idx],
        [field]: value
      };
    }
    setRules(nextRules);
  };

  const moveActionUpDown = (actionIndex: number, isTrueBranch: boolean, direction: "up" | "down") => {
    const nextRules = [...rules];
    const actions = isTrueBranch 
      ? [...(nextRules[activeRuleIndex].actionsTrue || [])]
      : [...(nextRules[activeRuleIndex].actionsFalse || [])];
    
    if (direction === "up" && actionIndex > 0) {
      const temp = actions[actionIndex];
      actions[actionIndex] = actions[actionIndex - 1];
      actions[actionIndex - 1] = temp;
    } else if (direction === "down" && actionIndex < actions.length - 1) {
      const temp = actions[actionIndex];
      actions[actionIndex] = actions[actionIndex + 1];
      actions[actionIndex + 1] = temp;
    } else {
      return;
    }

    if (isTrueBranch) {
      nextRules[activeRuleIndex].actionsTrue = actions;
    } else {
      nextRules[activeRuleIndex].actionsFalse = actions;
    }
    setRules(nextRules);
  };

  const handleActionDragStart = (e: React.DragEvent, index: number, isTrueBranch: boolean) => {
    setDraggedAction({ index, isTrueBranch });
    e.dataTransfer.effectAllowed = "move";
  };

  const handleActionDragOver = (e: React.DragEvent, index: number, isTrueBranch: boolean) => {
    e.preventDefault();
    if (draggedAction && (dragOverAction?.index !== index || dragOverAction?.isTrueBranch !== isTrueBranch)) {
      setDragOverAction({ index, isTrueBranch });
    }
  };

  const handleActionDrop = (e: React.DragEvent, targetIndex: number, targetIsTrueBranch: boolean) => {
    e.preventDefault();
    if (!draggedAction) return;
    
    const sourceIndex = draggedAction.index;
    const sourceIsTrueBranch = draggedAction.isTrueBranch;
    
    const nextRules = [...rules];
    const sourceList = sourceIsTrueBranch 
      ? [...(nextRules[activeRuleIndex].actionsTrue || [])]
      : [...(nextRules[activeRuleIndex].actionsFalse || [])];
      
    if (sourceIsTrueBranch === targetIsTrueBranch) {
      if (sourceIndex === targetIndex) return;
      const [removed] = sourceList.splice(sourceIndex, 1);
      sourceList.splice(targetIndex, 0, removed);
      if (sourceIsTrueBranch) {
        nextRules[activeRuleIndex].actionsTrue = sourceList;
      } else {
        nextRules[activeRuleIndex].actionsFalse = sourceList;
      }
    } else {
      const targetList = targetIsTrueBranch
        ? [...(nextRules[activeRuleIndex].actionsTrue || [])]
        : [...(nextRules[activeRuleIndex].actionsFalse || [])];
        
      const [removed] = sourceList.splice(sourceIndex, 1);
      targetList.splice(targetIndex, 0, removed);
      
      if (sourceIsTrueBranch) {
        nextRules[activeRuleIndex].actionsTrue = sourceList;
        nextRules[activeRuleIndex].actionsFalse = targetList;
      } else {
        nextRules[activeRuleIndex].actionsFalse = sourceList;
        nextRules[activeRuleIndex].actionsTrue = targetList;
      }
    }
    
    setRules(nextRules);
    setDraggedAction(null);
    setDragOverAction(null);
  };

  const selectableInstances = instances.filter((inst: any) => {
    return inst.ownerId === "system" || inst.ownerId === user?.id;
  });

  const getInstanceNamesLabel = (rule: RoutingRule) => {
    if (!rule.applicableInstances || rule.applicableInstances.length === 0 || rule.applicableInstances.includes("all")) {
      return "所有实例";
    }
    const names = rule.applicableInstances
      .map(rawName => {
        const matched = instances.find(inst => inst.rawName === rawName);
        return matched ? (matched.displayName || matched.name) : rawName;
      });
    return names.join(", ");
  };

  if (loading || authLoading || !user || (user && user.role !== "admin" && !user.automationsEnabled)) {
    return <PageLoading />;
  }

  const currentRule = rules[activeRuleIndex];

  return (
    <div className="w-full pb-16">
      <header className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-slate-950 flex items-center gap-2">
          <Brain className="w-8 h-8 text-blue-600" />
          自动规则 & AI 大脑 (V35.0)
        </h1>
        <p className="text-slate-700 font-bold mt-1">
          配置语音翻译、图片智能解读、噪声过滤，以及支持 If-Else 双轨分流的多模型链式自动跟进。
        </p>
      </header>

      {saved && (
        <div className="mb-6 p-4 bg-green-50 text-green-700 text-sm rounded-2xl border border-green-100 flex items-center gap-2 font-bold">
          <CheckCircle className="w-5 h-5" />
          <span>✓ 自动规则与设置已保存成功！配置已实时同步。</span>
        </div>
      )}

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 text-sm rounded-2xl border border-red-100 flex items-center gap-2 font-bold">
          <AlertCircle className="w-5 h-5 animate-pulse" />
          <span>{error}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 mb-6 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab("ai_brain")}
          className={`pb-3 px-4 text-sm font-black transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === "ai_brain"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Brain className="w-4 h-4" />
          AI 大脑与收信开关
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("rules")}
          className={`pb-3 px-4 text-sm font-black transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === "rules"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Cpu className="w-4 h-4" />
          双轨流转跟进链 ({rules.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("logs")}
          className={`pb-3 px-4 text-sm font-black transition-colors border-b-2 flex items-center gap-2 ${
            activeTab === "logs"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Clock className="w-4 h-4" />
          📖 执行日志
        </button>
      </div>

      {/* Tab Content: AI Brain Settings */}
      {activeTab === "ai_brain" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center gap-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Cpu className="w-5 h-5" /></div>
              <div>
                <h2 className="font-black text-slate-900">语音与消息噪点清理</h2>
                <p className="text-xs text-slate-500 font-bold">自动将语音转译为文字，并过滤无意义内容以提升效率</p>
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200/50">
                <div>
                  <label className="block text-sm font-black text-slate-900 mb-1">🎤 语音自动转文字 (Whisper)</label>
                  <p className="text-xs text-slate-500 font-bold font-semibold">客户发来语音时，自动识别为文字展示在看板卡片上</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.aiSpeechToTextEnabled === 1}
                    onChange={(e) => setSettings({ ...settings, aiSpeechToTextEnabled: e.target.checked ? 1 : 0 })}
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200/50">
                <div>
                  <label className="block text-sm font-black text-slate-900 mb-1">🧹 过滤普通问候噪点 (Greetings Filter)</label>
                  <p className="text-xs text-slate-500 font-bold font-semibold">自动识别简单的问候词（如 Hi/Hello），减少无意义卡片的流入</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.aiNoiseFilterEnabled === 1}
                    onChange={(e) => setSettings({ ...settings, aiNoiseFilterEnabled: e.target.checked ? 1 : 0 })}
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center gap-3">
              <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Brain className="w-5 h-5" /></div>
              <div>
                <h2 className="font-black text-slate-900">图片智能解读 (Vision)</h2>
                <p className="text-xs text-slate-500 font-bold">配置图片解读 AI，自动判定截图、提取水单金额</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200/50">
                <div>
                  <label className="block text-sm font-black text-slate-900 mb-1">🖼️ 开启图片智能解读 (GPT-4o Vision)</label>
                  <p className="text-xs text-slate-500 font-bold font-semibold">自动分析图片，将结果写在看板卡片的备注里</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings.aiVisionEnabled === 1}
                    onChange={(e) => setSettings({ ...settings, aiVisionEnabled: e.target.checked ? 1 : 0 })}
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {settings.aiVisionEnabled === 1 && (
                <div className="space-y-1.5 p-4 border border-slate-200 rounded-2xl bg-slate-50/50">
                  <label className="block text-xs font-black text-slate-800">图片 AI 解析提示词 (System Prompt)</label>
                  <textarea
                    rows={4}
                    value={settings.aiVisionPrompt}
                    onChange={(e) => setSettings({ ...settings, aiVisionPrompt: e.target.value })}
                    placeholder="请输入提示词引导 AI 进行解读..."
                    className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none bg-white placeholder:text-slate-400"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab Content: Chain Routing Rules */}
      {activeTab === "rules" && (
        <div className="space-y-6">
          {/* Rules Master Switch Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex items-center justify-between">
            <div>
              <h3 className="font-black text-slate-900 text-sm">启用分流规则路由</h3>
              <p className="text-xs text-slate-500 font-bold mt-0.5">关闭后所有配置的分分拨规则链将处于静默睡眠状态</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.aiRoutingEnabled === 1}
                onChange={(e) => setSettings({ ...settings, aiRoutingEnabled: e.target.checked ? 1 : 0 })}
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.aiRoutingEnabled === 1 && (
            <>
              {/* 全局时间段与过滤器配置卡片 */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6 mb-6">
                <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
                  <Brain className="w-5 h-5 text-blue-600 animate-pulse" />
                  <h3 className="font-black text-slate-900 text-sm">🌐 高级全局生效时间段与高级过滤器 (全局网关优先)</h3>
                  <span className="text-[9px] bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider">Gateway Priority</span>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 全局生效时间段 */}
                  <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-200/50 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-indigo-500" />
                        <span className="text-xs font-black text-slate-800">⏱️ 全局生效时间段限制</span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={settings.globalTimeConfig?.enabled || false}
                          onChange={(e) => {
                            const timeConfig = settings.globalTimeConfig || { enabled: false, days: [], startTime: "00:00", endTime: "23:59" };
                            setSettings({
                              ...settings,
                              globalTimeConfig: { ...timeConfig, enabled: e.target.checked }
                            });
                          }}
                        />
                        <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    {(settings.globalTimeConfig?.enabled) && (
                      <div className="space-y-4 pt-2 border-t border-slate-200 animate-fadeIn">
                        <div>
                          <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase">生效星期 (未选则代表全天候生效)</label>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { label: "周日", value: 0 },
                              { label: "周一", value: 1 },
                              { label: "周二", value: 2 },
                              { label: "周三", value: 3 },
                              { label: "周四", value: 4 },
                              { label: "周五", value: 5 },
                              { label: "周六", value: 6 }
                            ].map(day => {
                              const activeDays = settings.globalTimeConfig?.days || [];
                              const isChecked = activeDays.includes(day.value);
                              return (
                                <button
                                  key={day.value}
                                  type="button"
                                  onClick={() => {
                                    const newDays = isChecked
                                      ? activeDays.filter((d: number) => d !== day.value)
                                      : [...activeDays, day.value];
                                    setSettings({
                                      ...settings,
                                      globalTimeConfig: {
                                        ...settings.globalTimeConfig,
                                        days: newDays
                                      }
                                    });
                                  }}
                                  className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors border ${
                                    isChecked
                                      ? "bg-blue-50 border-blue-200 text-blue-700"
                                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                  }`}
                                >
                                  {day.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-black text-slate-500 mb-1.5 uppercase">每日开始时间</label>
                            <input
                              type="time"
                              value={settings.globalTimeConfig?.startTime || "00:00"}
                              onChange={(e) => {
                                setSettings({
                                  ...settings,
                                  globalTimeConfig: {
                                    ...settings.globalTimeConfig,
                                    startTime: e.target.value
                                  }
                                });
                              }}
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 bg-white focus:border-blue-600 outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-black text-slate-500 mb-1.5 uppercase">每日结束时间</label>
                            <input
                              type="time"
                              value={settings.globalTimeConfig?.endTime || "23:59"}
                              onChange={(e) => {
                                setSettings({
                                  ...settings,
                                  globalTimeConfig: {
                                    ...settings.globalTimeConfig,
                                    endTime: e.target.value
                                  }
                                });
                              }}
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 bg-white focus:border-blue-600 outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 全局高级属性过滤器组 */}
                  <div className="bg-slate-50/50 p-5 rounded-2xl border border-slate-200/50 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-800 flex items-center gap-2">
                        <ToggleLeft className="w-4 h-4 text-indigo-500" />
                        ⚡ 全局高级条件过滤器组 (AND 组合关系)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const currentFilters = settings.globalFilters || [];
                          const newFilter = {
                            field: "chatType",
                            operator: "equals",
                            value: "private",
                            targetSubject: "group_card" as const
                          };
                          setSettings({
                            ...settings,
                            globalFilters: [...currentFilters, newFilter]
                          });
                        }}
                        className="px-3 py-1.5 text-[10px] font-black text-blue-600 bg-white border border-blue-200 hover:bg-blue-50 transition-colors rounded-xl flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        添加全局条件
                      </button>
                    </div>

                    {(!settings.globalFilters || settings.globalFilters.length === 0) ? (
                      <div className="text-center py-6 text-slate-400 text-xs font-bold border border-dashed border-slate-200 rounded-xl bg-white">
                        💡 尚未配置任何全局过滤器。
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                        {settings.globalFilters.map((filter: any, fIdx: number) => {
                          const updateGlobalFilterFields = (fieldsObj: Record<string, any>) => {
                            const nextFilters = [...(settings.globalFilters || [])];
                            nextFilters[fIdx] = {
                              ...nextFilters[fIdx],
                              ...fieldsObj
                            };
                            setSettings({
                              ...settings,
                              globalFilters: nextFilters
                            });
                          };

                          const removeGlobalFilter = () => {
                            const nextFilters = (settings.globalFilters || []).filter((_: any, idx: number) => idx !== fIdx);
                            setSettings({
                              ...settings,
                              globalFilters: nextFilters
                            });
                          };

                          return (
                            <div key={fIdx} className="grid grid-cols-1 md:grid-cols-12 gap-2 bg-white p-3 rounded-xl border border-slate-200 items-end shadow-sm animate-fadeIn">
                              {/* 匹配主体 */}
                              <div className="md:col-span-3">
                                <label className="block text-[8px] font-black text-slate-400 mb-1 uppercase">匹配主体</label>
                                <select
                                  value={filter.targetSubject || "group_card"}
                                  onChange={(e) => updateGlobalFilterFields({ targetSubject: e.target.value })}
                                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                >
                                  <option value="group_card">群聊/对话主体</option>
                                  <option value="group_member">群聊发言人个人</option>
                                </select>
                              </div>

                              {/* 匹配字段 */}
                              <div className="md:col-span-3">
                                <label className="block text-[8px] font-black text-slate-400 mb-1 uppercase">匹配字段</label>
                                <select
                                  value={filter.field}
                                  onChange={(e) => {
                                    const newField = e.target.value;
                                    let defaultOp = "equals";
                                    let defaultVal = "";
                                    if (newField === "chatType") {
                                      defaultOp = "equals";
                                      defaultVal = "private";
                                    } else if (newField === "phonePrefix") {
                                      defaultOp = "starts_with";
                                    } else if (newField === "isNewContact") {
                                      defaultOp = "equals";
                                      defaultVal = "true";
                                    } else if (newField === "relation") {
                                      defaultOp = "contains";
                                    }
                                    updateGlobalFilterFields({
                                      field: newField,
                                      operator: defaultOp,
                                      value: defaultVal
                                    });
                                  }}
                                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                >
                                  <option value="chatType">💬 私聊/群聊类型</option>
                                  <option value="phonePrefix">📞 手机号码前缀</option>
                                  <option value="isNewContact">🆕 是否为新联系人</option>
                                  <option value="relation">🏷️ 关系标签 (Relation)</option>
                                  <option value="stepId">🎯 看板列 (Step)</option>
                                  <option value="market">🌍 市场 (Market)</option>
                                  <option value="priority">🚨 优先级 (Priority)</option>
                                  <option value="note">📝 备注内容 (Note)</option>
                                </select>
                              </div>

                              {/* 运算符 */}
                              <div className="md:col-span-3">
                                <label className="block text-[8px] font-black text-slate-400 mb-1 uppercase">运算符</label>
                                <select
                                  value={filter.operator}
                                  onChange={(e) => updateGlobalFilterFields({ operator: e.target.value })}
                                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                >
                                  {filter.field === "phonePrefix" ? (
                                    <>
                                      <option value="starts_with">以...开头</option>
                                      <option value="not_starts_with">不以...开头</option>
                                    </>
                                  ) : filter.field === "chatType" || filter.field === "isNewContact" ? (
                                    <>
                                      <option value="equals">等于</option>
                                      <option value="not_equals">不等于</option>
                                    </>
                                  ) : (
                                    <>
                                      <option value="equals">等于</option>
                                      <option value="not_equals">不等于</option>
                                      <option value="contains">包含</option>
                                      <option value="not_contains">不包含</option>
                                      <option value="is_empty">为空</option>
                                      <option value="is_not_empty">不为空</option>
                                    </>
                                  )}
                                </select>
                              </div>

                              {/* 匹配值 */}
                              <div className="md:col-span-2">
                                <label className="block text-[8px] font-black text-slate-400 mb-1 uppercase">匹配值</label>
                                {filter.operator === "is_empty" || filter.operator === "is_not_empty" ? (
                                  <div className="text-[10px] font-bold text-slate-400 py-1 bg-slate-50 text-center rounded-lg border border-dashed">
                                    无需参数
                                  </div>
                                ) : filter.field === "chatType" ? (
                                  <select
                                    value={filter.value}
                                    onChange={(e) => updateGlobalFilterFields({ value: e.target.value })}
                                    className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                  >
                                    <option value="private">私聊 (Private)</option>
                                    <option value="group">群聊 (Group)</option>
                                  </select>
                                ) : filter.field === "isNewContact" ? (
                                  <select
                                    value={filter.value}
                                    onChange={(e) => updateGlobalFilterFields({ value: e.target.value })}
                                    className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                  >
                                    <option value="true">是 (True)</option>
                                    <option value="false">否 (False)</option>
                                  </select>
                                ) : filter.field === "stepId" ? (
                                  <select
                                    value={filter.value}
                                    onChange={(e) => updateGlobalFilterFields({ value: e.target.value })}
                                    className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                  >
                                    <option value="">请选择看板列...</option>
                                    {steps.map(s => (
                                      <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                  </select>
                                ) : filter.field === "priority" ? (
                                  <select
                                    value={filter.value}
                                    onChange={(e) => updateGlobalFilterFields({ value: e.target.value })}
                                    className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                  >
                                    <option value="urgent">紧急 (Urgent)</option>
                                    <option value="high">高 (High)</option>
                                    <option value="medium">中 (Medium)</option>
                                    <option value="normal">正常 (Normal)</option>
                                    <option value="low">低 (Low)</option>
                                  </select>
                                ) : (
                                  <input
                                    type="text"
                                    value={filter.value || ""}
                                    onChange={(e) => updateGlobalFilterFields({ value: e.target.value })}
                                    placeholder="请输入匹配值..."
                                    className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none placeholder:text-slate-400"
                                  />
                                )}
                              </div>

                              {/* Remove Button */}
                              <div className="md:col-span-1 text-right">
                                <button
                                  type="button"
                                  onClick={removeGlobalFilter}
                                  className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 双栏容器 */}
              <div className="flex flex-col md:flex-row gap-6 items-start w-full animate-fadeIn">
                {/* Left Sidebar: Rules List */}
                <div className="w-full md:w-72 bg-white border border-slate-200 rounded-3xl p-4 space-y-3 shadow-sm flex-shrink-0">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <span className="text-xs font-black text-slate-800">📋 自动规则列表</span>
                    <button
                      type="button"
                      onClick={addRule}
                      className="px-2 py-1 text-[10px] font-black text-blue-600 hover:bg-blue-50 transition-colors rounded-lg border border-dashed border-blue-300 flex items-center gap-0.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      新建规则
                    </button>
                  </div>

                {rules.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 font-bold text-xs">
                    暂无规则
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                    {rules.map((rule, idx) => {
                      const isActive = activeRuleIndex === idx;
                      const isDragOver = dragOverIndex === idx;
                      return (
                        <div
                          key={idx}
                          draggable
                          onDragStart={(e) => handleDragStart(e, idx)}
                          onDragOver={(e) => {
                            handleDragOver(e, idx);
                            if (dragOverIndex !== idx) setDragOverIndex(idx);
                          }}
                          onDragLeave={() => setDragOverIndex(null)}
                          onDragEnd={() => {
                            setDraggedIndex(null);
                            setDragOverIndex(null);
                          }}
                          onDrop={(e) => {
                            handleDrop(e, idx);
                            setDragOverIndex(null);
                          }}
                          onClick={() => setActiveRuleIndex(idx)}
                          className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group ${
                            isActive
                              ? "bg-blue-50/50 border-blue-200 shadow-sm"
                              : "bg-slate-50/40 border-slate-200/60 hover:bg-slate-50"
                          } ${isDragOver ? "border-blue-500 border-dashed bg-blue-50/20 shadow-inner" : ""}`}
                        >
                          <div className="flex items-center gap-2 overflow-hidden mr-2 min-w-0 w-full">
                            {/* Drag handle */}
                            <div className="flex flex-col gap-0.5 text-slate-400 cursor-grab active:cursor-grabbing flex-shrink-0">
                              <span className="w-3.5 h-[1.5px] bg-slate-300 rounded" />
                              <span className="w-3.5 h-[1.5px] bg-slate-300 rounded" />
                              <span className="w-3.5 h-[1.5px] bg-slate-300 rounded" />
                            </div>
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${rule.enabled !== false ? 'bg-green-500' : 'bg-slate-400'}`} />
                            <div className="flex flex-col min-w-0 w-full">
                              <span className="text-xs font-black text-slate-700 truncate">{rule.name || `规则 #${idx + 1}`}</span>
                              <span className="text-[9px] text-slate-500 truncate font-semibold mt-0.5">
                                📱 {getInstanceNamesLabel(rule)}
                              </span>
                            </div>
                          </div>

                          {/* Reordering micro buttons */}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => moveRuleUp(idx, e)}
                              disabled={idx === 0}
                              className="p-1 hover:bg-slate-100 active:bg-slate-200 rounded text-slate-500 disabled:opacity-30 disabled:hover:bg-transparent"
                              title="上移"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => moveRuleDown(idx, e)}
                              disabled={idx === rules.length - 1}
                              className="p-1 hover:bg-slate-100 active:bg-slate-200 rounded text-slate-500 disabled:opacity-30 disabled:hover:bg-transparent"
                              title="下移"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right Detail Panel: Rule Details */}
              <div className="flex-1 min-w-0 w-full">
                {rules.length === 0 ? (
                  <div className="text-center py-16 text-slate-400 font-bold text-sm bg-white rounded-2xl border border-dashed border-slate-200">
                    📭 暂无跟进规则。请点击左侧按钮新建一条规则。
                  </div>
                ) : (
                  <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-6 shadow-sm relative animate-fadeIn">
                    
                    {/* Delete Active Rule & Enable Toggle */}
                    <div className="absolute top-6 right-6 flex items-center gap-2">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl">
                        <span className="text-xs font-black text-slate-600">启用此规则</span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={currentRule.enabled !== false}
                            onChange={(e) => updateRuleField(activeRuleIndex, "enabled", e.target.checked)}
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500"></div>
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRule(activeRuleIndex)}
                        className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-xl transition-colors border border-transparent hover:border-red-200 flex items-center gap-1 text-xs font-black"
                        title="删除当前规则"
                      >
                        <Trash2 className="w-4 h-4" />
                        删除当前规则
                      </button>
                    </div>

                    <div className="text-xs font-black text-blue-600 flex items-center gap-1.5">
                      <Edit2 className="w-4 h-4" />
                      跟进链规则详情配置
                    </div>

                    {/* Rule Title Rename & Trigger config */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pb-6 border-b border-slate-100">
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">规则名称</label>
                        <input
                          type="text"
                          value={currentRule.name}
                          onChange={(e) => updateRuleField(activeRuleIndex, "name", e.target.value)}
                          placeholder="例如: 价格高意向分流"
                          className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-900 bg-slate-50/50 focus:bg-white focus:border-blue-600 outline-none transition-colors"
                        />
                      </div>

                      {/* Trigger Sender */}
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">触发者 (Trigger Sender)</label>
                        <select
                          value={currentRule.triggerSender || "client_only"}
                          onChange={(e) => updateRuleField(activeRuleIndex, "triggerSender", e.target.value)}
                          className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 bg-white focus:border-blue-600 outline-none"
                        >
                          <option value="client_only">🟢 仅限客户发送</option>
                          <option value="admin_only">👑 仅限管理员发送</option>
                          <option value="both">⚖️ 客户与管理员均可</option>
                          <option value="admin_self">💻 管理员自我对话控制</option>
                        </select>
                      </div>

                      {/* Step 1: Trigger (When) */}
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">步骤 1：触发类型 (When)</label>
                        <div className="grid grid-cols-1 gap-2">
                          <select
                            value={currentRule.triggerType}
                            onChange={(e) => updateRuleField(activeRuleIndex, "triggerType", e.target.value)}
                            className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 bg-white focus:border-blue-600 outline-none"
                          >
                            <option value="all">🟢 任何消息流入</option>
                            <option value="campaign">📢 客户回复特定群发活动</option>
                          </select>

                          {currentRule.triggerType === "campaign" && (
                            <select
                              value={currentRule.campaignId || "all"}
                              onChange={(e) => updateRuleField(activeRuleIndex, "campaignId", e.target.value)}
                              className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 bg-white focus:border-blue-600 outline-none animate-fadeIn"
                            >
                              <option value="all">所有群发活动</option>
                              {campaigns.map(c => (
                                <option key={c.id} value={c.id}>📢 {c.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>

                      {/* Target Subject */}
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">群聊流转执行主体</label>
                        <select
                          value={currentRule.targetSubject || "group_card"}
                          onChange={(e) => updateRuleField(activeRuleIndex, "targetSubject", e.target.value)}
                          className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 bg-white focus:border-blue-600 outline-none"
                        >
                          <option value="group_card">🏢 原群卡片 (群消息动作落到群聊卡片上)</option>
                          <option value="group_member">👤 群内发言成员 (动作落到该群成员个人卡片上)</option>
                        </select>
                      </div>
                    </div>

                    {/* 指令配置子模块：当触发主体不是“仅限客户发送”时显示 */}
                    {currentRule.triggerSender && currentRule.triggerSender !== "client_only" && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 pb-4 border-b border-slate-100/50 animate-fadeIn">
                        <div>
                          <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">⚡ 指令前缀 (Prefix)</label>
                          <select
                            value={currentRule.commandConfig?.prefix || ""}
                            onChange={(e) => {
                              const config = currentRule.commandConfig || { prefix: "", autoRecall: false };
                              updateRuleField(activeRuleIndex, "commandConfig", { ...config, prefix: e.target.value });
                            }}
                            className="w-full border-2 border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold text-slate-900 bg-white focus:border-blue-600 outline-none"
                          >
                            <option value="">无前缀 (直接输入关键字)</option>
                            <option value="#"># (井号前缀，例如 #备注)</option>
                            <option value="/">/ (斜杠前缀，例如 /备注)</option>
                            <option value="《》">《》 (双书名号，例如 《备注》)</option>
                          </select>
                        </div>
                        <div className="flex items-center justify-between md:pt-6">
                          <div className="flex flex-col">
                            <span className="text-xs font-black text-slate-800">🔄 执行成功后自动撤回</span>
                            <span className="text-[10px] text-slate-500 font-bold">系统处理完规则动作后，自动在聊天中删除该指令</span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={currentRule.commandConfig?.autoRecall || false}
                              onChange={(e) => {
                                const config = currentRule.commandConfig || { prefix: "", autoRecall: false };
                                updateRuleField(activeRuleIndex, "commandConfig", { ...config, autoRecall: e.target.checked });
                              }}
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* Applicable Instances Selector */}
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/50 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Smartphone className="w-4 h-4 text-blue-500" />
                          <span className="text-xs font-black text-slate-800">📱 适用实例</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-bold max-w-[70%] truncate text-right">
                          {(!currentRule.applicableInstances || currentRule.applicableInstances.length === 0 || currentRule.applicableInstances.includes("all")) ? (
                            "所有实例"
                          ) : (
                            `已选 ${currentRule.applicableInstances.filter(x => x !== "all").length} 个实例: ${
                              currentRule.applicableInstances.map(rawName => {
                                const matched = instances.find(inst => inst.rawName === rawName);
                                return matched ? (matched.displayName || matched.name) : rawName;
                              }).join(", ")
                            }`
                          )}
                        </span>
                      </div>
                      
                      <div className="pt-2 border-t border-slate-200">
                        {selectableInstances.length === 0 ? (
                          <div className="text-xs text-slate-500 font-bold">
                            暂无可用的 WhatsApp 实例。
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2.5">
                            <label
                              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-xl cursor-pointer transition-all ${
                                (!currentRule.applicableInstances || currentRule.applicableInstances.length === 0 || currentRule.applicableInstances.includes("all"))
                                  ? "bg-blue-50/50 border-blue-200 text-blue-900"
                                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100/50"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={!currentRule.applicableInstances || currentRule.applicableInstances.length === 0 || currentRule.applicableInstances.includes("all")}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    updateRuleField(activeRuleIndex, "applicableInstances", ["all"]);
                                  } else {
                                    updateRuleField(activeRuleIndex, "applicableInstances", []);
                                  }
                                }}
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                              />
                              <span className="font-bold text-xs select-none">所有实例</span>
                            </label>

                            {selectableInstances.map((inst) => {
                              const rawName = inst.rawName || inst.name;
                              const isChecked = currentRule.applicableInstances?.includes(rawName) && !currentRule.applicableInstances?.includes("all");
                              return (
                                <label
                                  key={rawName}
                                  className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-xl cursor-pointer transition-all ${
                                    isChecked
                                      ? "bg-blue-50/50 border-blue-200 text-blue-900"
                                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-100/50"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked || false}
                                    onChange={(e) => {
                                      let current = currentRule.applicableInstances || [];
                                      current = current.filter(x => x !== "all");
                                      
                                      if (e.target.checked) {
                                        current = [...current, rawName];
                                      } else {
                                        current = current.filter(x => x !== rawName);
                                      }
                                      
                                      if (current.length === 0) {
                                        current = ["all"];
                                      }
                                      
                                      updateRuleField(activeRuleIndex, "applicableInstances", current);
                                    }}
                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                                  />
                                  <div className="flex flex-col min-w-0 select-none">
                                    <span className="font-bold text-xs truncate max-w-[120px]">{inst.displayName || inst.name}</span>
                                    {inst.ownerJid && (
                                      <span className="text-[9px] text-slate-400 font-mono truncate max-w-[120px]">
                                        {inst.ownerJid.split("@")[0]}
                                      </span>
                                    )}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Active Time Config */}
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/50 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-indigo-500" />
                          <span className="text-xs font-black text-slate-800">⏱️ 生效时间段限制</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={currentRule.timeConfig?.enabled || false}
                            onChange={(e) => {
                              const timeConfig = currentRule.timeConfig || { enabled: false, days: [], startTime: "00:00", endTime: "23:59" };
                              updateRuleField(activeRuleIndex, "timeConfig", { ...timeConfig, enabled: e.target.checked });
                            }}
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                      </div>

                      {(currentRule.timeConfig?.enabled) && (
                        <div className="space-y-4 pt-2 border-t border-slate-200 animate-fadeIn">
                          <div>
                            <label className="block text-[10px] font-black text-slate-500 mb-2 uppercase">生效星期 (未选则代表全天候生效)</label>
                            <div className="flex flex-wrap gap-2">
                              {[
                                { label: "周日", value: 0 },
                                { label: "周一", value: 1 },
                                { label: "周二", value: 2 },
                                { label: "周三", value: 3 },
                                { label: "周四", value: 4 },
                                { label: "周五", value: 5 },
                                { label: "周六", value: 6 }
                              ].map(day => {
                                const activeDays = currentRule.timeConfig?.days || [];
                                const isChecked = activeDays.includes(day.value);
                                return (
                                  <button
                                    key={day.value}
                                    type="button"
                                    onClick={() => {
                                      const newDays = isChecked
                                        ? activeDays.filter(d => d !== day.value)
                                        : [...activeDays, day.value];
                                      updateRuleField(activeRuleIndex, "timeConfig", {
                                        ...currentRule.timeConfig,
                                        days: newDays
                                      });
                                    }}
                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors border ${
                                      isChecked
                                        ? "bg-blue-50 border-blue-200 text-blue-700"
                                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                    }`}
                                  >
                                    {day.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-black text-slate-500 mb-1.5 uppercase">每日开始时间</label>
                              <input
                                type="time"
                                value={currentRule.timeConfig?.startTime || "00:00"}
                                onChange={(e) => {
                                  updateRuleField(activeRuleIndex, "timeConfig", {
                                    ...currentRule.timeConfig,
                                    startTime: e.target.value
                                  });
                                }}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 bg-white focus:border-blue-600 outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-black text-slate-500 mb-1.5 uppercase">每日结束时间</label>
                              <input
                                type="time"
                                value={currentRule.timeConfig?.endTime || "23:59"}
                                onChange={(e) => {
                                  updateRuleField(activeRuleIndex, "timeConfig", {
                                    ...currentRule.timeConfig,
                                    endTime: e.target.value
                                  });
                                }}
                                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 bg-white focus:border-blue-600 outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>



                    {/* Advanced Multi-Filters (AND logic) */}
                    <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/50 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-800 flex items-center gap-2">
                          <ToggleLeft className="w-4 h-4 text-indigo-500" />
                          ⚡ 高级条件过滤器组 (AND 组合关系)
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const currentFilters = currentRule.filters || [];
                            const newFilter = {
                              field: "chatType",
                              operator: "equals",
                              value: "private",
                              targetSubject: "group_card" as const
                            };
                            updateRuleField(activeRuleIndex, "filters", [...currentFilters, newFilter]);
                          }}
                          className="px-3 py-1.5 text-[10px] font-black text-blue-600 bg-white border border-blue-200 hover:bg-blue-50 transition-colors rounded-xl flex items-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          添加条件
                        </button>
                      </div>

                      {(!currentRule.filters || currentRule.filters.length === 0) ? (
                        <div className="text-center py-4 text-slate-400 text-xs font-bold border border-dashed border-slate-200 rounded-xl bg-white">
                          💡 尚未配置任何过滤器，规则将仅通过上面的触发与关键字/意图条件匹配。
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {currentRule.filters.map((filter, fIdx) => {
                            const updateMultipleFilterFields = (fieldsObj: Record<string, any>) => {
                              const nextFilters = [...(currentRule.filters || [])];
                              nextFilters[fIdx] = {
                                ...nextFilters[fIdx],
                                ...fieldsObj
                              };
                              updateRuleField(activeRuleIndex, "filters", nextFilters);
                            };

                            const removeFilter = () => {
                              const nextFilters = (currentRule.filters || []).filter((_, idx) => idx !== fIdx);
                              updateRuleField(activeRuleIndex, "filters", nextFilters);
                            };

                            return (
                              <div key={fIdx} className="grid grid-cols-1 md:grid-cols-12 gap-2 bg-white p-3 rounded-xl border border-slate-200 items-end shadow-sm animate-fadeIn">
                                {/* Target Subject */}
                                <div className="md:col-span-3">
                                  <label className="block text-[8px] font-black text-slate-400 mb-1 uppercase">匹配主体</label>
                                  <select
                                    value={filter.targetSubject || "group_card"}
                                    onChange={(e) => updateMultipleFilterFields({ targetSubject: e.target.value })}
                                    className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                  >
                                    <option value="group_card">群聊/对话主体</option>
                                    <option value="group_member">群聊发言人个人</option>
                                  </select>
                                </div>

                                {/* Field Choice */}
                                <div className="md:col-span-3">
                                  <label className="block text-[8px] font-black text-slate-400 mb-1 uppercase">匹配字段</label>
                                  <select
                                    value={filter.field}
                                    onChange={(e) => {
                                      const newField = e.target.value;
                                      let defaultOp = "equals";
                                      let defaultVal = "";
                                      if (newField === "chatType") {
                                        defaultOp = "equals";
                                        defaultVal = "private";
                                      } else if (newField === "messageType") {
                                        defaultOp = "equals";
                                        defaultVal = "text";
                                      } else if (newField === "phonePrefix") {
                                        defaultOp = "starts_with";
                                      } else if (newField === "isNewContact") {
                                        defaultOp = "equals";
                                        defaultVal = "true";
                                      } else if (newField === "relation") {
                                        defaultOp = "contains";
                                      } else if (newField === "messageText") {
                                        defaultOp = "contains";
                                        defaultVal = "";
                                      } else if (newField === "aiIntent") {
                                        defaultOp = "equals";
                                        defaultVal = "positive";
                                      } else if (newField === "visionReceipt") {
                                        defaultOp = "equals";
                                        defaultVal = "true";
                                      }
                                      updateMultipleFilterFields({
                                        field: newField,
                                        operator: defaultOp,
                                        value: defaultVal
                                      });
                                    }}
                                    className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                  >
                                    <option value="chatType">💬 私聊/群聊类型</option>
                                    <option value="messageType">✉️ 来信消息类型 (文本/图片/语音)</option>
                                    <option value="messageText">✍️ 来信文本内容</option>
                                    <option value="aiIntent">🤖 AI 智能意图分类</option>
                                    <option value="visionReceipt">🖼️ Vision 转账凭证判定</option>
                                    <option value="phonePrefix">📞 手机号码前缀</option>
                                    <option value="isNewContact">🆕 是否为新联系人</option>
                                    <option value="relation">🏷️ 关系标签 (Relation)</option>
                                    <option value="stepId">🎯 看板列 (Step)</option>
                                    <option value="market">🌍 市场 (Market)</option>
                                    <option value="priority">🚨 优先级 (Priority)</option>
                                    <option value="note">📝 备注内容 (Note)</option>
                                    {contactFields.dynamicFields?.map((df: any) => (
                                      <option key={df.name} value={`properties.${df.name}`}>🏷️ [自定义] {df.name}</option>
                                    ))}
                                  </select>
                                </div>

                                {/* Operator */}
                                <div className="md:col-span-3">
                                  <label className="block text-[8px] font-black text-slate-400 mb-1 uppercase">运算符</label>
                                  <select
                                    value={filter.operator}
                                    onChange={(e) => updateMultipleFilterFields({ operator: e.target.value })}
                                    className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                  >
                                    {filter.field === "phonePrefix" ? (
                                      <>
                                        <option value="starts_with">以...开头</option>
                                        <option value="not_starts_with">不以...开头</option>
                                      </>
                                    ) : filter.field === "chatType" || filter.field === "isNewContact" || filter.field === "messageType" || filter.field === "aiIntent" || filter.field === "visionReceipt" ? (
                                      <>
                                        <option value="equals">等于</option>
                                        <option value="not_equals">不等于</option>
                                      </>
                                    ) : filter.field === "messageText" ? (
                                      <>
                                        <option value="equals">等于</option>
                                        <option value="not_equals">不等于</option>
                                        <option value="contains">包含</option>
                                        <option value="not_contains">不包含</option>
                                        <option value="starts_with">以...开头</option>
                                      </>
                                    ) : (
                                      <>
                                        <option value="equals">等于</option>
                                        <option value="not_equals">不等于</option>
                                        <option value="contains">包含</option>
                                        <option value="not_contains">不包含</option>
                                        <option value="is_empty">为空</option>
                                        <option value="is_not_empty">不为空</option>
                                      </>
                                    )}
                                  </select>
                                </div>

                                {/* Value Input */}
                                <div className="md:col-span-2">
                                  <label className="block text-[8px] font-black text-slate-400 mb-1 uppercase">匹配值</label>
                                  {filter.operator === "is_empty" || filter.operator === "is_not_empty" ? (
                                    <div className="text-[10px] font-bold text-slate-400 py-1 bg-slate-50 text-center rounded-lg border border-dashed">
                                      无需参数
                                    </div>
                                  ) : filter.field === "chatType" ? (
                                    <select
                                      value={filter.value}
                                      onChange={(e) => updateMultipleFilterFields({ value: e.target.value })}
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                    >
                                      <option value="private">私聊 (Private)</option>
                                      <option value="group">群聊 (Group)</option>
                                    </select>
                                  ) : filter.field === "messageType" ? (
                                    <select
                                      value={filter.value || "text"}
                                      onChange={(e) => updateMultipleFilterFields({ value: e.target.value })}
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                    >
                                      <option value="text">✍️ 文本 (text)</option>
                                      <option value="image">🖼️ 图片 (image)</option>
                                      <option value="audio">🎤 语音 (audio)</option>
                                      <option value="video">📹 视频 (video)</option>
                                      <option value="document">📁 文档 (document)</option>
                                    </select>
                                  ) : filter.field === "isNewContact" ? (
                                    <select
                                      value={filter.value}
                                      onChange={(e) => updateMultipleFilterFields({ value: e.target.value })}
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                    >
                                      <option value="true">是 (True)</option>
                                      <option value="false">否 (False)</option>
                                    </select>
                                  ) : filter.field === "stepId" ? (
                                    <select
                                      value={filter.value}
                                      onChange={(e) => updateMultipleFilterFields({ value: e.target.value })}
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                    >
                                      <option value="">请选择看板列...</option>
                                      {steps.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                      ))}
                                    </select>
                                  ) : filter.field === "priority" ? (
                                    <select
                                      value={filter.value}
                                      onChange={(e) => updateMultipleFilterFields({ value: e.target.value })}
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                    >
                                      <option value="urgent">紧急 (Urgent)</option>
                                      <option value="high">高 (High)</option>
                                      <option value="medium">中 (Medium)</option>
                                      <option value="normal">正常 (Normal)</option>
                                      <option value="low">低 (Low)</option>
                                    </select>
                                  ) : filter.field === "messageText" ? (
                                    <input
                                      type="text"
                                      value={filter.value || ""}
                                      onChange={(e) => updateMultipleFilterFields({ value: e.target.value })}
                                      placeholder="例如: 价格, 多少钱 (逗号分隔)"
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none placeholder:text-slate-400"
                                    />
                                  ) : filter.field === "aiIntent" ? (
                                    <select
                                      value={filter.value || "positive"}
                                      onChange={(e) => updateMultipleFilterFields({ value: e.target.value })}
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                    >
                                      <option value="positive">意向客户 (positive)</option>
                                      <option value="negative">拒绝/退订 (negative)</option>
                                      <option value="custom">其它咨询 (custom)</option>
                                    </select>
                                  ) : filter.field === "visionReceipt" ? (
                                    <select
                                      value={filter.value || "true"}
                                      onChange={(e) => updateMultipleFilterFields({ value: e.target.value })}
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                                    >
                                      <option value="true">是转账凭证 (true)</option>
                                      <option value="false">非转账凭证 (false)</option>
                                    </select>
                                  ) : (
                                    <input
                                      type="text"
                                      value={filter.value || ""}
                                      onChange={(e) => updateMultipleFilterFields({ value: e.target.value })}
                                      placeholder="请输入匹配值..."
                                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none placeholder:text-slate-400"
                                    />
                                  )}
                                </div>

                                {/* Remove Button */}
                                <div className="md:col-span-1 text-right">
                                  <button
                                    type="button"
                                    onClick={removeFilter}
                                    className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Step 3: Interactive Canvas Control Toolbar & Actions Flow */}
                    <div className="space-y-4 border-t border-slate-100 pt-6">
                      
                      {/* Control Toolbar: View Mode Switch, Zoom Controls, Fullscreen Canvas */}
                      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900 text-white rounded-2xl shadow-lg border border-slate-800 select-none">
                        {/* View Mode Switcher */}
                        <div className="flex items-center bg-slate-800 p-1 rounded-xl gap-1">
                          <button
                            type="button"
                            onClick={() => setViewMode("split")}
                            className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 ${
                              viewMode === "split" ? "bg-blue-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                            }`}
                          >
                            <Columns className="w-3.5 h-3.5" />
                            📊 树状双栏模式
                          </button>
                          <button
                            type="button"
                            onClick={() => setViewMode("vertical")}
                            className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 ${
                              viewMode === "vertical" ? "bg-blue-600 text-white shadow-sm" : "text-slate-400 hover:text-white"
                            }`}
                          >
                            <AlignJustify className="w-3.5 h-3.5" />
                            📱 纵向流水线模式
                          </button>
                        </div>

                        {/* Local Canvas Zoom Controls & Custom Direct Number Input */}
                        <div className="flex flex-wrap items-center gap-1.5 bg-slate-800 px-3 py-1.5 rounded-xl text-xs font-bold">
                          <span className="text-slate-400 text-[10px] uppercase font-black mr-1">🔍 比例:</span>
                          
                          {/* Decrement Button */}
                          <button
                            type="button"
                            onClick={() => setCanvasZoom(z => Math.max(30, z - 25))}
                            className="p-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
                            title="缩小 25%"
                          >
                            <ZoomOut className="w-3.5 h-3.5" />
                          </button>

                          {/* Direct Input & % Sign */}
                          <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg px-2 py-0.5 text-blue-400 font-mono text-[11px] font-black">
                            <input
                              type="number"
                              min={30}
                              max={500}
                              value={canvasZoom}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                if (!isNaN(val) && val > 0) {
                                  setCanvasZoom(Math.min(500, Math.max(30, val)));
                                }
                              }}
                              className="w-11 bg-transparent text-center text-blue-400 outline-none font-bold focus:text-white"
                            />
                            <span className="text-slate-400 text-[10px]">%</span>
                          </div>

                          {/* Increment Button */}
                          <button
                            type="button"
                            onClick={() => setCanvasZoom(z => Math.min(500, z + 25))}
                            className="p-1 text-slate-300 hover:text-white hover:bg-slate-700 rounded transition-colors"
                            title="放大 25%"
                          >
                            <ZoomIn className="w-3.5 h-3.5" />
                          </button>

                          {/* Preset Pills */}
                          <div className="hidden sm:flex items-center gap-1 ml-1 pl-1 border-l border-slate-700">
                            {[100, 150, 200, 300].map(p => (
                              <button
                                key={p}
                                type="button"
                                onClick={() => setCanvasZoom(p)}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-black transition-colors ${
                                  canvasZoom === p ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white hover:bg-slate-700"
                                }`}
                              >
                                {p}%
                              </button>
                            ))}
                          </div>

                          {/* Reset Button */}
                          <button
                            type="button"
                            onClick={() => setCanvasZoom(100)}
                            className="p-1 text-slate-400 hover:text-amber-400 hover:bg-slate-700 rounded transition-colors ml-0.5"
                            title="复位 100%"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Fullscreen Canvas Toggle */}
                        <button
                          type="button"
                          onClick={() => setIsFullscreenCanvas(!isFullscreenCanvas)}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded-xl transition-all shadow-md flex items-center gap-1.5"
                        >
                          {isFullscreenCanvas ? (
                            <>
                              <Minimize2 className="w-3.5 h-3.5" />
                              退出全屏
                            </>
                          ) : (
                            <>
                              <Maximize2 className="w-3.5 h-3.5" />
                              🖥️ 全屏大画布沉浸编辑
                            </>
                          )}
                        </button>
                      </div>

                      {/* Overflow Scrollable Canvas Wrapper with CSS Zoom (Fixes parent border overflow issue!) */}
                      <div className="w-full overflow-x-auto overflow-y-visible pb-4 custom-scrollbar">
                        <div
                          style={{
                            zoom: canvasZoom / 100,
                          }}
                          className="w-full transition-all duration-150"
                        >
                        <div className={viewMode === "split" ? "grid grid-cols-1 lg:grid-cols-2 gap-6" : "flex flex-col gap-6 w-full"}>
                          
                          {/* Left / Top Column: True Branch Actions */}
                          <div className={`space-y-4 ${viewMode === "split" ? "border-r border-slate-100 pr-0 lg:pr-6" : "w-full"}`}>
                            <div className="flex items-center justify-between bg-green-50 p-3 rounded-2xl border border-green-200/80">
                              <div className="flex items-center gap-2">
                                <CheckCircle className="w-4 h-4 text-green-600" />
                                <span className="text-xs font-black text-green-800">✅ 当符合条件时 (True) 执行的动作链</span>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-green-200/80 text-green-800">
                                  {(currentRule.actionsTrue || []).length} 个动作
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setRootTrueCollapsed(!rootTrueCollapsed)}
                                className="px-2.5 py-1 text-[10px] font-black text-green-700 bg-white border border-green-200 hover:bg-green-100 transition-colors rounded-xl flex items-center gap-1"
                              >
                                {rootTrueCollapsed ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                {rootTrueCollapsed ? "展开分支" : "收起/折叠"}
                              </button>
                            </div>

                            {!rootTrueCollapsed && (
                              <div className="space-y-3 min-h-[50px] animate-fadeIn">
                                {(currentRule.actionsTrue || []).map((action, aIdx) => (
                                  <ActionCard
                                    key={action.id}
                                    action={action}
                                    index={aIdx}
                                    isTrueBranch={true}
                                    steps={steps}
                                    campaigns={campaigns}
                                    materials={materials}
                                    existingTags={existingTags}
                                    users={users}
                                    contactFields={contactFields}
                                    parentViewMode={viewMode}
                                    onDelete={() => removeAction(activeRuleIndex, true, action.id)}
                                    onUpdate={(field, val) => updateActionField(activeRuleIndex, true, action.id, field, val)}
                                    onMove={(dir) => moveActionUpDown(aIdx, true, dir)}
                                    isFirst={aIdx === 0}
                                    isLast={aIdx === (currentRule.actionsTrue || []).length - 1}
                                    onDragStart={(e) => handleActionDragStart(e, aIdx, true)}
                                    onDragOver={(e) => handleActionDragOver(e, aIdx, true)}
                                    onDrop={(e) => handleActionDrop(e, aIdx, true)}
                                    isDraggingOver={dragOverAction?.index === aIdx && dragOverAction?.isTrueBranch === true}
                                  />
                                ))}
                                {(currentRule.actionsTrue || []).length === 0 && (
                                  <div 
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => handleActionDrop(e, 0, true)}
                                    className="text-center py-6 border border-dashed border-slate-200 text-xs text-slate-400 rounded-2xl bg-slate-50/50"
                                  >
                                    💡 拖拽动作卡片到此处，或在下方添加
                                  </div>
                                )}
                                <AddActionPopover onSelect={(type) => addAction(activeRuleIndex, true, type)} />
                              </div>
                            )}

                            {rootTrueCollapsed && (
                              <div 
                                onClick={() => setRootTrueCollapsed(false)}
                                className="p-3 bg-green-50/40 border border-dashed border-green-200 rounded-2xl text-center text-xs text-green-700 font-bold cursor-pointer hover:bg-green-50 transition-colors"
                              >
                                💡 当符合条件时 (True) 包含 {(currentRule.actionsTrue || []).length} 个动作节点 (点击展开查看与编辑)
                              </div>
                            )}
                          </div>

                          {/* Right / Bottom Column: False Branch Actions */}
                          <div className="space-y-4 w-full">
                            <div className="flex items-center justify-between bg-red-50 p-3 rounded-2xl border border-red-200/80">
                              <div className="flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-red-600" />
                                <span className="text-xs font-black text-red-800">❌ 当不符合条件时 (False) 执行的动作链</span>
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-red-200/80 text-red-800">
                                  {(currentRule.actionsFalse || []).length} 个动作
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setRootFalseCollapsed(!rootFalseCollapsed)}
                                className="px-2.5 py-1 text-[10px] font-black text-red-700 bg-white border border-red-200 hover:bg-red-100 transition-colors rounded-xl flex items-center gap-1"
                              >
                                {rootFalseCollapsed ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                {rootFalseCollapsed ? "展开分支" : "收起/折叠"}
                              </button>
                            </div>

                            {!rootFalseCollapsed && (
                              <div className="space-y-3 min-h-[50px] animate-fadeIn">
                                {(currentRule.actionsFalse || []).map((action, aIdx) => (
                                  <ActionCard
                                    key={action.id}
                                    action={action}
                                    index={aIdx}
                                    isTrueBranch={false}
                                    steps={steps}
                                    campaigns={campaigns}
                                    materials={materials}
                                    existingTags={existingTags}
                                    users={users}
                                    contactFields={contactFields}
                                    parentViewMode={viewMode}
                                    onDelete={() => removeAction(activeRuleIndex, false, action.id)}
                                    onUpdate={(field, val) => updateActionField(activeRuleIndex, false, action.id, field, val)}
                                    onMove={(dir) => moveActionUpDown(aIdx, false, dir)}
                                    isFirst={aIdx === 0}
                                    isLast={aIdx === (currentRule.actionsFalse || []).length - 1}
                                    onDragStart={(e) => handleActionDragStart(e, aIdx, false)}
                                    onDragOver={(e) => handleActionDragOver(e, aIdx, false)}
                                    onDrop={(e) => handleActionDrop(e, aIdx, false)}
                                    isDraggingOver={dragOverAction?.index === aIdx && dragOverAction?.isTrueBranch === false}
                                  />
                                ))}
                                {(currentRule.actionsFalse || []).length === 0 && (
                                  <div 
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => handleActionDrop(e, 0, false)}
                                    className="text-center py-6 border border-dashed border-slate-200 text-xs text-slate-400 rounded-2xl bg-slate-50/50"
                                  >
                                    💡 拖拽动作卡片到此处，或在下方添加
                                  </div>
                                )}
                                <AddActionPopover onSelect={(type) => addAction(activeRuleIndex, false, type)} />
                              </div>
                            )}

                            {rootFalseCollapsed && (
                              <div 
                                onClick={() => setRootFalseCollapsed(false)}
                                className="p-3 bg-red-50/40 border border-dashed border-red-200 rounded-2xl text-center text-xs text-red-700 font-bold cursor-pointer hover:bg-red-50 transition-colors"
                              >
                                💡 当不符合条件时 (False) 包含 {(currentRule.actionsFalse || []).length} 个动作节点 (点击展开查看与编辑)
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                )}
              </div>
            </div>
          </>
        )}
        </div>
      )}

      {/* Tab Content: Execution Logs */}
      {activeTab === "logs" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="font-black text-slate-900 text-lg flex items-center gap-2">
                <Clock className="w-5 h-5 text-blue-600" />
                规则执行日志
              </h2>
              <p className="text-xs text-slate-500 font-bold mt-1">
                展示最近 200 条自动规则的执行轨迹，帮助管理员和坐席排查流转状态与调用结果。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchLogs}
                disabled={logsLoading}
                className="px-4 py-2 text-xs font-black text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors rounded-xl flex items-center gap-1.5"
              >
                {logsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                刷新
              </button>
              <button
                type="button"
                onClick={clearLogs}
                disabled={logsLoading || logs.length === 0}
                className="px-4 py-2 text-xs font-black text-red-600 bg-red-50 border border-red-100 hover:bg-red-100 transition-colors rounded-xl flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                清空日志
              </button>
            </div>
          </div>

          {logsLoading && logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 bg-white border border-slate-100 rounded-3xl shadow-sm">
              <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              <span className="text-xs font-bold text-slate-500 mt-2">正在载入日志列表...</span>
            </div>
          ) : logsError ? (
            <div className="p-6 text-center text-red-500 font-bold text-xs bg-red-50 border border-red-100 rounded-2xl">
              ⚠️ {logsError}
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-20 text-slate-400 font-bold text-xs bg-white rounded-3xl border border-dashed border-slate-200">
              📭 暂无规则执行日志。当收到满足条件的客户来信并触发自动规则动作时，在此处会实时记录执行轨迹。
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-wider font-semibold">
                      <th className="py-4 px-6">触发规则</th>
                      <th className="py-4 px-6">联系人 / 手机号码</th>
                      <th className="py-4 px-6">来信内容</th>
                      <th className="py-4 px-6 text-center">状态</th>
                      <th className="py-4 px-6 text-center">耗时</th>
                      <th className="py-4 px-6">执行时间</th>
                      <th className="py-4 px-6 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logs.map((log) => {
                      const isExpanded = expandedLogId === log.id;
                      const formattedTime = new Date(log.createdAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit"
                      });
                      return (
                        <>
                          <tr
                            key={log.id}
                            onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                            className="hover:bg-slate-50/50 transition-colors cursor-pointer text-xs"
                          >
                            <td className="py-4 px-6 font-black text-slate-900">
                              {log.ruleName}
                            </td>
                            <td className="py-4 px-6 font-semibold text-slate-700">
                              <div className="flex flex-col">
                                <span className="font-black text-slate-900">{log.contactName || "未知名称"}</span>
                                <span className="text-[10px] text-slate-400 font-medium">{log.phone || "-"}</span>
                              </div>
                            </td>
                            <td className="py-4 px-6 max-w-xs truncate font-medium text-slate-600" title={log.messageText}>
                              {log.messageText || <span className="text-slate-400 font-semibold italic">(媒体或空消息)</span>}
                            </td>
                            <td className="py-4 px-6 text-center">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black border ${
                                log.status === "success"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                  : log.status === "failed"
                                  ? "bg-rose-50 text-rose-700 border-rose-100"
                                  : "bg-amber-50 text-amber-700 border-amber-100"
                              }`}>
                                {log.status === "success" && "成功"}
                                {log.status === "failed" && "失败"}
                                {log.status === "partial" && "部分失败"}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-center font-bold text-slate-500">
                              {log.duration}ms
                            </td>
                            <td className="py-4 px-6 font-medium text-slate-500">
                              {formattedTime}
                            </td>
                            <td className="py-4 px-6 text-right" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={(e) => deleteLog(log.id, e)}
                                className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200"
                                title="删除此日志"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>

                          {/* Expanded Detail Panels */}
                          {isExpanded && (
                            <tr className="bg-slate-50/30">
                              <td colSpan={7} className="py-4 px-6 border-b border-slate-100">
                                <div className="space-y-4 animate-fadeIn">
                                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                                    <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                                      <Cpu className="w-4 h-4 text-blue-600" />
                                      动作链运行轨迹详情
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">
                                      日志 ID: {log.id}
                                    </span>
                                  </div>

                                  {(!log.steps || log.steps.length === 0) ? (
                                    <div className="text-center py-4 text-slate-400 text-xs font-semibold">
                                      💡 该规则未执行任何动作。
                                    </div>
                                  ) : (
                                    <div className="relative pl-6 border-l border-slate-200 space-y-4 py-1">
                                      {log.steps.map((step: any, sIdx: number) => {
                                        let nodeTypeLabel = step.type;
                                        const labelMap: Record<string, string> = {
                                          delay: "⏱️ 延迟执行",
                                          auto_reply: "💬 自动回复",
                                          kanban_move: "🎯 看板列转移",
                                          priority_change: "🚨 变更紧急程度",
                                          admin_notify: "🔔 警报通知管理员",
                                          next_campaign: "📢 触发群发活动",
                                          relation_change: "🏷️ 更新属性/标签",
                                          webhook: "🔌 Webhook 对接",
                                          agent_assign: "👤 分配客服坐席",
                                          blacklist: "🚫 自动拉黑"
                                        };
                                        nodeTypeLabel = labelMap[step.type] || step.type;

                                        return (
                                          <div key={sIdx} className="relative group">
                                            {/* Timeline circle indicator */}
                                            <div className={`absolute -left-[30px] top-1 w-4 h-4 rounded-full border-2 bg-white flex items-center justify-center ${
                                              step.status === "success"
                                                ? "border-emerald-500 text-emerald-500"
                                                : "border-rose-500 text-rose-500"
                                            }`}>
                                              <div className={`w-1.5 h-1.5 rounded-full ${
                                                step.status === "success" ? "bg-emerald-500" : "bg-rose-500"
                                              }`} />
                                            </div>

                                            {/* Step item card detail */}
                                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-white border border-slate-100 rounded-xl shadow-sm hover:border-slate-200 transition-colors">
                                              <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                  <span className="text-xs font-black text-slate-900">{nodeTypeLabel}</span>
                                                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-black border uppercase ${
                                                    step.status === "success"
                                                      ? "bg-green-50 text-green-700 border-green-100"
                                                      : "bg-red-50 text-red-700 border-red-100"
                                                  }`}>
                                                    {step.status === "success" ? "成功" : "失败"}
                                                  </span>
                                                </div>
                                                <p className="text-[11px] text-slate-600 font-semibold leading-relaxed whitespace-pre-wrap">
                                                  {step.detail || "(无详情描述)"}
                                                </p>
                                              </div>
                                              <div className="text-[10px] text-slate-400 font-bold flex-shrink-0">
                                                耗时: {step.duration}ms
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Save Settings Button */}
      {activeTab !== "logs" && (
        <div className="flex justify-end mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-slate-950 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-colors disabled:opacity-50 shadow-lg"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {saving ? "正在存储数据..." : "保存所有自动规则配置"}
          </button>
        </div>
      )}
    </div>
  );
}

// 💡 Subcomponent: Action Card Node
function ActionCard({
  action,
  index,
  isTrueBranch,
  steps,
  campaigns,
  materials,
  existingTags,
  users,
  contactFields,
  parentViewMode = "split",
  onDelete,
  onUpdate,
  onMove,
  isFirst,
  isLast,
  onDragStart,
  onDragOver,
  onDrop,
  isDraggingOver
}: {
  action: ActionNode;
  index: number;
  isTrueBranch: boolean;
  steps: any[];
  campaigns: any[];
  materials: any[];
  existingTags: string[];
  users: any[];
  contactFields: { staticFields: any[]; dynamicFields: any[]; allFields: any[] };
  parentViewMode?: "split" | "vertical";
  onDelete: () => void;
  onUpdate: (field: keyof ActionNode, val: any) => void;
  onMove: (direction: "up" | "down") => void;
  isFirst: boolean;
  isLast: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isDraggingOver: boolean;
}) {
  const [isTrueCollapsed, setIsTrueCollapsed] = useState(false);
  const [isFalseCollapsed, setIsFalseCollapsed] = useState(false);

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`border border-slate-200/90 bg-white rounded-2xl p-3 sm:p-4 shadow-sm relative hover:shadow-md transition-all w-full min-w-0 sm:min-w-[280px] ${
        isDraggingOver ? "border-blue-500 border-dashed bg-blue-50/10 scale-[1.01] shadow-inner" : ""
      } ${action.enabled === false ? "opacity-60 bg-slate-50/50" : ""}`}
    >
      
      {/* Action adjustment & Delete buttons */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <button
          type="button"
          onClick={() => onMove("up")}
          disabled={isFirst}
          className="p-1 hover:bg-slate-100 active:bg-slate-200 rounded text-slate-500 disabled:opacity-30 disabled:hover:bg-transparent"
          title="上移"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove("down")}
          disabled={isLast}
          className="p-1 hover:bg-slate-100 active:bg-slate-200 rounded text-slate-500 disabled:opacity-30 disabled:hover:bg-transparent"
          title="下移"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          title="删除动作"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Drag handle & Header Info */}
      <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-3 select-none">
        <div className="text-slate-400 cursor-grab active:cursor-grabbing hover:text-slate-600 transition-colors">
          <GripVertical className="w-4 h-4" />
        </div>
        <input
          type="checkbox"
          checked={action.enabled !== false}
          onChange={(e) => onUpdate("enabled", e.target.checked)}
          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer mr-0.5"
          title={action.enabled !== false ? "点击禁用动作" : "点击启用动作"}
        />

        {action.type === "kanban_move" && <ArrowRight className="w-3.5 h-3.5 text-emerald-500" />}
        {action.type === "priority_change" && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
        {action.type === "auto_reply" && <MessageSquare className="w-3.5 h-3.5 text-purple-500" />}
        {action.type === "admin_notify" && <Phone className="w-3.5 h-3.5 text-amber-500" />}
        {action.type === "next_campaign" && <Play className="w-3.5 h-3.5 text-blue-500" />}
        {action.type === "delay" && <Clock className="w-3.5 h-3.5 text-teal-500" />}
        {action.type === "blacklist" && <UserMinus className="w-3.5 h-3.5 text-rose-500" />}
        {action.type === "relation_change" && <UserCheck className="w-3.5 h-3.5 text-sky-500" />}
        {action.type === "webhook" && <Cpu className="w-3.5 h-3.5 text-indigo-500" />}
        {action.type === "condition_branch" && <ToggleLeft className="w-3.5 h-3.5 text-blue-500" />}

        {action.type === "kanban_move" && `1. 看板列移动动作${action.enabled === false ? ' (已禁用)' : ''}`}
        {action.type === "priority_change" && `2. 变更卡片紧急程度${action.enabled === false ? ' (已禁用)' : ''}`}
        {action.type === "auto_reply" && `3. WhatsApp 自动回复客户${action.enabled === false ? ' (已禁用)' : ''}`}
        {action.type === "admin_notify" && `4. 管理员警报推送 (Evolution)${action.enabled === false ? ' (已禁用)' : ''}`}
        {action.type === "next_campaign" && `5. 触发下一轮跟进群发${action.enabled === false ? ' (已禁用)' : ''}`}
        {action.type === "delay" && `6. 管道时间延时器${action.enabled === false ? ' (已禁用)' : ''}`}
        {action.type === "blacklist" && `7. 一键拉黑防骚扰${action.enabled === false ? ' (已禁用)' : ''}`}
        {action.type === "relation_change" && `8. 联系人关系标签变更${action.enabled === false ? ' (已禁用)' : ''}`}
        {action.type === "webhook" && `9. 高级外部 Webhook 对接${action.enabled === false ? ' (已禁用)' : ''}`}
        {action.type === "condition_branch" && `10. 条件判断分支 (If-Else)${action.enabled === false ? ' (已禁用)' : ''}`}
      </div>

      {/* Node Body Inputs */}
      <div className="space-y-3">
        {action.type !== "condition_branch" && (
          <div className="flex items-center gap-1.5 text-[9px] font-black text-slate-500 bg-slate-50 p-2 rounded-xl border border-slate-200/40 w-fit select-none">
            <span>⚙️ 执行不成功时：</span>
            <select
              value={action.onFailurePolicy || "stop"}
              onChange={(e) => onUpdate("onFailurePolicy", e.target.value)}
              className="border-none bg-transparent p-0 text-[9px] font-black text-blue-600 focus:outline-none cursor-pointer"
            >
              <option value="stop">🛑 停止整个工作流</option>
              <option value="continue">➡️ 忽略并继续下一个节点</option>
            </select>
          </div>
        )}
        {action.type === "kanban_move" && (
          <div>
            <label className="block text-[9px] font-black text-slate-500 mb-1">选择移动到的看板列</label>
            <select
              value={action.targetStepId || ""}
              onChange={(e) => onUpdate("targetStepId", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
            >
              <option value="">保持原阶段，不移动</option>
              {steps.map(s => (
                <option key={s.id} value={s.id}>🎯 {s.name}</option>
              ))}
            </select>
          </div>
        )}

        {action.type === "priority_change" && (
          <div>
            <label className="block text-[9px] font-black text-slate-500 mb-1">选择目标紧急标识</label>
            <select
              value={action.priority || "mark_urgent"}
              onChange={(e) => onUpdate("priority", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
            >
              <option value="none">保持原紧急程度</option>
              <option value="mark_urgent">🚨 变更为“紧急” (红色且置顶)</option>
              <option value="normal">🟢 恢复为“普通” 程度</option>
            </select>
          </div>
        )}

        {action.type === "delay" && (
          <div>
            <label className="block text-[9px] font-black text-slate-500 mb-1">设置延迟执行等待时间 (秒，支持 1 到 300 秒)</label>
            <input
              type="number"
              min={1}
              max={300}
              value={action.delaySeconds !== undefined && action.delaySeconds !== null ? action.delaySeconds : ""}
              onChange={(e) => {
                const val = e.target.value;
                onUpdate("delaySeconds", val === "" ? "" : (parseInt(val, 10) || 0));
              }}
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
            />
          </div>
        )}

        {action.type === "blacklist" && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-100 p-2.5 rounded-xl font-bold flex items-center gap-1.5">
            <UserMinus className="w-4 h-4" />
            <span>命中此动作后，客户将被系统一键永久拉黑，以后任何群发都不会给其发信。</span>
          </div>
        )}

        {action.type === "relation_change" && (
          <div className="space-y-3 bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
            <div className="text-xs font-black text-slate-800 flex justify-between items-center">
              <span>🏷️ 联系人属性与字段批量更新</span>
              <button
                type="button"
                onClick={() => {
                  const currentList = action.propertyUpdates || [];
                  const firstField = contactFields?.allFields?.[0]?.name || "relation";
                  onUpdate("propertyUpdates", [...currentList, { field: firstField, value: "" }]);
                }}
                className="text-[10px] text-blue-600 hover:text-blue-700 font-bold flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> 添加属性修改项
              </button>
            </div>
            
            <div className="space-y-2">
              {(!action.propertyUpdates || action.propertyUpdates.length === 0) ? (
                <div className="space-y-1.5">
                  <label className="block text-[9px] font-bold text-slate-500">关系标签变动 (旧版兼容)</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={action.relationTags || ""}
                      onChange={(e) => onUpdate("relationTags", e.target.value)}
                      placeholder="例如: 意向客, 印度人"
                      className="flex-1 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-bold text-slate-900 bg-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        onUpdate("propertyUpdates", [{ field: "relation", value: action.relationTags || "" }]);
                      }}
                      className="text-[9px] bg-blue-50 text-blue-600 px-2 py-1 rounded-lg border border-blue-100 font-bold"
                    >
                      升级为新版多字段配置
                    </button>
                  </div>
                </div>
              ) : (
                action.propertyUpdates.map((update, idx) => (
                  <div key={idx} className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm space-y-2.5 relative">
                    {/* Header for individual update item */}
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                      <span className="text-[10px] font-black text-slate-500">修改项 #{idx + 1}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const newList = action.propertyUpdates!.filter((_, i) => i !== idx);
                          onUpdate("propertyUpdates", newList);
                        }}
                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex items-center justify-center border border-slate-200 bg-slate-50"
                        title="删除此修改项"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    
                    {/* Form Fields Stack */}
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[8px] font-black text-slate-400 mb-1 uppercase">选择属性/字段</label>
                        <select
                          value={update.field}
                          onChange={(e) => {
                            const newList = [...action.propertyUpdates!];
                            newList[idx].field = e.target.value;
                            onUpdate("propertyUpdates", newList);
                          }}
                          className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 bg-white outline-none"
                        >
                          {(contactFields?.allFields || []).map((f: any) => {
                            if (["id", "userId", "createdAt", "updatedAt", "properties", "sent", "responded", "sendCount", "lastSentAt", "groupId"].includes(f.name)) return null;
                            
                            let label = f.name;
                            if (f.name === "relation") label = "🏷️ 关系标签 (relation)";
                            else if (f.name === "market") label = "🌍 地区/市场 (market)";
                            else if (f.name === "name") label = "👤 姓名 (name)";
                            else if (f.name === "phone") label = "📞 电话号码 (phone)";
                            else if (f.name === "priority") label = "🚨 紧急状态 (priority)";
                            else if (f.name === "note") label = "📝 备注内容 (note)";
                            else if (f.isDynamic) label = `✏️ [自定义] ${f.name}`;
                            
                            return <option key={f.name} value={f.name}>{label}</option>;
                          })}
                        </select>
                      </div>
                      
                      <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1">
                          <label className="block text-[8px] font-black text-slate-400 mb-1 uppercase">修改值</label>
                          <input
                            type="text"
                            value={update.value}
                            onChange={(e) => {
                              const newList = [...action.propertyUpdates!];
                              newList[idx].value = e.target.value;
                              onUpdate("propertyUpdates", newList);
                            }}
                            placeholder="修改值 (可输入 {commandText})"
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 bg-white outline-none"
                          />
                        </div>
                        
                        <div className="w-full sm:w-1/3">
                          <label className="block text-[8px] font-black text-slate-400 mb-1 uppercase">更新模式</label>
                          <select
                            value={update.updateMode || "overwrite"}
                            onChange={(e) => {
                              const newList = [...action.propertyUpdates!];
                              newList[idx].updateMode = e.target.value;
                              onUpdate("propertyUpdates", newList);
                            }}
                            className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 bg-white outline-none"
                          >
                            <option value="overwrite">✍️ 覆盖</option>
                            <option value="prepend">⬆️ 置顶追加</option>
                            <option value="append">⬇️ 末尾追加</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <p className="text-[9px] text-slate-400 leading-relaxed font-bold">
              💡 可以一次性添加多个修改。如果是自定义列，会自动合并更新到 properties 字段中；如果是关系标签，建议用英文逗号隔开。
            </p>
          </div>
        )}

        {action.type === "agent_assign" && (
          <div className="space-y-3 bg-slate-50 p-3 rounded-2xl border border-slate-200/60">
            <div>
              <label className="block text-[8px] font-black text-slate-500 mb-1 uppercase">👤 分配模式</label>
              <select
                value={action.assignMode || "specific"}
                onChange={(e) => onUpdate("assignMode", e.target.value as any)}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-900 bg-white outline-none"
              >
                <option value="specific">👤 分配给指定客服坐席</option>
                <option value="round_robin">🔄 成员之间轮询均分 (Round-Robin)</option>
              </select>
            </div>

            {action.assignMode !== "round_robin" ? (
              <div>
                <label className="block text-[8px] font-black text-slate-500 mb-1 uppercase">选择客服坐席人员</label>
                <select
                  value={action.assignUserId || ""}
                  onChange={(e) => onUpdate("assignUserId", e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-900 bg-white outline-none"
                >
                  <option value="">-- 请选择坐席人员 --</option>
                  {(users || []).map(u => (
                    <option key={u.id} value={u.id}>👤 {u.name} ({u.email || u.id})</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="p-2.5 bg-blue-50 border border-blue-100 rounded-xl text-[10px] text-blue-700 font-bold leading-relaxed">
                ℹ️ 轮询分配模式下，系统在收到客户消息时，会自动获取所有非管理员客服坐席，按照接单轮流分配规则把联系人归属权划转。这保证了分配的绝对公平。
              </div>
            )}
          </div>
        )}

        {action.type === "admin_notify" && (
          <div className="space-y-3">
            <div>
              <label className="block text-[9px] font-black text-slate-500 mb-1">管理员报警接收号码</label>
              <input
                type="text"
                value={action.notifyPhone || ""}
                onChange={(e) => onUpdate("notifyPhone", e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="例如: 60123456789 (请勿使用带有加号的前缀，仅填数字)"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-500 mb-1">自定义通知报告内容 (支持通配符变量)</label>
              <textarea
                rows={4}
                value={action.notifyTemplate !== undefined ? action.notifyTemplate : ""}
                onChange={(e) => onUpdate("notifyTemplate", e.target.value)}
                placeholder="🔔【自动规则报警/新粉通知】&#10;客户名称：{name}&#10;电话号码：{phone}&#10;所属市场：{market}&#10;来信内容：{messageText}&#10;触发规则：{ruleName}"
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-50 outline-none placeholder:text-slate-400 font-mono"
              />
              <p className="text-[8px] text-slate-400 font-bold leading-normal mt-1">
                支持通配符: <span className="font-mono text-[9px] text-slate-600 font-black">{`{name}`}</span> (姓名), <span className="font-mono text-[9px] text-slate-600 font-black">{`{phone}`}</span> (号码), <span className="font-mono text-[9px] text-slate-600 font-black">{`{market}`}</span> (市场), <span className="font-mono text-[9px] text-slate-600 font-black">{`{messageText}`}</span> (内容), <span className="font-mono text-[9px] text-slate-600 font-black">{`{ruleName}`}</span> (规则名)
              </p>
            </div>
          </div>
        )}

        {action.type === "next_campaign" && (
          <div>
            <label className="block text-[9px] font-black text-slate-500 mb-1">选择要串联触发的群发活动 (自动入群并即时触发发信)</label>
            <select
              value={action.nextCampaignId || ""}
              onChange={(e) => onUpdate("nextCampaignId", e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
            >
              <option value="">不加入新活动</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>📢 {c.name}</option>
              ))}
            </select>
          </div>
        )}

        {action.type === "auto_reply" && (
          <div className="space-y-2.5">
            <div>
              <label className="block text-[8px] font-black text-slate-500 mb-1 uppercase">💬 自动回复消息流向</label>
              <select
                value={action.replyTarget || "group"}
                onChange={(e) => onUpdate("replyTarget", e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
              >
                <option value="group">👥 回复到原会话中 (群聊或私聊均适用)</option>
                <option value="private_chat">🔒 私聊给该发言群成员 (仅在群聊触发时向发言人私信)</option>
                <option value="private_only">💬 个人私聊自动回复 (仅对收到个人私发消息有效)</option>
              </select>
            </div>

            {/* Select mode */}
            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl mb-3">
              <button
                type="button"
                onClick={() => {
                  onUpdate("aiReplyEnabled", false);
                  onUpdate("materialId", "");
                }}
                className={`flex-1 text-[10px] py-1 font-black rounded-lg transition-all ${
                  (!action.aiReplyEnabled && !action.materialId)
                    ? "bg-white text-slate-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                ✍️ 固定文本
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdate("aiReplyEnabled", false);
                  if (!action.materialId && materials.length > 0) {
                    onUpdate("materialId", materials[0].id);
                  } else {
                    onUpdate("materialId", "select");
                  }
                }}
                className={`flex-1 text-[10px] py-1 font-black rounded-lg transition-all ${
                  (!action.aiReplyEnabled && action.materialId)
                    ? "bg-white text-slate-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                📦 素材库素材
              </button>
              <button
                type="button"
                onClick={() => {
                  onUpdate("aiReplyEnabled", true);
                  onUpdate("materialId", "");
                }}
                className={`flex-1 text-[10px] py-1 font-black rounded-lg transition-all ${
                  (action.aiReplyEnabled)
                    ? "bg-white text-slate-800 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                🤖 AI自适应
              </button>
            </div>

            {/* AI Adaptive Option Settings */}
            {action.aiReplyEnabled && (
              <div className="space-y-2 bg-slate-50 p-3 rounded-xl border border-slate-200/50 animate-fadeIn">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[8px] font-black text-slate-500 mb-1 uppercase">AI 服务商</label>
                    <select
                      value={action.aiReplyProvider || "openai"}
                      onChange={(e) => onUpdate("aiReplyProvider", e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold bg-white outline-none"
                    >
                      <option value="openai">OpenAI</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="gemini">Google Gemini</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[8px] font-black text-slate-500 mb-1 uppercase">模型名称</label>
                    <select
                      value={action.aiReplyModel || "gpt-4o-mini"}
                      onChange={(e) => onUpdate("aiReplyModel", e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1 text-[10px] font-bold bg-white outline-none"
                    >
                      {action.aiReplyProvider === "openai" && (
                        <>
                          <option value="gpt-4o-mini">gpt-4o-mini</option>
                          <option value="gpt-4o">gpt-4o</option>
                        </>
                      )}
                      {action.aiReplyProvider === "deepseek" && (
                        <>
                          <option value="deepseek-chat">deepseek-chat</option>
                        </>
                      )}
                      {action.aiReplyProvider === "gemini" && (
                        <>
                          <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                          <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[8px] font-black text-slate-500 mb-1">AI 知识库上下文及回复要求提示词 (Prompt)</label>
                  <textarea
                    rows={3}
                    value={action.aiReplyPrompt || ""}
                    onChange={(e) => onUpdate("aiReplyPrompt", e.target.value)}
                    placeholder="在这里输入产品售价、背景介绍。AI 会自动以此回答客户的提问并翻译为同种语言..."
                    className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-900 bg-white focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Material Library Option Settings */}
            {!action.aiReplyEnabled && action.materialId && (
              <div className="space-y-2.5 animate-fadeIn">
                <label className="block text-[8px] font-black text-slate-500 uppercase">选择素材库内容</label>
                <select
                  value={action.materialId || ""}
                  onChange={(e) => onUpdate("materialId", e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 bg-white outline-none"
                >
                  <option value="select" disabled>-- 请选择素材 --</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.type === "text" ? "📝" : m.type === "image" ? "🖼️" : m.type === "video" ? "📹" : m.type === "audio" ? "🎵" : "📁"} {m.name}
                    </option>
                  ))}
                </select>

                {(() => {
                  const selected = materials.find(m => String(m.id) === String(action.materialId));
                  if (!selected) return null;
                  return (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="flex justify-between items-center text-[9px] font-black text-slate-400">
                        <span>类型: {selected.type.toUpperCase()}</span>
                        <span>名称: {selected.name}</span>
                      </div>
                      {selected.type === "text" && (
                        <p className="text-xs text-slate-700 font-semibold bg-white p-2 rounded-lg border border-slate-200/50 whitespace-pre-wrap">
                          {selected.content}
                        </p>
                      )}
                      {selected.type === "image" && (
                        <div className="space-y-1">
                          <img src={selected.url} alt={selected.name} className="max-h-32 object-contain rounded-lg border border-slate-200 bg-white p-1" />
                          {selected.content && (
                            <p className="text-[10px] text-slate-500 font-semibold italic">附带文本: {selected.content}</p>
                          )}
                        </div>
                      )}
                      {["video", "audio", "file"].includes(selected.type) && (
                        <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-slate-200/50">
                          <span className="text-lg">
                            {selected.type === "video" ? "📹" : selected.type === "audio" ? "🎵" : "📁"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-700 truncate">{selected.name}</p>
                            <a href={selected.url} target="_blank" rel="noreferrer" className="text-[9px] text-blue-600 font-bold hover:underline truncate block">
                              {selected.url}
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Manual Fixed Text Option Settings */}
            {!action.aiReplyEnabled && !action.materialId && (
              <div>
                <label className="block text-[8px] font-black text-slate-500 mb-1">普通固定文本回复内容</label>
                <textarea
                  rows={2}
                  value={action.autoReplyText || ""}
                  onChange={(e) => onUpdate("autoReplyText", e.target.value)}
                  placeholder="输入自动回复客户的消息内容..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-50 outline-none"
                />
              </div>
            )}
          </div>
        )}

        {action.type === "webhook" && (
          <div className="space-y-3 animate-fadeIn">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[9px] font-black text-slate-500 mb-1">请求方式</label>
                <select
                  value={action.webhookMethod || "POST"}
                  onChange={(e) => onUpdate("webhookMethod", e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                >
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-[9px] font-black text-slate-500 mb-1">Webhook URL</label>
                <input
                  type="url"
                  value={action.webhookUrl || ""}
                  onChange={(e) => onUpdate("webhookUrl", e.target.value)}
                  placeholder="https://example.com/webhook"
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-900 bg-slate-50 outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-[9px] font-black text-slate-500 mb-1">自定义 Headers (JSON 格式)</label>
              <textarea
                rows={3}
                value={action.webhookHeaders || ""}
                onChange={(e) => onUpdate("webhookHeaders", e.target.value)}
                placeholder={`{\n  "Authorization": "Bearer token",\n  "X-Custom-Header": "value"\n}`}
                className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-50 outline-none font-mono placeholder:text-slate-400"
              />
            </div>
            <p className="text-[9px] text-slate-400 font-semibold leading-relaxed">
              💡 触发后将异步执行请求。如果是 POST 请求，Payload 将包含 matchedRuleName, message 文本, contact 联系人元数据等字段。
            </p>
          </div>
        )}

        {action.type === "condition_branch" && (
          <div className="space-y-4 border border-blue-200/60 p-4 bg-slate-50/50 rounded-2xl">
            {/* Filter Editor Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-800 flex items-center gap-1.5">
                  ⚡ 高级分支条件过滤器 (AND 组合关系)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const currentFilters = action.filters || [];
                    const newFilter = {
                      field: "chatType",
                      operator: "equals",
                      value: "private",
                      targetSubject: "group_card" as const
                    };
                    onUpdate("filters", [...currentFilters, newFilter]);
                  }}
                  className="px-2.5 py-1 text-[9px] font-black text-blue-600 bg-white border border-blue-200 hover:bg-blue-50 transition-colors rounded-lg flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" />
                  添加条件
                </button>
              </div>

              {(!action.filters || action.filters.length === 0) ? (
                <div className="text-center py-3 text-slate-400 text-[10px] font-bold border border-dashed border-slate-200 rounded-xl bg-white">
                  💡 未配置分支条件，此分支节点将默认匹配通过。
                </div>
              ) : (
                <div className="space-y-2">
                  {action.filters.map((filter, fIdx) => {
                    const updateFilterField = (fieldsObj: Record<string, any>) => {
                      const nextFilters = [...(action.filters || [])];
                      nextFilters[fIdx] = {
                        ...nextFilters[fIdx],
                        ...fieldsObj
                      };
                      onUpdate("filters", nextFilters);
                    };

                    const removeFilter = () => {
                      const nextFilters = (action.filters || []).filter((_, idx) => idx !== fIdx);
                      onUpdate("filters", nextFilters);
                    };

                    return (
                      <div key={fIdx} className="grid grid-cols-1 md:grid-cols-12 gap-1.5 bg-white p-2.5 rounded-xl border border-slate-200 items-end shadow-sm animate-fadeIn">
                        {/* Target Subject */}
                        <div className="md:col-span-3">
                          <label className="block text-[8px] font-black text-slate-400 mb-0.5 uppercase">匹配主体</label>
                          <select
                            value={filter.targetSubject || "group_card"}
                            onChange={(e) => updateFilterField({ targetSubject: e.target.value })}
                            className="w-full border border-slate-200 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none"
                          >
                            <option value="group_card">群聊/对话主体</option>
                            <option value="group_member">群聊发言人个人</option>
                          </select>
                        </div>

                        {/* Field Choice */}
                        <div className="md:col-span-3">
                          <label className="block text-[8px] font-black text-slate-400 mb-0.5 uppercase">匹配字段</label>
                          <select
                            value={filter.field}
                            onChange={(e) => {
                              const newField = e.target.value;
                              let defaultOp = "equals";
                              let defaultVal = "";
                              if (newField === "chatType") {
                                defaultOp = "equals";
                                defaultVal = "private";
                              } else if (newField === "messageType") {
                                defaultOp = "equals";
                                defaultVal = "text";
                              } else if (newField === "phonePrefix") {
                                defaultOp = "starts_with";
                              } else if (newField === "isNewContact") {
                                defaultOp = "equals";
                                defaultVal = "true";
                              } else if (newField === "relation") {
                                defaultOp = "contains";
                              } else if (newField === "messageText") {
                                defaultOp = "contains";
                                defaultVal = "";
                              } else if (newField === "aiIntent") {
                                defaultOp = "equals";
                                defaultVal = "positive";
                              } else if (newField === "visionReceipt") {
                                defaultOp = "equals";
                                defaultVal = "true";
                              }
                              updateFilterField({
                                field: newField,
                                operator: defaultOp,
                                value: defaultVal
                              });
                            }}
                            className="w-full border border-slate-200 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none"
                          >
                            <option value="chatType">💬 私聊/群聊类型</option>
                            <option value="messageType">✉️ 来信消息类型 (文本/图片/语音)</option>
                            <option value="messageText">✍️ 来信文本内容</option>
                            <option value="aiIntent">🤖 AI 智能意图分类</option>
                            <option value="visionReceipt">🖼️ Vision 转账凭证判定</option>
                            <option value="phonePrefix">📞 手机号码前缀</option>
                            <option value="isNewContact">🆕 是否为新联系人</option>
                            <option value="relation">🏷️ 关系标签 (Relation)</option>
                            <option value="stepId">🎯 看板列 (Step)</option>
                            <option value="market">🌍 市场 (Market)</option>
                            <option value="priority">🚨 优先级 (Priority)</option>
                            <option value="note">📝 备注内容 (Note)</option>
                            {contactFields.dynamicFields?.map((df: any) => (
                              <option key={df.name} value={`properties.${df.name}`}>🏷️ [自定义] {df.name}</option>
                            ))}
                          </select>
                        </div>

                        {/* Operator */}
                        <div className="md:col-span-3">
                          <label className="block text-[8px] font-black text-slate-400 mb-0.5 uppercase">运算符</label>
                          <select
                            value={filter.operator}
                            onChange={(e) => updateFilterField({ operator: e.target.value })}
                            className="w-full border border-slate-200 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none"
                          >
                            {filter.field === "phonePrefix" ? (
                              <>
                                <option value="starts_with">以...开头</option>
                                <option value="not_starts_with">不以...开头</option>
                              </>
                            ) : filter.field === "chatType" || filter.field === "isNewContact" || filter.field === "messageType" || filter.field === "aiIntent" || filter.field === "visionReceipt" ? (
                              <>
                                <option value="equals">等于</option>
                                <option value="not_equals">不等于</option>
                              </>
                            ) : filter.field === "messageText" ? (
                              <>
                                <option value="equals">等于</option>
                                <option value="not_equals">不等于</option>
                                <option value="contains">包含</option>
                                <option value="not_contains">不包含</option>
                                <option value="starts_with">以...开头</option>
                              </>
                            ) : (
                              <>
                                <option value="equals">等于</option>
                                <option value="not_equals">不等于</option>
                                <option value="contains">包含</option>
                                <option value="not_contains">不包含</option>
                                <option value="is_empty">为空</option>
                                <option value="is_not_empty">不为空</option>
                              </>
                            )}
                          </select>
                        </div>

                        {/* Value Input */}
                        <div className="md:col-span-2">
                          <label className="block text-[8px] font-black text-slate-400 mb-0.5 uppercase">匹配值</label>
                          {filter.operator === "is_empty" || filter.operator === "is_not_empty" ? (
                            <div className="text-[9px] font-bold text-slate-400 py-0.5 bg-slate-50 text-center rounded border border-dashed">
                              无需参数
                            </div>
                          ) : filter.field === "chatType" ? (
                            <select
                              value={filter.value}
                              onChange={(e) => updateFilterField({ value: e.target.value })}
                              className="w-full border border-slate-200 rounded-md px-1 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none"
                            >
                              <option value="private">私聊 (Private)</option>
                              <option value="group">群聊 (Group)</option>
                            </select>
                          ) : filter.field === "messageType" ? (
                            <select
                              value={filter.value || "text"}
                              onChange={(e) => updateFilterField({ value: e.target.value })}
                              className="w-full border border-slate-200 rounded-md px-1 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none"
                            >
                              <option value="text">✍️ 文本 (text)</option>
                              <option value="image">🖼️ 图片 (image)</option>
                              <option value="audio">🎤 语音 (audio)</option>
                              <option value="video">📹 视频 (video)</option>
                              <option value="document">📁 文档 (document)</option>
                            </select>
                          ) : filter.field === "isNewContact" ? (
                            <select
                              value={filter.value}
                              onChange={(e) => updateFilterField({ value: e.target.value })}
                              className="w-full border border-slate-200 rounded-md px-1 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none"
                            >
                              <option value="true">是 (True)</option>
                              <option value="false">否 (False)</option>
                            </select>
                          ) : filter.field === "stepId" ? (
                            <select
                              value={filter.value}
                              onChange={(e) => updateFilterField({ value: e.target.value })}
                              className="w-full border border-slate-200 rounded-md px-1 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none"
                            >
                              <option value="">请选择看板列...</option>
                              {steps.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          ) : filter.field === "priority" ? (
                            <select
                              value={filter.value}
                              onChange={(e) => updateFilterField({ value: e.target.value })}
                              className="w-full border border-slate-200 rounded-md px-1 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none"
                            >
                              <option value="urgent">紧急 (Urgent)</option>
                              <option value="high">高 (High)</option>
                              <option value="medium">中 (Medium)</option>
                              <option value="normal">正常 (Normal)</option>
                              <option value="low">低 (Low)</option>
                            </select>
                          ) : filter.field === "messageText" ? (
                            <input
                              type="text"
                              value={filter.value || ""}
                              onChange={(e) => updateFilterField({ value: e.target.value })}
                              placeholder="例如: 价格, 多少钱 (逗号分隔)"
                              className="w-full border border-slate-200 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none placeholder:text-slate-400"
                            />
                          ) : filter.field === "aiIntent" ? (
                            <select
                              value={filter.value || "positive"}
                              onChange={(e) => updateFilterField({ value: e.target.value })}
                              className="w-full border border-slate-200 rounded-md px-1 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none"
                            >
                              <option value="positive">意向客户 (positive)</option>
                              <option value="negative">拒绝/退订 (negative)</option>
                              <option value="custom">其它咨询 (custom)</option>
                            </select>
                          ) : filter.field === "visionReceipt" ? (
                            <select
                              value={filter.value || "true"}
                              onChange={(e) => updateFilterField({ value: e.target.value })}
                              className="w-full border border-slate-200 rounded-md px-1 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none"
                            >
                              <option value="true">是转账凭证 (true)</option>
                              <option value="false">非转账凭证 (false)</option>
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={filter.value || ""}
                              onChange={(e) => updateFilterField({ value: e.target.value })}
                              placeholder="请输入匹配值..."
                              className="w-full border border-slate-200 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-slate-900 bg-slate-50 outline-none placeholder:text-slate-400"
                            />
                          )}
                        </div>

                        {/* Remove Filter Button */}
                        <div className="md:col-span-1 text-right">
                          <button
                            type="button"
                            onClick={removeFilter}
                            className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Tree Branch Slots (Responsive Split / Vertical Mode) */}
            <div className={parentViewMode === "split" ? "grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 border-t border-slate-200/60 pt-4" : "flex flex-col gap-4 mt-4 border-t border-slate-200/60 pt-4 w-full"}>
              
              {/* True Branch Actions Column */}
              <div className="space-y-2 bg-white p-1.5 sm:p-3 rounded-2xl border border-slate-200/60 w-full">
                <div className="flex items-center justify-between bg-emerald-50 px-2.5 py-1.5 rounded-xl border border-emerald-100 select-none">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-[10px] font-black text-emerald-800">当满足以上条件时执行 (True)</span>
                    <span className="px-1.5 py-0.2 text-[9px] font-black bg-emerald-200/80 text-emerald-800 rounded-full">
                      {(action.actionsTrue || []).length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsTrueCollapsed(!isTrueCollapsed)}
                    className="px-2 py-0.5 text-[9px] font-black text-emerald-700 bg-white border border-emerald-200 hover:bg-emerald-100 transition-colors rounded-lg flex items-center gap-1"
                  >
                    {isTrueCollapsed ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {isTrueCollapsed ? "展开" : "折叠"}
                  </button>
                </div>

                {!isTrueCollapsed && (
                  <div className="space-y-3 min-h-[40px] border-l-2 border-dashed border-emerald-400 pl-2 sm:pl-3 my-1.5 w-full animate-fadeIn">
                    {(action.actionsTrue || []).map((subAction, subIdx) => (
                      <ActionCard
                        key={subAction.id}
                        action={subAction}
                        index={subIdx}
                        isTrueBranch={isTrueBranch}
                        steps={steps}
                        campaigns={campaigns}
                        materials={materials}
                        existingTags={existingTags}
                        users={users}
                        contactFields={contactFields}
                        parentViewMode={parentViewMode}
                        onDelete={() => {
                          const nextActions = (action.actionsTrue || []).filter(a => a.id !== subAction.id);
                          onUpdate("actionsTrue", nextActions);
                        }}
                        onUpdate={(subField, subVal) => {
                          const nextActions = [...(action.actionsTrue || [])];
                          nextActions[subIdx] = {
                            ...nextActions[subIdx],
                            [subField]: subVal
                          };
                          onUpdate("actionsTrue", nextActions);
                        }}
                        onMove={(dir) => {
                          const nextActions = [...(action.actionsTrue || [])];
                          const targetIdx = dir === "up" ? subIdx - 1 : subIdx + 1;
                          if (targetIdx >= 0 && targetIdx < nextActions.length) {
                            const temp = nextActions[subIdx];
                            nextActions[subIdx] = nextActions[targetIdx];
                            nextActions[targetIdx] = temp;
                            onUpdate("actionsTrue", nextActions);
                          }
                        }}
                        isFirst={subIdx === 0}
                        isLast={subIdx === (action.actionsTrue || []).length - 1}
                        onDragStart={() => {}}
                        onDragOver={() => {}}
                        onDrop={() => {}}
                        isDraggingOver={false}
                      />
                    ))}
                    {(action.actionsTrue || []).length === 0 && (
                      <div className="text-center py-6 text-[10px] text-slate-400 font-bold">
                        💡 暂无动作，点击下方添加
                      </div>
                    )}
                  </div>
                )}

                {isTrueCollapsed && (
                  <div
                    onClick={() => setIsTrueCollapsed(false)}
                    className="p-2.5 bg-emerald-50/40 border border-dashed border-emerald-200 rounded-xl text-center text-[10px] text-emerald-700 font-bold cursor-pointer hover:bg-emerald-50 transition-colors"
                  >
                    💡 当符合条件时 (True) 包含 {(action.actionsTrue || []).length} 个节点 (点击展开查看与编辑)
                  </div>
                )}

                {!isTrueCollapsed && (
                  <AddActionPopover
                    onSelect={(subType) => {
                      const newSubAction: ActionNode = {
                        id: "act_" + Math.random().toString(36).slice(2, 12),
                        type: subType,
                        targetStepId: steps[0]?.id || "",
                        priority: "mark_urgent",
                        autoReplyText: "",
                        aiReplyEnabled: false,
                        aiReplyPrompt: "你是一个智能多语言客服助手。请根据客户发来的消息语种，自动用相同的语种进行热情专业的解答。如果对方发马来文，你就用马来文回复；对方发英文，用英文回复；发中文，用中文回复。报价与产品政策如下：",
                        aiReplyProvider: "openai",
                        aiReplyModel: "gpt-4o-mini",
                        notifyPhone: "60123456789",
                        nextCampaignId: campaigns[0]?.id || "",
                        delaySeconds: 5,
                        relationTags: "",
                        webhookUrl: "",
                        webhookMethod: "POST",
                        webhookHeaders: "{\n  \"Content-Type\": \"application/json\"\n}",
                        materialId: "",
                        propertyUpdates: [],
                        assignUserId: "",
                        assignMode: "specific",
                        onFailurePolicy: "stop",
                        enabled: true,
                        filters: [],
                        actionsTrue: [],
                        actionsFalse: []
                      };
                      onUpdate("actionsTrue", [...(action.actionsTrue || []), newSubAction]);
                    }}
                  />
                )}
              </div>

              {/* False Branch Actions Column */}
              <div className="space-y-2 bg-white p-1.5 sm:p-3 rounded-2xl border border-slate-200/60 w-full">
                <div className="flex items-center justify-between bg-red-50 px-2.5 py-1.5 rounded-xl border border-red-100 select-none">
                  <div className="flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                    <span className="text-[10px] font-black text-red-800">当不满足以上条件时执行 (False)</span>
                    <span className="px-1.5 py-0.2 text-[9px] font-black bg-red-200/80 text-red-800 rounded-full">
                      {(action.actionsFalse || []).length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsFalseCollapsed(!isFalseCollapsed)}
                    className="px-2 py-0.5 text-[9px] font-black text-red-700 bg-white border border-red-200 hover:bg-red-100 transition-colors rounded-lg flex items-center gap-1"
                  >
                    {isFalseCollapsed ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    {isFalseCollapsed ? "展开" : "折叠"}
                  </button>
                </div>

                {!isFalseCollapsed && (
                  <div className="space-y-3 min-h-[40px] border-l-2 border-dashed border-red-400 pl-2 sm:pl-3 my-1.5 w-full animate-fadeIn">
                    {(action.actionsFalse || []).map((subAction, subIdx) => (
                      <ActionCard
                        key={subAction.id}
                        action={subAction}
                        index={subIdx}
                        isTrueBranch={isTrueBranch}
                        steps={steps}
                        campaigns={campaigns}
                        materials={materials}
                        existingTags={existingTags}
                        users={users}
                        contactFields={contactFields}
                        parentViewMode={parentViewMode}
                        onDelete={() => {
                          const nextActions = (action.actionsFalse || []).filter(a => a.id !== subAction.id);
                          onUpdate("actionsFalse", nextActions);
                        }}
                        onUpdate={(subField, subVal) => {
                          const nextActions = [...(action.actionsFalse || [])];
                          nextActions[subIdx] = {
                            ...nextActions[subIdx],
                            [subField]: subVal
                          };
                          onUpdate("actionsFalse", nextActions);
                        }}
                        onMove={(dir) => {
                          const nextActions = [...(action.actionsFalse || [])];
                          const targetIdx = dir === "up" ? subIdx - 1 : subIdx + 1;
                          if (targetIdx >= 0 && targetIdx < nextActions.length) {
                            const temp = nextActions[subIdx];
                            nextActions[subIdx] = nextActions[targetIdx];
                            nextActions[targetIdx] = temp;
                            onUpdate("actionsFalse", nextActions);
                          }
                        }}
                        isFirst={subIdx === 0}
                        isLast={subIdx === (action.actionsFalse || []).length - 1}
                        onDragStart={() => {}}
                        onDragOver={() => {}}
                        onDrop={() => {}}
                        isDraggingOver={false}
                      />
                    ))}
                    {(action.actionsFalse || []).length === 0 && (
                      <div className="text-center py-6 text-[10px] text-slate-400 font-bold">
                        💡 暂无动作，点击下方添加
                      </div>
                    )}
                  </div>
                )}

                {isFalseCollapsed && (
                  <div
                    onClick={() => setIsFalseCollapsed(false)}
                    className="p-2.5 bg-red-50/40 border border-dashed border-red-200 rounded-xl text-center text-[10px] text-red-700 font-bold cursor-pointer hover:bg-red-50 transition-colors"
                  >
                    💡 当不符合条件时 (False) 包含 {(action.actionsFalse || []).length} 个节点 (点击展开查看与编辑)
                  </div>
                )}

                {!isFalseCollapsed && (
                  <AddActionPopover
                    onSelect={(subType) => {
                      const newSubAction: ActionNode = {
                        id: "act_" + Math.random().toString(36).slice(2, 12),
                        type: subType,
                        targetStepId: steps[0]?.id || "",
                        priority: "mark_urgent",
                        autoReplyText: "",
                        aiReplyEnabled: false,
                        aiReplyPrompt: "你是一个智能多语言客服助手。请根据客户发来的消息语种，自动用相同的语种进行热情专业的解答。如果对方发马来文，你就用马来文回复；对方发英文，用英文回复；发中文，用中文回复。报价与产品政策如下：",
                        aiReplyProvider: "openai",
                        aiReplyModel: "gpt-4o-mini",
                        notifyPhone: "60123456789",
                        nextCampaignId: campaigns[0]?.id || "",
                        delaySeconds: 5,
                        relationTags: "",
                        webhookUrl: "",
                        webhookMethod: "POST",
                        webhookHeaders: "{\n  \"Content-Type\": \"application/json\"\n}",
                        materialId: "",
                        propertyUpdates: [],
                        assignUserId: "",
                        assignMode: "specific",
                        onFailurePolicy: "stop",
                        enabled: true,
                        filters: [],
                        actionsTrue: [],
                        actionsFalse: []
                      };
                      onUpdate("actionsFalse", [...(action.actionsFalse || []), newSubAction]);
                    }}
                  />
                )}
              </div>

            </div>

          </div>
        )}
      </div>

    </div>
  );
}

// 💡 Subcomponent: Popover Trigger for Adding Action Nodes
function AddActionPopover({ onSelect }: { onSelect: (type: ActionNode["type"]) => void }) {
  const [open, setOpen] = useState(false);

  const options: { type: ActionNode["type"]; label: string; desc: string }[] = [
    { type: "delay", label: "⏱️ 延迟执行计时器", desc: "延迟一段时间再运行后续动作，模拟真人操作" },
    { type: "auto_reply", label: "💬 WhatsApp 自动回复客户", desc: "发送固对话文本，或调用自适应语言翻译的 AI 客服" },
    { type: "kanban_move", label: "🎯 看板卡片列转移", desc: "更改联系人在看板中的阶段列位置" },
    { type: "priority_change", label: "🚨 变更紧急程度", desc: "标为紧急并使得联系人置顶" },
    { type: "admin_notify", label: "🔔 警报通知管理员", desc: "向指定的管理员手机发送事件报警" },
    { type: "next_campaign", label: "📢 触发下一轮跟进群发", desc: "将该客户自动追加到指定活动并立刻触发发信" },
    { type: "relation_change", label: "🏷️ 批量更新联系人属性", desc: "一次性修改联系人的多个静态或自定义列属性值" },
    { type: "webhook", label: "🔌 高级外部 Webhook 对接", desc: "对接第三方平台，触发自定义 API 调用" },
    { type: "agent_assign", label: "👤 分配客服坐席/轮询", desc: "自动将联系人分配给特定的客服坐席或使用轮询模式" },
    { type: "blacklist", label: "🚫 自动拉黑当前联系人", desc: "将该号码自动加入黑名单，防止以后群发打扰" },
    { type: "condition_branch", label: "🔀 条件判断分支 (If-Else)", desc: "在动作链中间插入一个条件判断节点，分流执行不同的子动作" },
  ];

  return (
    <div className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-xs font-black text-slate-700 rounded-2xl border border-dashed border-slate-300"
      >
        <Plus className="w-4 h-4" />
        添加执行动作节点
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 bottom-12 w-full min-w-[300px] max-h-[350px] overflow-y-auto z-20 bg-white border border-slate-200 rounded-2xl shadow-xl p-2.5 space-y-1">
            <div className="text-[10px] font-black text-slate-400 p-2 uppercase border-b border-slate-100 mb-1">
              选择要添加的动作节点类型
            </div>
            {options.map((opt) => (
              <button
                key={opt.type}
                type="button"
                onClick={() => {
                  onSelect(opt.type);
                  setOpen(false);
                }}
                className="w-full text-left p-2 hover:bg-slate-50 rounded-xl transition-colors group"
              >
                <div className="text-xs font-black text-slate-800 group-hover:text-blue-600">
                  {opt.label}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {opt.desc}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
