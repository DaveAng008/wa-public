"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { PageLoading } from "@/components/ui/LoadingSpinner";
import { 
  Plus, 
  Trash2, 
  Settings2, 
  Loader2, 
  ArrowUpRight, 
  HelpCircle, 
  Activity, 
  AlertTriangle, 
  Send, 
  Clock, 
  ExternalLink,
  ChevronDown,
  X,
  FileSpreadsheet,
  EyeOff,
  Eye,
  Search,
  Save,
  SlidersHorizontal,
  BarChart2,
  Sparkles
} from "lucide-react";

interface Step {
  id: string;
  name: string;
  color: string;
  order: number;
  automation_config?: any;
}

interface Task {
  id: string;
  step_id: string;
  title: string;
  phone: string;
  priority: "low" | "medium" | "high" | "urgent";
  last_activity_at: string;
  due_date: string | null;
  note: string | null;
  labels: string[];
  source: string;
  order: number;
  properties?: Record<string, any>;
  sendCount?: number;
}

interface ConditionalStyleRule {
  field: string;
  operator: "equals" | "contains" | "greater_than" | "less_than";
  value: string;
  color: "gold" | "red" | "green" | "blue" | "purple";
}

interface CardLayoutConfig {
  subtitleField?: string;
  highlightField?: string;
  tagFields?: string[];
  detailFields?: string[];
  aliases?: Record<string, string>;
  conditionalStyles?: ConditionalStyleRule[];
}

interface CardLayoutState {
  global: CardLayoutConfig;
  steps: Record<string, CardLayoutConfig>;
}

interface InlineEditState {
  taskId: string;
  field: string;
  value: string;
  isDynamic: boolean;
}

const formatFieldValue = (val: any) => {
  if (val === undefined || val === null || val === "") return "";
  const str = String(val).trim();
  
  // 1. Check if URL
  if (/^https?:\/\/[^\s]+$/i.test(str)) {
    return (
      <a 
        href={str} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        链接 <ExternalLink className="w-2.5 h-2.5 inline" />
      </a>
    );
  }
  
  // 2. Check if Date
  const dateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  if (dateRegex.test(str) || (str.length >= 10 && !isNaN(Date.parse(str)) && isNaN(Number(str)))) {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      const now = new Date();
      const diffMs = now.getTime() - parsed.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      if (Math.abs(diffDays) === 0) {
        return "今天 " + parsed.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      } else if (diffDays === 1) {
        return "昨天 " + parsed.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      } else if (diffDays === -1) {
        return "明天 " + parsed.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      } else if (diffDays > 1 && diffDays < 30) {
        return `${diffDays}天前`;
      } else if (diffDays < -1 && diffDays > -30) {
        return `${Math.abs(diffDays)}天后`;
      } else {
        return parsed.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
      }
    }
  }
  
  // 2.5 Check if Phone Number (e.g. 7-15 digits of pure numbers)
  if (/^\+?\d{7,15}$/.test(str)) {
    // If it starts with 60 (Malaysia) and length is at least 10, format as 60-xxxxxxxx
    if (str.startsWith("60") && str.length >= 10) {
      return `60-${str.slice(2)}`;
    }
    return str; // return raw phone number as-is (no commas!)
  }

  // 3. Check if Number
  if (!isNaN(Number(str)) && str.length > 0 && !str.startsWith("0")) {
    const num = Number(str);
    if (Number.isInteger(num)) {
      return num.toLocaleString("zh-CN");
    } else {
      return num.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
    }
  }
  
  return str;
};

const parseDateTimeString = (dateStr: string): string | null => {
  dateStr = dateStr.trim();
  if (!dateStr) return null;

  // 1. Try format YYYY-MM-DD HH:mm or YYYY/MM/DD HH:mm or YYYY-MM-DDTHH:mm
  let match = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+|T)(\d{1,2}):(\d{2})/);
  if (match) {
    const [_, y, m, d, hr, min] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hr.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }

  // 2. Try format YYYY-MM-DD or YYYY/MM/DD
  match = dateStr.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    const [_, y, m, d] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T12:00`; // default to noon
  }

  // 3. Try format DD/MM/YY or DD/MM/YYYY or DD-MM-YY or DD-MM-YYYY (e.g. 20/5/26 or 20/5/2026)
  match = dateStr.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (match) {
    const [_, dStr, mStr, yStr, hrStr, minStr] = match;
    const day = parseInt(dStr);
    const month = parseInt(mStr);
    let year = parseInt(yStr);
    
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      if (year < 100) {
        year += 2000; // e.g. 26 -> 2026
      }
      const hr = hrStr ? hrStr.padStart(2, '0') : "12";
      const min = minStr ? minStr.padStart(2, '0') : "00";
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hr}:${min}`;
    }
  }

  // 4. Try format MM月DD日 or M月D日 or M月D号 (e.g. 6月28日)
  match = dateStr.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (match) {
    const [_, m, d] = match;
    const currentYear = new Date().getFullYear();
    let hr = "12";
    let min = "00";
    const timeMatch = dateStr.match(/(\d{1,2})[:：](\d{2})/);
    if (timeMatch) {
      hr = timeMatch[1].padStart(2, '0');
      min = timeMatch[2];
    } else {
      const timeMatchCN = dateStr.match(/(\d{1,2})\s*点\s*(\d{1,2})?\s*分?/);
      if (timeMatchCN) {
        hr = timeMatchCN[1].padStart(2, '0');
        min = timeMatchCN[2] ? timeMatchCN[2].padStart(2, '0') : "00";
      }
    }
    return `${currentYear}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hr}:${min}`;
  }

  // 5. General fallback: try Date.parse
  const cleanStr = dateStr.replace(/[\u4e00-\u9fa5].*$/, '').trim();
  const timestamp = Date.parse(cleanStr);
  if (!isNaN(timestamp)) {
    const parsedDate = new Date(timestamp);
    return new Date(parsedDate.getTime() - parsedDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  return null;
};

const findMatchingField = (rawKey: string, availableFields: any[]): string => {
  const cleanKey = rawKey.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
  for (const f of availableFields) {
    if (!f.isDynamic) continue;
    const cleanFieldName = f.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
    if (cleanKey.includes(cleanFieldName) || cleanFieldName.includes(cleanKey)) {
      return f.name;
    }
  }
  return rawKey;
};

const parseViewParam = (param: any): string[] => {
  if (!param) return [];
  if (typeof param === "string") {
    const trimmed = param.trim();
    if (trimmed === "all" || trimmed === "undefined" || trimmed === "") {
      return [];
    }
    if (trimmed.startsWith("[")) {
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        return [trimmed];
      }
    }
    return [trimmed];
  }
  if (Array.isArray(param)) {
    return param;
  }
  return [];
};

const getGroupSourceId = (group: any): string | null => {
  if (!group || !group.filterConfig) return null;
  try {
    const cfg = typeof group.filterConfig === "string" ? JSON.parse(group.filterConfig) : group.filterConfig;
    return cfg?.sourceId || null;
  } catch (e) {
    return null;
  }
};

export interface AutomationRule {
  enabled: boolean;
  threshold_hours: number;
  priority_update: {
    enabled: boolean;
    value: "low" | "medium" | "high" | "urgent";
  };
  auto_move: {
    enabled: boolean;
    step_id: string;
  };
  reset_date: boolean;
  show_countdown: boolean;
}

export default function KanbanPage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user && !user.kanbanEnabled) {
      router.replace("/");
    }
  }, [user, authLoading, router]);

  const [steps, setSteps] = useState<Step[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [slaConfig, setSlaConfig] = useState({ idle_hours: 24, expiring_hours: 2, overdue_label: "已逾期" });
  const [companyName, setCompanyName] = useState("CRM 看板");

  // AI 智能看板状态
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiAnalysisTime, setAiAnalysisTime] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState("gemini");
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-pro");
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(`你是一位顶级的私域流量与 WhatsApp 营销专家。
请根据我提供的客户数据（市场分布、标签分布、活动历史）进行深度分析。

【硬性要求】
1. 严禁说任何开场白、客套话或自我介绍（例如“好的”、“我理解了”、“作为专家...”等）。
2. 直接开始输出分析结果！
3. 分析结果必须包含：
   - 数据现状解读
   - 核心问题识别
   - 具体可执行 of the selected campaign contact list
   - 具体可执行的 WhatsApp 营销建议
4. 语言要专业、简练、直击痛点。`);

  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [selectedAiLists, setSelectedAiLists] = useState<string[]>(["市场", "关系"]);
  const [expandedAiList, setExpandedAiList] = useState<string | null>(null);
  const [selectedAiListTags, setSelectedAiListTags] = useState<{[key: string]: string[]}>({});
  const [showAiListSelector, setShowAiListSelector] = useState(false);
  const [availableFilters, setAvailableFilters] = useState<any>({ availableColumns: [] });

  const [loading, setLoading] = useState(true);
  const [viewsLoaded, setViewsLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [dataSources, setDataSources] = useState<any[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const [groups, setGroups] = useState<any[]>([]);
  const [views, setViews] = useState<any[]>([]);
  const [selectedViewId, setSelectedViewId] = useState<string>("all");
  const [activeDays, setActiveDays] = useState<string>("15");
  const [columnLimits, setColumnLimits] = useState<Record<string, number>>({});
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);
  const [whatsappInstances, setWhatsappInstances] = useState<any[]>([]);
  const [activeInstances, setActiveInstances] = useState<string[]>([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [saveViewForm, setSaveViewForm] = useState<{
    id?: string;
    name: string;
    isDefault: boolean;
    isShared: boolean;
    instances: string[];
  }>({
    name: "",
    isDefault: false,
    isShared: false,
    instances: []
  });

  // Card layout customizable states
  const [cardLayout, setCardLayout] = useState<CardLayoutState>({
    global: {
      subtitleField: "phone",
      highlightField: "note",
      tagFields: [],
      detailFields: [],
      aliases: {},
      conditionalStyles: []
    },
    steps: {}
  });
  const [showCardLayoutModal, setShowCardLayoutModal] = useState(false);
  const [layoutModalStepId, setLayoutModalStepId] = useState<string | null>(null);
  const [availableFields, setAvailableFields] = useState<any[]>([]);
  const [loadingFields, setLoadingFields] = useState(false);
  const [layoutForm, setLayoutForm] = useState<CardLayoutConfig>({
    subtitleField: "phone",
    highlightField: "note",
    tagFields: [],
    detailFields: [],
    aliases: {},
    conditionalStyles: []
  });

  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null);

  const startInlineEdit = (e: React.MouseEvent, taskId: string, field: string, value: string, isDynamic: boolean) => {
    e.stopPropagation();
    setInlineEdit({ taskId, field, value, isDynamic });
  };

  const submitInlineEdit = async () => {
    if (!inlineEdit) return;
    const { taskId, field, value, isDynamic } = inlineEdit;
    setInlineEdit(null);

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const props = task.properties || {};
    const oldVal = isDynamic ? props[field] : task[field as keyof Task];
    if (String(oldVal || "") === String(value)) {
      return;
    }

    setSyncing(true);
    try {
      const payload: any = {};
      if (isDynamic) {
        payload.properties = { [field]: value };
      } else {
        payload[field] = value;
      }

      const res = await fetch(`/api/kanban/magic?action=updateTask&taskId=${taskId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setTasks(prev => prev.map(t => {
          if (t.id === taskId) {
            if (isDynamic) {
              return {
                ...t,
                properties: {
                  ...(t.properties || {}),
                  [field]: value
                }
              };
            } else {
              return {
                ...t,
                [field]: value
              };
            }
          }
          return t;
        }));
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`保存失败: ${errData.error || res.statusText || '未知错误'}`);
      }
    } catch (e: any) {
      alert(`网络错误，保存失败: ${e.message || e}`);
    } finally {
      setSyncing(false);
      fetchData();
    }
  };

  const openCardLayoutSettings = async (stepId: string | null) => {
    setLayoutModalStepId(stepId);
    setLoadingFields(true);
    setShowCardLayoutModal(true);

    const currentConfig = stepId 
      ? (cardLayout.steps[stepId] || { subtitleField: "phone", highlightField: "note", tagFields: [], detailFields: [], aliases: {}, conditionalStyles: [] })
      : cardLayout.global;

    setLayoutForm({
      subtitleField: currentConfig.subtitleField || "phone",
      highlightField: currentConfig.highlightField || "note",
      tagFields: currentConfig.tagFields || [],
      detailFields: currentConfig.detailFields || [],
      aliases: currentConfig.aliases || {},
      conditionalStyles: currentConfig.conditionalStyles || []
    });

    try {
      const srcParam = selectedSourceIds.length > 0 ? JSON.stringify(selectedSourceIds) : "all";
      const res = await fetch(`/api/contacts/schema?sourceId=${encodeURIComponent(srcParam)}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setAvailableFields(data.allFields || []);
      }
    } catch (e) {
      console.error("Failed to load schema fields:", e);
    } finally {
      setLoadingFields(false);
    }
  };

  const handleSaveLayout = async (newLayout: CardLayoutState) => {
    setCardLayout(newLayout);
    if (selectedViewId === "all") {
      alert("✓ 已临时应用该卡片布局！若要永久保存，请点击上方的【+】号另存为新视图。");
      return;
    }
    const v = views.find(item => item.id === selectedViewId);
    if (!v) return;

    setSyncing(true);
    try {
      const res = await fetch("/api/kanban/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: v.id,
          name: v.name,
          sourceId: selectedSourceIds.length > 0 ? JSON.stringify(selectedSourceIds) : null,
          groupId: selectedGroupIds.length > 0 ? JSON.stringify(selectedGroupIds) : null,
          hiddenStepIds: hiddenStepIds,
          slaConfig: slaConfig,
          stepsConfig: steps.map(s => ({ id: s.id, name: s.name, color: s.color, order: s.order })),
          cardLayout: newLayout,
          instances: v.instances || [],
          isDefault: v.isDefault,
          isShared: v.isShared
        })
      });
      if (res.ok) {
        alert("✓ 卡片布局设置已保存到当前视图中！");
        const viewsRes = await fetch("/api/kanban/views", { cache: "no-store" });
        if (viewsRes.ok) {
          setViews(await viewsRes.json());
        }
      } else {
        alert("保存失败");
      }
    } catch (e) {
      alert("网络错误，保存卡片布局失败");
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveLayoutForm = (e: React.FormEvent) => {
    e.preventDefault();
    const newLayout = { ...cardLayout };
    if (layoutModalStepId) {
      newLayout.steps = {
        ...newLayout.steps,
        [layoutModalStepId]: layoutForm
      };
    } else {
      newLayout.global = layoutForm;
    }
    handleSaveLayout(newLayout);
    setShowCardLayoutModal(false);
  };

  const resolveCardFields = (task: Task, stepId: string) => {
    const config = (cardLayout.steps && cardLayout.steps[stepId]) 
      ? cardLayout.steps[stepId] 
      : cardLayout.global;

    const props = task.properties || {};

    const getAlias = (field: string) => {
      return (config.aliases && config.aliases[field]) ? config.aliases[field] : field;
    };

    let subtitleText = task.phone;
    let subtitleLabel = "电话";
    if (config.subtitleField && config.subtitleField !== "phone") {
      const fieldVal = props[config.subtitleField] !== undefined ? props[config.subtitleField] : task[config.subtitleField as keyof Task];
      subtitleText = fieldVal !== undefined && fieldVal !== null ? String(fieldVal) : `[无${getAlias(config.subtitleField)}]`;
      subtitleLabel = getAlias(config.subtitleField);
    }

    let highlightText = task.note;
    let highlightLabel = "备注";
    let showHighlight = config.highlightField !== "none";
    if (showHighlight && config.highlightField && config.highlightField !== "note") {
      const fieldVal = props[config.highlightField];
      highlightText = fieldVal !== undefined && fieldVal !== null ? String(fieldVal) : `[无${getAlias(config.highlightField)}]`;
      highlightLabel = getAlias(config.highlightField);
    }

    const customBadges: string[] = [];
    if (config.tagFields && Array.isArray(config.tagFields)) {
      config.tagFields.forEach(field => {
        const val = props[field];
        if (val !== undefined && val !== null && val !== "") {
          customBadges.push(`${getAlias(field)}: ${String(val)}`);
        }
      });
    }

    const detailRows: Array<{ name: string; value: string; rawName: string }> = [];
    if (config.detailFields && Array.isArray(config.detailFields)) {
      config.detailFields.forEach(field => {
        const val = props[field];
        const displayVal = val !== undefined && val !== null && val !== "" ? String(val) : "无";
        detailRows.push({ name: getAlias(field), value: displayVal, rawName: field });
      });
    }

    return {
      subtitleText,
      subtitleLabel,
      highlightText,
      highlightLabel,
      showHighlight,
      customBadges,
      detailRows
    };
  };

  // Drag and drop states
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  // Mobile filter & drag-teleport states
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [teleportTaskId, setTeleportTaskId] = useState<string | null>(null);
  const [showTeleportModal, setShowTeleportModal] = useState(false);

  // Mobile teleport popup timer ref
  const longPressTimer = useRef<any>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (target && !target.closest(".filter-dropdown-container")) {
        setShowFilterDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleToggleSource = (sourceId: string) => {
    const subGroups = groups.filter(g => getGroupSourceId(g) === sourceId);
    const subGroupIds = subGroups.map(g => g.id);

    setSelectedSourceIds(prev => {
      const isChecked = prev.includes(sourceId);
      let nextSources: string[];
      if (isChecked) {
        nextSources = prev.filter(id => id !== sourceId);
        setSelectedGroupIds(grpPrev => grpPrev.filter(id => !subGroupIds.includes(id)));
      } else {
        nextSources = [...prev, sourceId];
        setSelectedGroupIds(grpPrev => {
          const toAdd = subGroupIds.filter(id => !grpPrev.includes(id));
          return [...grpPrev, ...toAdd];
        });
      }
      return nextSources;
    });
  };

  const handleToggleGroup = (groupId: string, parentSourceId: string | null) => {
    setSelectedGroupIds(prev => {
      const isChecked = prev.includes(groupId);
      if (isChecked) {
        return prev.filter(id => id !== groupId);
      } else {
        return [...prev, groupId];
      }
    });
  };

  const handleResetFilters = () => {
    setSelectedSourceIds([]);
    setSelectedGroupIds([]);
  };

  const startMobileDragTimer = (taskId: string) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      setTeleportTaskId(taskId);
      setShowTeleportModal(true);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(40);
      }
    }, 350);
  };

  const cancelMobileDragTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Modal states
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Partial<Task> | null>(null);
  const [taskFormStepId, setTaskFormStepId] = useState("");
  const [smartText, setSmartText] = useState("");

  useEffect(() => {
    if (!showTaskModal) {
      setSmartText("");
    }
  }, [showTaskModal]);
  
  const [showSlaModal, setShowSlaModal] = useState(false);
  const [slaForm, setSlaForm] = useState({ idle_hours: 24, expiring_hours: 2, overdue_label: "已逾期" });

  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");

  const [showStepModal, setShowStepModal] = useState(false);
  const [stepForm, setStepForm] = useState({ id: "", name: "", color: "#3b82f6" });

  // Unified settings & automation modal states
  const [activeSettingsTab, setActiveSettingsTab] = useState<"general" | "automation" | "ai">("general");
  const [settingsModalStepId, setSettingsModalStepId] = useState<string | null>(null);

  // AI settings states inside Kanban board Settings modal
  const [aiSettings, setAiSettings] = useState<any>({
    aiSpeechToTextEnabled: 0,
    aiVisionEnabled: 0,
    aiVisionPrompt: "",
    aiRoutingEnabled: 0,
    aiRoutingConfig: "[]",
    aiNoiseFilterEnabled: 0,
  });
  const [aiRules, setAiRules] = useState<any[]>([]);

  const defaultRules: AutomationRule[] = [
    {
      enabled: false,
      threshold_hours: 24,
      priority_update: { enabled: false, value: "urgent" },
      auto_move: { enabled: false, step_id: "" },
      reset_date: false,
      show_countdown: false
    },
    {
      enabled: false,
      threshold_hours: 48,
      priority_update: { enabled: false, value: "urgent" },
      auto_move: { enabled: false, step_id: "" },
      reset_date: false,
      show_countdown: false
    },
    {
      enabled: false,
      threshold_hours: 72,
      priority_update: { enabled: false, value: "urgent" },
      auto_move: { enabled: false, step_id: "" },
      reset_date: false,
      show_countdown: false
    }
  ];

  const [automationFormRules, setAutomationFormRules] = useState<AutomationRule[]>(defaultRules);
  const [globalAutomationRules, setGlobalAutomationRules] = useState<AutomationRule[]>(defaultRules);

  // Hidden steps state (local hiding)
  const [hiddenStepIds, setHiddenStepIds] = useState<string[]>([]);

  // Search & Locate States
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);

  // Click outside to close search dropdown
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".search-container")) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener("mousedown", handleGlobalClick);
    return () => document.removeEventListener("mousedown", handleGlobalClick);
  }, []);

  const getTagsForList = (listName: string) => {
    if (listName === "市场") return stats?.markets?.map((m: any) => m.name) || [];
    if (listName === "关系") return stats?.tags?.map((t: any) => t.name) || [];
    if (listName === "活动历史") return [];
    
    const uniqueValues = new Set<string>();
    tasks.forEach(t => {
      const props = t.properties;
      if (props && typeof props === 'object' && props[listName]) {
        uniqueValues.add(String(props[listName]));
      }
    });
    return Array.from(uniqueValues);
  };

  const isTagSelected = (listName: string, tag: string) => {
    return selectedAiListTags[listName]?.includes(tag) ?? true;
  };

  const toggleTagSelection = (listName: string, tag: string, checked: boolean) => {
    setSelectedAiListTags(prev => {
      const currentTags = prev[listName] || getTagsForList(listName);
      let nextTags;
      if (checked) {
        nextTags = [...currentTags, tag];
      } else {
        nextTags = currentTags.filter(x => x !== tag);
      }
      return { ...prev, [listName]: nextTags };
    });
  };

  const aiAction = useMemo(() => {
    if (!aiAnalysis) return null;
    const match = aiAnalysis.match(/```json\s*([\s\S]*?)\s*```/);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        return data.action;
      } catch (e) {
        return null;
      }
    }
    return null;
  }, [aiAnalysis]);

  const handleExecAction = async () => {
    if (!aiAction) return;
    setIsExecuting(true);
    try {
      // 1. 创建人群
      const groupRes = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: aiAction.crowdName,
          filterConfig: aiAction.filters
        })
      });
      const groupData = await groupRes.json();
      if (!groupRes.ok) throw new Error(groupData.error || "创建人群失败");
      
      const groupId = groupData.id;
      
      // 2. 创建活动
      const campaignRes = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: aiAction.crowdName + "-活动",
          groupId: groupId,
          materialId: selectedMaterialId ? [selectedMaterialId] : []
        })
      });
      const campaignData = await campaignRes.json();
      if (!campaignRes.ok) throw new Error(campaignData.error || "创建活动失败");
      
      alert("创建成功！已成功创建人群「" + aiAction.crowdName + "」和关联活动！");
      fetchData();
    } catch (e: any) {
      alert("执行失败: " + e.message);
    } finally {
      setIsExecuting(false);
    }
  };

  useEffect(() => {
    const fetchMaterials = async () => {
      try {
        const res = await fetch("/api/materials");
        const data = await res.json();
        if (Array.isArray(data)) {
          setMaterials(data);
        }
      } catch (e) {
        console.error("Failed to fetch materials", e);
      }
    };
    fetchMaterials();
  }, []);

  const handleLocateTask = (taskId: string) => {
    setHighlightedTaskId(taskId);
    setTimeout(() => {
      const el = document.getElementById(`task-card-${taskId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    }, 100);
    setTimeout(() => {
      setHighlightedTaskId(null);
    }, 3000);
  };

  const handleTeleportTask = async (taskId: string, targetStepId: string) => {
    const taskObj = tasks.find(t => t.id === taskId);
    if (!taskObj || taskObj.step_id === targetStepId) return;

    const targetTasks = tasks.filter(t => t.step_id === targetStepId).sort((a, b) => a.order - b.order);
    const maxOrder = targetTasks.length > 0 ? targetTasks[targetTasks.length - 1].order : 0;
    const newOrder = maxOrder + 100;

    // Optimistic UI Update
    setTasks(prev => 
      prev.map(t => t.id === taskId ? { ...t, step_id: targetStepId, order: newOrder, last_activity_at: new Date().toISOString() } : t)
    );
    setSyncing(true);

    try {
      const res = await fetch(`/api/kanban/magic?action=moveCard&taskId=${taskId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board_step_id: targetStepId, new_order: newOrder })
      });
      if (!res.ok) throw new Error();
      fetchData();
      // Locate in new column
      handleLocateTask(taskId);
    } catch {
      fetchData(); // Rollback
    }
  };

  // Fetch all board data
  const fetchData = async (
    sourceIdsToFetch?: string[], 
    groupIdsToFetch?: string[], 
    viewIdToFetch = selectedViewId,
    activeDaysToFetch = activeDays
  ) => {
    try {
      const activeSourceIds = sourceIdsToFetch !== undefined ? sourceIdsToFetch : selectedSourceIds;
      const activeGroupIds = groupIdsToFetch !== undefined ? groupIdsToFetch : selectedGroupIds;

      const excludedGroupIds: string[] = [];
      if (activeSourceIds.length > 0) {
        groups.forEach(g => {
          const sId = getGroupSourceId(g);
          if (sId && activeSourceIds.includes(sId) && !activeGroupIds.includes(g.id)) {
            excludedGroupIds.push(g.id);
          }
        });
      }

      const srcIdParam = activeSourceIds.length > 0 ? JSON.stringify(activeSourceIds) : "all";
      const grpIdParam = activeGroupIds.length > 0 ? JSON.stringify(activeGroupIds) : "all";
      const exclParam = excludedGroupIds.length > 0 ? JSON.stringify(excludedGroupIds) : "";

      const res = await fetch(`/api/kanban/data?sourceId=${encodeURIComponent(srcIdParam)}&groupId=${encodeURIComponent(grpIdParam)}&excludedGroupId=${encodeURIComponent(exclParam)}&viewId=${viewIdToFetch}&activeDays=${activeDaysToFetch}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const board = data[0];

      if (board) {
        setSteps(board.steps || []);
        setTasks(board.tasks || []);
        setCompanyName(board.company_name || "CRM 看板");
        if (board.saved_instances && Array.isArray(board.saved_instances)) {
          setActiveInstances(board.saved_instances);
        } else {
          setActiveInstances([]);
        }
        if (board.sla_config) {
          setSlaConfig(board.sla_config);
          setSlaForm(board.sla_config);
        }
        if (board.automation_config && Array.isArray(board.automation_config) && board.automation_config.length === 3) {
          setGlobalAutomationRules(board.automation_config);
        }
        if (board.saved_hidden_step_ids && Array.isArray(board.saved_hidden_step_ids)) {
          setHiddenStepIds(board.saved_hidden_step_ids);
        }
        if (board.card_layout) {
          const layout = board.card_layout;
          if (layout.global) {
            layout.global.aliases = layout.global.aliases || {};
            layout.global.conditionalStyles = layout.global.conditionalStyles || [];
          }
          if (layout.steps) {
            Object.keys(layout.steps).forEach(k => {
              if (layout.steps[k]) {
                layout.steps[k].aliases = layout.steps[k].aliases || {};
                layout.steps[k].conditionalStyles = layout.steps[k].conditionalStyles || [];
              }
            });
          }
          setCardLayout(layout);
        } else {
          setCardLayout({
            global: { subtitleField: "phone", highlightField: "note", tagFields: [], detailFields: [], aliases: {}, conditionalStyles: [] },
            steps: {}
          });
        }
        
        // Fetch AI metadata
        const filtersRes = await fetch(`/api/contacts/filters?sourceId=${encodeURIComponent(srcIdParam)}`);
        if (filtersRes.ok) {
          setAvailableFilters(await filtersRes.json());
        }
        const sRes = await fetch("/api/settings");
        if (sRes.ok) {
          const sData = await sRes.json();
          if (sData.latestAiAnalysis) setAiAnalysis(sData.latestAiAnalysis);
          if (sData.latestAiAnalysisTime) setAiAnalysisTime(sData.latestAiAnalysisTime);
        }
        const statsRes = await fetch("/api/contacts/stats");
        if (statsRes.ok) {
          const statsData = await statsRes.json();
          setStats(statsData);
          setSelectedAiListTags(prev => {
            if (Object.keys(prev).length === 0) {
              return {
                "市场": statsData.markets.map((m: any) => m.name),
                "关系": statsData.tags.map((t: any) => t.name),
              };
            }
            return prev;
          });
        }

        // Execute lazy-trigger automation checks
        runAutomation(board.tasks || [], board.steps || [], board.automation_config || defaultRules);
      }
    } catch (err) {
      console.error("Failed to load Kanban data:", err);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  const runAutomation = async (currentTasks: Task[], currentSteps: Step[], globalRules: AutomationRule[]) => {
    const now = new Date();
    const actionsToTake: Array<{
      taskId: string;
      type: "priority" | "move" | "reset";
      value?: string;
      stepId?: string;
      reset?: boolean;
    }> = [];

    currentTasks.forEach(task => {
      const step = currentSteps.find(s => s.id === task.step_id);
      if (!step) return;

      if (["回收站", "已闲置", "作废", "已结转", "已流失"].includes(step.name)) return;

      let activeRules: AutomationRule[] | null = null;
      try {
        const localConfig = step.automation_config;
        if (Array.isArray(localConfig) && localConfig.some(r => r.enabled)) {
          activeRules = localConfig;
        }
      } catch {}

      const rules = activeRules || globalRules;
      if (!rules || !Array.isArray(rules) || rules.length === 0) return;

      const refDate = task.last_activity_at ? new Date(task.last_activity_at) : null;
      if (!refDate) return;

      const elapsedHours = (now.getTime() - refDate.getTime()) / (1000 * 60 * 60);
      if (elapsedHours <= 0) return;

      for (let i = 2; i >= 0; i--) {
        const rule = rules[i];
        if (!rule || !rule.enabled || elapsedHours < (rule.threshold_hours || 0)) continue;

        const prioMap = { low: 0, medium: 1, high: 2, urgent: 3 };
        const targetPrio = rule.priority_update?.value || "urgent";
        const prioEnabled = rule.priority_update?.enabled;
        if (prioEnabled && prioMap[targetPrio] > (prioMap[task.priority] || 0)) {
          actionsToTake.push({
            taskId: task.id,
            type: "priority",
            value: targetPrio
          });
        }

        const moveEnabled = rule.auto_move?.enabled;
        const moveValue = rule.auto_move?.step_id;
        const resetEnabled = rule.reset_date;

        if (i === 2 && moveEnabled && moveValue && String(task.step_id) !== String(moveValue)) {
          actionsToTake.push({
            taskId: task.id,
            type: "move",
            stepId: moveValue,
            reset: !!resetEnabled
          });
        }

        if (i >= 1 && resetEnabled && !moveEnabled) {
          actionsToTake.push({
            taskId: task.id,
            type: "reset"
          });
        }

        break;
      }
    });

    if (actionsToTake.length === 0) return;

    const batch = actionsToTake.slice(0, 3);
    let performedAny = false;

    for (const action of batch) {
      try {
        if (action.type === "priority") {
          await fetch(`/api/kanban/magic?action=updateTask&taskId=${action.taskId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ priority: action.value, no_reset: true })
          });
          performedAny = true;
        } else if (action.type === "move") {
          if (action.reset) {
            await fetch(`/api/kanban/magic?action=updateTask&taskId=${action.taskId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ resetActivity: true })
            });
          }
          await fetch(`/api/kanban/magic?action=moveCard&taskId=${action.taskId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ board_step_id: action.stepId, new_order: Date.now() })
          });
          performedAny = true;
        } else if (action.type === "reset") {
          await fetch(`/api/kanban/magic?action=updateTask&taskId=${action.taskId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resetActivity: true })
          });
          performedAny = true;
        }
      } catch (err) {
        console.error("Failed to execute automation action:", err);
      }
    }

    if (performedAny) {
      fetchData();
    }
  };

  const fetchViews = async () => {
    try {
      const res = await fetch("/api/kanban/views", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setViews(data || []);
        
        const defaultView = data.find((v: any) => v.isDefault);
        if (defaultView && selectedViewId === "all") {
          setSelectedViewId(defaultView.id);
          setSelectedSourceIds(parseViewParam(defaultView.sourceId));
          setSelectedGroupIds(parseViewParam(defaultView.groupId));
          setHiddenStepIds(defaultView.hiddenStepIds || []);
          if (defaultView.instances && Array.isArray(defaultView.instances)) {
            setActiveInstances(defaultView.instances);
          } else {
            setActiveInstances([]);
          }
          if (defaultView.slaConfig) {
            setSlaConfig(defaultView.slaConfig);
            setSlaForm(defaultView.slaConfig);
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch Kanban views", e);
    } finally {
      setViewsLoaded(true);
    }
  };

  const handleSelectView = (viewId: string) => {
    setSelectedViewId(viewId);
    if (viewId === "all") {
      setSelectedSourceIds([]);
      setSelectedGroupIds([]);
      setHiddenStepIds([]);
      setCardLayout({
        global: { subtitleField: "phone", highlightField: "note", tagFields: [], detailFields: [], aliases: {}, conditionalStyles: [] },
        steps: {}
      });
      setActiveInstances([]);
      fetchData([], [], "all");
    } else {
      const v = views.find(item => item.id === viewId);
      if (v) {
        const viewSourceIds = parseViewParam(v.sourceId);
        const viewGroupIds = parseViewParam(v.groupId);
        setSelectedSourceIds(viewSourceIds);
        setSelectedGroupIds(viewGroupIds);
        setHiddenStepIds(v.hiddenStepIds || []);
        if (v.instances && Array.isArray(v.instances)) {
          setActiveInstances(v.instances);
        } else {
          setActiveInstances([]);
        }
        if (v.slaConfig) {
          setSlaConfig(v.slaConfig);
          setSlaForm(v.slaConfig);
        }
        if (v.cardLayout) {
          const layout = v.cardLayout;
          if (layout.global) {
            layout.global.aliases = layout.global.aliases || {};
            layout.global.conditionalStyles = layout.global.conditionalStyles || [];
          }
          if (layout.steps) {
            Object.keys(layout.steps).forEach(k => {
              if (layout.steps[k]) {
                layout.steps[k].aliases = layout.steps[k].aliases || {};
                layout.steps[k].conditionalStyles = layout.steps[k].conditionalStyles || [];
              }
            });
          }
          setCardLayout(layout);
        } else {
          setCardLayout({
            global: { subtitleField: "phone", highlightField: "note", tagFields: [], detailFields: [], aliases: {}, conditionalStyles: [] },
            steps: {}
          });
        }
        fetchData(viewSourceIds, viewGroupIds, viewId);
      }
    }
  };

  const handleSaveCurrentView = async () => {
    if (selectedViewId === "all") return;
    const v = views.find(item => item.id === selectedViewId);
    if (!v) return;

    setSyncing(true);
    try {
      const res = await fetch("/api/kanban/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: v.id,
          name: v.name,
          sourceId: selectedSourceIds.length > 0 ? JSON.stringify(selectedSourceIds) : null,
          groupId: selectedGroupIds.length > 0 ? JSON.stringify(selectedGroupIds) : null,
          hiddenStepIds: hiddenStepIds,
          slaConfig: slaConfig,
          stepsConfig: steps.map(s => ({ id: s.id, name: s.name, color: s.color, order: s.order })),
          cardLayout: cardLayout,
          instances: v.instances || [],
          isDefault: v.isDefault,
          isShared: v.isShared
        })
      });
      if (res.ok) {
        alert("✓ 当前看板视图的过滤与列设置已更新保存！");
        const viewsRes = await fetch("/api/kanban/views");
        if (viewsRes.ok) {
          setViews(await viewsRes.json());
        }
      } else {
        alert("保存失败");
      }
    } catch (e) {
      alert("网络错误，保存失败");
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    // Load local hidden steps list
    const stored = localStorage.getItem("crm-hidden-steps");
    if (stored) {
      try {
        setHiddenStepIds(JSON.parse(stored));
      } catch {}
    }
    // Load data sources once
    fetch("/api/data-sources", { cache: "no-store" })
      .then(res => res.json())
      .then(data => setDataSources(data || []))
      .catch(() => {});
    // Load groups once
    fetch("/api/groups", { cache: "no-store" })
      .then(res => res.json())
      .then(data => setGroups(data || []))
      .catch(() => {});
    // Load WhatsApp instances
    fetch("/api/instances", { cache: "no-store" })
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          // Filter out over quota instances
          const valid = data.filter((inst: any) => !inst.isOverQuota);
          setWhatsappInstances(valid);
        }
      })
      .catch((e) => console.error("Failed to load WhatsApp instances:", e));
    // Load Kanban views
    fetchViews();
    // Load contact schema fields for dynamic fields mapping
    fetch("/api/contacts/schema?sourceId=all", { cache: "no-store" })
      .then(res => res.json())
      .then(data => setAvailableFields(data.allFields || []))
      .catch((e) => console.error("Failed to load schema fields:", e));
  }, []);

  const sourceIdsStr = JSON.stringify(selectedSourceIds);
  const groupIdsStr = JSON.stringify(selectedGroupIds);
  useEffect(() => {
    if (!viewsLoaded) return;
    fetchData(selectedSourceIds, selectedGroupIds, selectedViewId, activeDays);
    
    // Auto refresh every 10 seconds (standard heartbeat)
    const interval = setInterval(() => {
      fetchData(selectedSourceIds, selectedGroupIds, selectedViewId, activeDays);
    }, 10000);
    return () => clearInterval(interval);
  }, [sourceIdsStr, groupIdsStr, selectedViewId, activeDays, viewsLoaded]);

  const handleHideStep = (stepId: string) => {
    const updated = [...hiddenStepIds, stepId];
    setHiddenStepIds(updated);
    localStorage.setItem("crm-hidden-steps", JSON.stringify(updated));
  };

  const handleRestoreHiddenSteps = () => {
    if (hiddenStepIds.length === 0) {
      alert("当前没有被隐藏的看板列。您可以点击阶段右上角的隐藏图标来隐藏列。");
      return;
    }
    if (confirm(`您当前有 ${hiddenStepIds.length} 个被隐藏的阶段列，是否要解除隐藏并全部恢复显示？`)) {
      setHiddenStepIds([]);
      localStorage.removeItem("crm-hidden-steps");
    }
  };

  // Card dragging handlers
  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    cancelMobileDragTimer();
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    if (isMobile) {
      e.preventDefault();
      setTeleportTaskId(taskId);
      setShowTeleportModal(true);
      return;
    }
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropOnColumn = async (e: React.DragEvent, targetStepId: string) => {
    e.preventDefault();
    const taskId = draggedTaskId;
    if (!taskId) return;

    // Find the current task
    const taskObj = tasks.find(t => t.id === taskId);
    if (!taskObj) return;

    // Calculate new orderIndex (bottom of target list)
    const targetTasks = tasks.filter(t => t.step_id === targetStepId).sort((a, b) => a.order - b.order);
    const maxOrder = targetTasks.length > 0 ? targetTasks[targetTasks.length - 1].order : 0;
    const newOrder = maxOrder + 100;

    // Optimistic UI Update
    setTasks(prev => 
      prev.map(t => t.id === taskId ? { ...t, step_id: targetStepId, order: newOrder, last_activity_at: new Date().toISOString() } : t)
    );
    setDraggedTaskId(null);
    setSyncing(true);

    try {
      const res = await fetch(`/api/kanban/magic?action=moveCard&taskId=${taskId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board_step_id: targetStepId, new_order: newOrder })
      });
      if (!res.ok) throw new Error();
      fetchData();
    } catch {
      fetchData(); // Rollback
    }
  };

  const handleDropOnCard = async (e: React.DragEvent, targetCardId: string, targetStepId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const taskId = draggedTaskId;
    if (!taskId || taskId === targetCardId) return;

    const stepTasks = tasks.filter(t => t.step_id === targetStepId).sort((a, b) => a.order - b.order);
    const targetIndex = stepTasks.findIndex(t => t.id === targetCardId);
    if (targetIndex === -1) return;

    let newOrder = 0;
    if (targetIndex === 0) {
      newOrder = stepTasks[0].order / 2;
    } else {
      const prevOrder = stepTasks[targetIndex - 1].order;
      const nextOrder = stepTasks[targetIndex].order;
      newOrder = (prevOrder + nextOrder) / 2;
    }

    // Optimistic UI Update
    setTasks(prev => 
      prev.map(t => t.id === taskId ? { ...t, step_id: targetStepId, order: newOrder, last_activity_at: new Date().toISOString() } : t)
    );
    setDraggedTaskId(null);
    setSyncing(true);

    try {
      const res = await fetch(`/api/kanban/magic?action=moveCard&taskId=${taskId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board_step_id: targetStepId, new_order: newOrder })
      });
      if (!res.ok) throw new Error();
      fetchData();
    } catch {
      fetchData(); // Rollback
    }
  };

  // Card modifications
  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask) return;
    setSyncing(true);

    const isEdit = !!editingTask.id;
    const action = isEdit ? "updateTask" : "createTask";
    const taskId = isEdit ? editingTask.id : "";

    const payload = {
      title: editingTask.title,
      phone: editingTask.phone,
      priority: editingTask.priority,
      note: editingTask.note,
      due_date: editingTask.due_date,
      step_id: isEdit ? editingTask.step_id : taskFormStepId,
      properties: editingTask.properties
    };

    try {
      const res = await fetch(`/api/kanban/magic?action=${action}&taskId=${taskId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error();
      setShowTaskModal(false);
      setEditingTask(null);
      fetchData();
    } catch {
      alert("保存失败");
      setSyncing(false);
    }
  };

  const handleSmartIngestionChange = (val: string) => {
    setSmartText(val);
    if (!val.trim()) return;

    const lines = val.split(/\r?\n/);
    let parsedName = "";
    let parsedPhone = "";
    let parsedDueDate = "";
    let newProperties = { ...(editingTask?.properties || {}) };
    const noteLines: string[] = [];

    const nameKeys = ['姓名', 'name', '名字', '联系人', 'customer', 'client'];
    const phoneKeys = ['电话', 'phone', '手机', 'mobile', 'tel', 'whatsapp', '联络方式', '电话号码'];
    const dateKeys = ['预约时间', '下次更进', '最后更进', '下次跟进时间', '跟进时间', '跟进日期', '最后跟进时间', 'meeting time', 'meeting date', 'follow up time', 'next follow up', '预约', '跟进'];

    lines.forEach(line => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return;

      let key = "";
      let value = "";
      const colonIdx = trimmedLine.indexOf(":");
      const colonIdxCN = trimmedLine.indexOf("：");
      let sepIdx = -1;
      if (colonIdx !== -1 && colonIdxCN !== -1) {
        sepIdx = Math.min(colonIdx, colonIdxCN);
      } else if (colonIdx !== -1) {
        sepIdx = colonIdx;
      } else if (colonIdxCN !== -1) {
        sepIdx = colonIdxCN;
      }

      if (sepIdx !== -1) {
        key = trimmedLine.substring(0, sepIdx).trim();
        value = trimmedLine.substring(sepIdx + 1).trim();
      } else {
        const spaceMatch = trimmedLine.match(/^(姓名|Name|名字|电话|Phone|手机|Mobile|Tel|预约时间|下次跟进|最后更进|Meeting time)\s+(.+)$/i);
        if (spaceMatch) {
          key = spaceMatch[1].trim();
          value = spaceMatch[2].trim();
        }
      }

      if (key && value) {
        const lowerKey = key.toLowerCase();
        if (nameKeys.includes(lowerKey) || lowerKey.includes('name') || key.includes('姓名')) {
          parsedName = value;
        } else if (phoneKeys.some(k => lowerKey.includes(k)) || key.includes('电话') || key.includes('手机')) {
          parsedPhone = value.replace(/[^\d+]/g, '');
        } else if (dateKeys.some(k => lowerKey.includes(k)) || key.includes('跟进') || key.includes('预约')) {
          const parsedDate = parseDateTimeString(value);
          if (parsedDate) {
            parsedDueDate = parsedDate;
          } else {
            noteLines.push(line);
          }
        } else {
          const mappedKey = findMatchingField(key, availableFields);
          newProperties[mappedKey] = value;
        }
      } else {
        noteLines.push(line);
      }
    });

    setEditingTask(prev => ({
      ...prev,
      title: parsedName || prev?.title || "",
      phone: parsedPhone || prev?.phone || "",
      due_date: parsedDueDate ? new Date(parsedDueDate).toISOString() : prev?.due_date || null,
      properties: newProperties,
      note: noteLines.join("\n").trim() || prev?.note || ""
    }));
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("确定要永久删除此客户卡片吗？删除后将无法恢复。")) return;
    setSyncing(true);
    try {
      const res = await fetch(`/api/kanban/magic?action=deleteTask&taskId=${taskId}`, {
        method: "POST"
      });
      if (!res.ok) throw new Error();
      fetchData();
    } catch {
      alert("删除失败");
      setSyncing(false);
    }
  };

  const handleTriggerMagicAction = async (taskId: string, actionType: "quote" | "alert") => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/kanban/magic?action=${actionType}&taskId=${taskId}`, {
        method: "POST"
      });
      if (!res.ok) throw new Error();
      fetchData();
    } catch {
      alert("触发失败");
      setSyncing(false);
    }
  };

  // Column modifications
  const handleSaveStep = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncing(true);

    const isEdit = !!stepForm.id;
    const action = isEdit ? "updateStep" : "createStep";

    try {
      const res = await fetch(`/api/kanban/magic?action=${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: stepForm.id,
          name: stepForm.name,
          color: stepForm.color,
          title: stepForm.name // 兼容后端创建
        })
      });
      if (!res.ok) throw new Error();

      // 如果是在特定视图下修改已有步骤，同步更新该视图的 stepsConfig 缓存
      if (isEdit && selectedViewId !== "all") {
        const v = views.find((item: any) => item.id === selectedViewId);
        if (v) {
          const currentStepsConfig = Array.isArray(v.stepsConfig) ? v.stepsConfig : [];
          let updatedStepsConfig = currentStepsConfig.map((s: any) => {
            if (s.id === stepForm.id) {
              return { ...s, name: stepForm.name, color: stepForm.color };
            }
            return s;
          });
          const exists = currentStepsConfig.some((s: any) => s.id === stepForm.id);
          if (!exists) {
            updatedStepsConfig.push({
              id: stepForm.id,
              name: stepForm.name,
              color: stepForm.color,
              order: 0
            });
          }

          await fetch("/api/kanban/views", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: v.id,
              name: v.name,
              sourceId: v.sourceId,
              groupId: v.groupId,
              hiddenStepIds: v.hiddenStepIds || [],
              slaConfig: v.slaConfig,
              stepsConfig: updatedStepsConfig,
              cardLayout: v.cardLayout,
              instances: v.instances || [],
              isDefault: v.isDefault,
              isShared: v.isShared
            })
          });

          const viewsRes = await fetch("/api/kanban/views", { cache: "no-store" });
          if (viewsRes.ok) {
            setViews(await viewsRes.json());
          }
        }
      }

      setShowStepModal(false);
      setStepForm({ id: "", name: "", color: "#3b82f6" });
      fetchData();
    } catch {
      alert("阶段保存失败");
      setSyncing(false);
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!confirm("确定要隐藏/删除该阶段吗？该阶段下的联系人卡片将会被归为空闲状态。")) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/kanban/magic?action=deleteStep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId })
      });
      if (!res.ok) throw new Error();
      fetchData();
    } catch {
      alert("操作失败");
      setSyncing(false);
    }
  };

  // SLA config save
  const handleSaveSla = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncing(true);
    try {
      const res = await fetch("/api/kanban/magic?action=saveSlaConfig", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(slaForm)
      });
      if (!res.ok) throw new Error();
      setShowSlaModal(false);
      fetchData();
    } catch {
      alert("设置保存失败");
      setSyncing(false);
    }
  };

  // Save automation config
  const handleSaveAutomation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncing(true);
    try {
      const res = await fetch("/api/kanban/magic?action=saveAutomationConfig", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId: settingsModalStepId,
          config: automationFormRules
        })
      });
      if (!res.ok) throw new Error();
      
      // Update local state immediately
      if (settingsModalStepId) {
        setSteps(prev => prev.map(s => s.id === settingsModalStepId ? { ...s, automation_config: automationFormRules } : s));
      } else {
        setGlobalAutomationRules(automationFormRules);
      }
      
      setShowSlaModal(false);
      fetchData();
    } catch {
      alert("自动化配置保存失败");
      setSyncing(false);
    }
  };

  // Save AI routing settings from Kanban Settings modal
  const handleSaveAiSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSyncing(true);
    try {
      const payload = {
        ...aiSettings,
        aiRoutingConfig: JSON.stringify(aiRules)
      };
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setShowSlaModal(false);
        fetchData();
        alert("✓ AI 智能路由设置保存成功！");
      } else {
        const err = await res.json();
        alert(err.error || "保存失败");
        setSyncing(false);
      }
    } catch (err: any) {
      alert("网络连接错误，保存失败");
      setSyncing(false);
    }
  };

  // Bulk import
  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importText.trim()) return;

    const rows = importText.split("\n").map(r => r.trim()).filter(r => r);
    const parsedData = rows.map(r => {
      const cols = r.split(/[\t,，]/).map(c => c.trim());
      return {
        name: cols[0] || "未命名客户",
        phone: cols[1] || "",
        note: cols[2] || "",
        priority: cols[3] || "Medium",
        source: cols[4] || "看板导入"
      };
    });

    if (!confirm(`识别到 ${parsedData.length} 条有效数据，确认全部导入首个阶段列吗？`)) return;

    setSyncing(true);
    try {
      const res = await fetch("/api/kanban/magic?action=bulkImport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: parsedData })
      });
      if (!res.ok) throw new Error();
      setImportText("");
      setShowImportModal(false);
      fetchData();
    } catch {
      alert("批量导入失败");
      setSyncing(false);
    }
  };

  // UI calculations
  const totalTasksCount = tasks.length;
  
  // Calculate burning (idle) tasks
  const nowTime = new Date().getTime();
  const idleThresholdMs = slaConfig.idle_hours * 60 * 60 * 1000;
  const burningTasksCount = tasks.filter(t => {
    if (t.due_date && new Date(t.due_date).getTime() < nowTime) return true;
    const activityTime = t.last_activity_at ? new Date(t.last_activity_at).getTime() : nowTime;
    return (nowTime - activityTime) > idleThresholdMs;
  }).length;

  const urgentTasksCount = tasks.filter(t => t.priority === "urgent" || t.priority === "high").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        <span className="ml-2 font-bold text-slate-500">正在构建看板系统...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header Info Area (Full Width) */}
      <div className="flex flex-col gap-2 w-full pb-4 border-b border-slate-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1 
              onClick={handleRestoreHiddenSteps}
              title={hiddenStepIds.length > 0 ? `当前有 ${hiddenStepIds.length} 个被隐藏的阶段列，点击一键恢复！` : "点击可恢复隐藏列"}
              className="text-3xl font-black tracking-tighter text-slate-900 cursor-pointer hover:text-blue-600 transition-colors"
            >
              {companyName}
            </h1>
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold transition-colors ${
              syncing ? "bg-cyan-100 text-cyan-700 animate-pulse" : "bg-green-100 text-green-700"
            }`}>
              {syncing ? "⏳ 云端同步中" : `✅ 数据已同步 (${new Date().toLocaleTimeString("zh-CN", {hour: "2-digit", minute:"2-digit"})})`}
            </span>
          </div>
        </div>
        <p className="text-sm font-bold text-slate-500 mt-1 flex flex-wrap items-center gap-2">
          <span>双层规则机制，静默心跳探测，轻松对流 Notion 客户生命周期。</span>
          {activeInstances.length > 0 ? (
            <span className="text-[10px] text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5 font-bold">
              📥 流入实例: {activeInstances.filter(rawName => typeof rawName === "string" && rawName).map(rawName => {
                const inst = whatsappInstances.find(i => i.rawName === rawName);
                return inst ? inst.displayName : rawName.replace(/^usr_cmc\w+?_/, "");
              }).join(", ")}
            </span>
          ) : (
            <span className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5 font-bold">
              📥 流入实例: 全部实例
            </span>
          )}
        </p>
      </div>

      {/* Desktop Toolbar: Two-row layout */}
      <div className="hidden md:flex flex-col gap-4 w-full bg-slate-50/80 border border-slate-200/80 p-5 rounded-3xl shadow-sm">
        {/* Row 1: Filters & Search */}
        <div className="flex flex-wrap items-center gap-3 w-full search-container relative">
          {/* Kanban View Select */}
          <div className="relative flex items-center gap-1.5">
            <select
              value={selectedViewId}
              onChange={(e) => handleSelectView(e.target.value)}
              className="bg-white border-2 border-slate-200 text-slate-800 font-bold text-xs px-3 py-2.5 rounded-xl outline-none focus:border-blue-600 cursor-pointer shadow-sm max-w-[160px] xs:max-w-[200px] truncate"
            >
              <option value="all">📋 默认看板</option>
              {views.map(v => (
                <option key={v.id} value={v.id}>
                  {v.isDefault ? "⭐ " : "📌 "}{v.name} {v.isShared ? "(共享)" : ""}
                </option>
              ))}
            </select>
            {selectedViewId !== "all" && (
              <>
                <button
                  onClick={handleSaveCurrentView}
                  className="p-2.5 bg-white border-2 border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-500 rounded-xl transition-colors shadow-sm"
                  title="保存当前过滤与列属性设置"
                >
                  <Save className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    const v = views.find(item => item.id === selectedViewId);
                    if (v) {
                      setSaveViewForm({
                        id: v.id,
                        name: v.name,
                        isDefault: v.isDefault || false,
                        isShared: v.isShared || false,
                        instances: v.instances || []
                      });
                      setIsEditMode(true);
                      setShowSaveViewModal(true);
                    }
                  }}
                  className="p-2.5 bg-white border-2 border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-500 rounded-xl transition-colors shadow-sm"
                  title="修改看板视图属性"
                >
                  <Settings2 className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              onClick={() => {
                setSaveViewForm({ name: "", isDefault: false, isShared: false, instances: [] });
                setIsEditMode(false);
                setShowSaveViewModal(true);
              }}
              className="p-2.5 bg-white border-2 border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-500 rounded-xl transition-colors shadow-sm"
              title="另存为新视图"
            >
              <Plus className="w-4 h-4" />
            </button>
            {selectedViewId !== "all" && (
              <button
                onClick={async () => {
                  if (confirm("确定要删除此看板视图吗？这将只删除保存的配置，不会影响任何联系人数据。")) {
                    setSyncing(true);
                    try {
                      const res = await fetch(`/api/kanban/views?id=${selectedViewId}`, { method: "DELETE" });
                      if (res.ok) {
                        alert("✓ 视图已成功删除！");
                        setSelectedViewId("all");
                        setSelectedSourceIds([]);
                        setSelectedGroupIds([]);
                        setHiddenStepIds([]);
                        const viewsRes = await fetch("/api/kanban/views");
                        if (viewsRes.ok) {
                          setViews(await viewsRes.json());
                        }
                      } else {
                        alert("删除失败");
                      }
                    } catch (e) {
                      alert("网络错误，删除失败");
                    } finally {
                      setSyncing(false);
                    }
                  }
                }}
                className="p-2.5 bg-white border-2 border-slate-200 text-slate-600 hover:text-red-600 hover:border-red-500 rounded-xl transition-colors shadow-sm"
                title="删除当前视图"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[240px] flex-1 max-w-xs">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchResults(true);
              }}
              onFocus={() => setShowSearchResults(true)}
              placeholder="搜索客户姓名/电话..."
              className="pl-9 pr-8 py-2.5 w-full bg-white border-2 border-slate-200 text-slate-900 rounded-xl text-xs font-bold focus:border-blue-600 focus:bg-white outline-none placeholder-slate-400 shadow-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setShowSearchResults(false);
                }}
                className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}

            {/* Search Results Dropdown */}
            {showSearchResults && searchQuery && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 p-2 max-h-[300px] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-150" style={{ colorScheme: 'light' }}>
                <div className="flex justify-between items-center px-2 py-1.5 border-b border-slate-100 mb-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">搜索结果</span>
                  <button type="button" onClick={() => setShowSearchResults(false)} className="text-[10px] text-blue-600 hover:underline font-bold">关闭</button>
                </div>
                {tasks.filter(t => 
                  t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (t.phone && t.phone.includes(searchQuery))
                ).length === 0 ? (
                  <div className="text-xs text-slate-400 p-4 text-center font-bold">未找到匹配客户</div>
                ) : (
                  tasks
                    .filter(t => 
                      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      (t.phone && t.phone.includes(searchQuery))
                    )
                    .map(task => {
                      const currentStep = steps.find(s => s.id === task.step_id);
                      return (
                        <div key={task.id} className="p-2 hover:bg-slate-50 rounded-xl flex items-center justify-between gap-2 border-b border-slate-50 last:border-b-0">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-slate-900 truncate">{task.title}</div>
                            {task.phone && (
                              <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                                <a 
                                  href={`tel:${task.phone.replace(/[^\d+]/g, '')}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="font-mono text-slate-500 hover:text-blue-600 transition-colors"
                                  title="拨打电话"
                                >
                                  {task.phone}
                                </a>
                                <a 
                                  href={`https://wa.me/${task.phone.replace(/[^\d]/g, '')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-1 py-0.2 rounded text-[8px] font-black transition-colors"
                                  title="在 WhatsApp 中聊天"
                                >
                                  WA
                                </a>
                              </div>
                            )}
                            <div className="text-[9px] mt-1 inline-flex items-center px-1.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600">
                              列: {currentStep?.name || "未知"}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                handleLocateTask(task.id);
                                setShowSearchResults(false);
                              }}
                              className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-lg font-black hover:bg-blue-100 transition-colors"
                            >
                              定位
                            </button>
                            <select
                              value={task.step_id}
                              onChange={(e) => handleTeleportTask(task.id, e.target.value)}
                              className="text-[10px] bg-slate-100 text-slate-800 border-0 rounded-lg px-1.5 py-1 font-bold outline-none cursor-pointer max-w-[85px] hover:bg-slate-200 transition-colors"
                            >
                              {steps.map(s => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            )}
          </div>

          {/* 级联树形多选下拉选择器 */}
          <div className="filter-dropdown-container relative">
            <button
              type="button"
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="flex items-center gap-1.5 bg-white border-2 border-slate-200 hover:border-slate-300 text-slate-800 font-bold text-xs px-3 py-2.5 rounded-xl shadow-sm transition-all outline-none"
            >
              {selectedSourceIds.length === 0 && selectedGroupIds.length === 0 ? (
                <>🌐 所有数据源与群组</>
              ) : (
                <>
                  🔍 已选: {selectedSourceIds.length}源 / {selectedGroupIds.length}群组
                </>
              )}
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            </button>

            {showFilterDropdown && (
              <div 
                className="absolute left-0 mt-2 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-4 max-h-[450px] overflow-y-auto animate-in fade-in slide-in-from-top-2 duration-200" 
                style={{ colorScheme: "light" }}
              >
                {/* 顶部操作栏 */}
                <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                  <span className="text-xs font-black text-slate-800 uppercase tracking-wider">数据过滤设置</span>
                  <button 
                    type="button" 
                    onClick={handleResetFilters}
                    className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-2 py-1 rounded-lg transition-colors"
                  >
                    重置为全量
                  </button>
                </div>

                {/* 筛选逻辑说明 */}
                <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3 text-[11px] text-slate-600 leading-relaxed space-y-1.5">
                  <div className="font-bold text-slate-900 flex items-center gap-1">
                    <span className="text-xs">💡 筛选与人数计算规则：</span>
                  </div>
                  <ul className="list-disc pl-3.5 space-y-1 text-slate-500">
                    <li>
                      <span className="font-semibold text-slate-700">时效限制</span>：默认仅展示<span className="font-semibold text-slate-700 font-mono">近 15 天</span>活跃的联系人。若勾选后人数不对，请尝试在时效下拉框中更改为<span className="text-blue-600 font-semibold">“全部时间”</span>。
                    </li>
                    <li>
                      <span className="font-semibold text-slate-700">勾选父数据源</span>：加载该源的全部联系人。此时，该源下<span className="text-red-500 font-semibold">未勾选</span>的人群包会被视作“排除项”进行扣除。
                    </li>
                    <li>
                      <span className="font-semibold text-slate-700">只勾选子人群包</span>：不勾选父数据源，此时只加载被勾选人群包中的联系人（并集叠加）。
                    </li>
                  </ul>
                </div>

                {/* 树形列表内容 */}
                <div className="space-y-4">
                  {/* Notion 数据源 */}
                  {dataSources.filter(ds => ds.type === "NOTION").length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Notion 数据库</div>
                      {dataSources.filter(ds => ds.type === "NOTION").map(ds => {
                        const dsGroups = groups.filter(g => getGroupSourceId(g) === ds.id);
                        const isSourceChecked = selectedSourceIds.includes(ds.id);
                        return (
                          <div key={ds.id} className="space-y-1.5 pl-1">
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer hover:text-slate-900 select-none">
                              <input 
                                type="checkbox" 
                                checked={isSourceChecked}
                                onChange={() => handleToggleSource(ds.id)}
                                className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                              />
                              <span>🇸🇬 {ds.name}</span>
                            </label>
                            {/* 子群组 */}
                            {dsGroups.length > 0 && (
                              <div className="pl-5 border-l border-slate-100 space-y-1 mt-1">
                                {dsGroups.map(g => {
                                  const isGroupChecked = selectedGroupIds.includes(g.id);
                                  return (
                                    <label key={g.id} className="flex items-center gap-2 text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer select-none py-0.5">
                                      <input 
                                        type="checkbox" 
                                        checked={isGroupChecked}
                                        onChange={() => handleToggleGroup(g.id, ds.id)}
                                        className="w-3 h-3 rounded text-blue-500 focus:ring-blue-400 border-slate-300 cursor-pointer"
                                      />
                                      <span>🎯 {g.name}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Excel 数据源 */}
                  {dataSources.filter(ds => ds.type === "EXCEL").length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Excel 导入文件</div>
                      {dataSources.filter(ds => ds.type === "EXCEL").map(ds => {
                        const dsGroups = groups.filter(g => getGroupSourceId(g) === ds.id);
                        const isSourceChecked = selectedSourceIds.includes(ds.id);
                        return (
                          <div key={ds.id} className="space-y-1.5 pl-1">
                            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer hover:text-slate-900 select-none">
                              <input 
                                type="checkbox" 
                                checked={isSourceChecked}
                                onChange={() => handleToggleSource(ds.id)}
                                className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                              />
                              <span>📁 {ds.name}</span>
                            </label>
                            {/* 子群组 */}
                            {dsGroups.length > 0 && (
                              <div className="pl-5 border-l border-slate-100 space-y-1 mt-1">
                                {dsGroups.map(g => {
                                  const isGroupChecked = selectedGroupIds.includes(g.id);
                                  return (
                                    <label key={g.id} className="flex items-center gap-2 text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer select-none py-0.5">
                                      <input 
                                        type="checkbox" 
                                        checked={isGroupChecked}
                                        onChange={() => handleToggleGroup(g.id, ds.id)}
                                        className="w-3 h-3 rounded text-blue-500 focus:ring-blue-400 border-slate-300 cursor-pointer"
                                      />
                                      <span>🎯 {g.name}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 公共群组 */}
                  {groups.filter(g => !getGroupSourceId(g)).length > 0 && (
                    <div className="space-y-2">
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">公共人群包</div>
                      <div className="space-y-1.5 pl-1">
                        {groups.filter(g => !getGroupSourceId(g)).map(g => {
                          const isGroupChecked = selectedGroupIds.includes(g.id);
                          return (
                            <label key={g.id} className="flex items-center gap-2 text-xs font-bold text-slate-700 hover:text-slate-900 cursor-pointer select-none">
                              <input 
                                type="checkbox" 
                                checked={isGroupChecked}
                                onChange={() => handleToggleGroup(g.id, null)}
                                className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                              />
                              <span>👥 {g.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 时效筛选 */}
          <div className="relative flex items-center gap-1.5">
            <select
              value={activeDays}
              onChange={(e) => setActiveDays(e.target.value)}
              className="bg-white border-2 border-slate-200 text-slate-800 font-bold text-xs px-3 py-2.5 rounded-xl outline-none focus:border-blue-600 cursor-pointer shadow-sm"
            >
              <option value="3">🕒 近 3 天活跃</option>
              <option value="7">🕒 近 7 天活跃</option>
              <option value="15">🕒 近 15 天活跃</option>
              <option value="all">🌐 全部数据 (超多数据警告)</option>
            </select>
            {activeDays === "all" && (
              <span className="text-[10px] text-amber-500 font-black animate-pulse" title="全部数据模式下自动启用极简卡片">
                ⚠️ 极简模式
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 w-full border-t border-slate-200/80 pt-3.5">
          <button
            onClick={() => {
              setStepForm({ id: "", name: "", color: "#3b82f6" });
              setShowStepModal(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white border-2 border-slate-200 text-slate-700 hover:text-slate-900 rounded-xl text-xs font-black hover:border-slate-400 shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5 text-blue-500" />
            新增看板阶段
          </button>
          
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white border-2 border-slate-200 text-slate-700 hover:text-slate-900 rounded-xl text-xs font-black hover:border-slate-400 shadow-sm transition-all"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
            批量导入
          </button>

          <button
            onClick={() => openCardLayoutSettings(null)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-white border-2 border-slate-200 text-slate-700 hover:text-slate-900 rounded-xl text-xs font-black hover:border-slate-400 shadow-sm transition-all"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500" />
            全局卡片显示
          </button>

          <button
            onClick={() => setShowAiPanel(!showAiPanel)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-black border-2 shadow-sm transition-all ${
              showAiPanel 
                ? "bg-purple-600 text-white border-purple-400" 
                : "bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100"
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            AI 智能看板
          </button>

          <button
            onClick={async () => {
              setSettingsModalStepId(null);
              setAutomationFormRules(globalAutomationRules);
              setActiveSettingsTab("general");
              setShowSlaModal(true);
              
              // 异步加载 AI 设置
              try {
                const res = await fetch("/api/settings");
                if (res.ok) {
                  const sData = await res.json();
                  setAiSettings({
                    aiSpeechToTextEnabled: sData.aiSpeechToTextEnabled,
                    aiVisionEnabled: sData.aiVisionEnabled,
                    aiVisionPrompt: sData.aiVisionPrompt,
                    aiRoutingEnabled: sData.aiRoutingEnabled,
                    aiRoutingConfig: sData.aiRoutingConfig,
                    aiNoiseFilterEnabled: sData.aiNoiseFilterEnabled,
                  });
                  if (sData.aiRoutingConfig) {
                    setAiRules(JSON.parse(sData.aiRoutingConfig));
                  } else {
                    setAiRules([]);
                  }
                }
              } catch (e) {
                console.error("Failed to load AI settings in Kanban:", e);
              }
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-950 text-white rounded-xl text-xs font-black md:hover:bg-slate-800 shadow-md transition-all ml-auto"
          >
            <Settings2 className="w-3.5 h-3.5" />
            系统设置
          </button>
        </div>
      </div>

      {/* Mobile Toolbar */}
      <div className="md:hidden flex flex-col gap-2.5 w-full bg-slate-50/80 border border-slate-200/80 p-4 rounded-3xl shadow-sm">
        {/* Top bar: View Selector & Toggle */}
        <div className="flex items-center gap-2 justify-between w-full">
          <select
            value={selectedViewId}
            onChange={(e) => handleSelectView(e.target.value)}
            className="bg-white border-2 border-slate-200 text-slate-800 font-bold text-xs px-3 py-2 rounded-xl outline-none focus:border-blue-600 cursor-pointer shadow-sm flex-1 truncate"
          >
            <option value="all">📋 默认看板</option>
            {views.map(v => (
              <option key={v.id} value={v.id}>
                {v.isDefault ? "⭐ " : "📌 "}{v.name} {v.isShared ? "(共享)" : ""}
              </option>
            ))}
          </select>

          <button
            onClick={() => setShowMobileFilters(!showMobileFilters)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border-2 border-slate-200 text-slate-700 hover:text-blue-600 rounded-xl text-xs font-black shadow-sm transition-all"
          >
            <SlidersHorizontal className={`w-3.5 h-3.5 ${showMobileFilters ? "text-blue-600" : "text-slate-500"}`} />
            <span>{showMobileFilters ? "收起筛选" : "高级筛选"}</span>
          </button>
        </div>

        {/* Search Box */}
        <div className="relative w-full">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-slate-400" />
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => setShowSearchResults(true)}
            placeholder="搜索客户姓名/电话..."
            className="pl-9 pr-8 py-2 w-full bg-white border-2 border-slate-200 text-slate-900 rounded-xl text-xs font-bold focus:border-blue-600 focus:bg-white outline-none placeholder-slate-400 shadow-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setShowSearchResults(false);
              }}
              className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {/* Search Results Dropdown inside Mobile view */}
          {showSearchResults && searchQuery && (
            <div className="absolute left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 p-2 max-h-[250px] overflow-y-auto" style={{ colorScheme: 'light' }}>
              <div className="flex justify-between items-center px-2 py-1.5 border-b border-slate-100 mb-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">搜索结果</span>
                <button type="button" onClick={() => setShowSearchResults(false)} className="text-[10px] text-blue-600 hover:underline font-bold">关闭</button>
              </div>
              {tasks.filter(t => 
                t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (t.phone && t.phone.includes(searchQuery))
              ).length === 0 ? (
                <div className="text-xs text-slate-400 p-4 text-center font-bold">未找到匹配客户</div>
              ) : (
                tasks
                  .filter(t => 
                    t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (t.phone && t.phone.includes(searchQuery))
                  )
                  .map(task => {
                    const currentStep = steps.find(s => s.id === task.step_id);
                    return (
                      <div key={task.id} className="p-2 hover:bg-slate-50 rounded-xl flex items-center justify-between gap-2 border-b border-slate-50 last:border-b-0">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-900 truncate">{task.title}</div>
                          {task.phone && (
                            <div className="text-[10px] text-slate-500 font-mono mt-0.5">{task.phone}</div>
                          )}
                          <div className="text-[9px] mt-1 inline-flex items-center px-1.5 py-0.5 rounded-full font-bold bg-slate-100 text-slate-600">
                            列: {currentStep?.name || "未知"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              handleLocateTask(task.id);
                              setShowSearchResults(false);
                            }}
                            className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-lg font-black hover:bg-blue-100 transition-colors"
                          >
                            定位
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          )}
        </div>

        {/* Mobile Collapsible Advanced Filters and Action Center */}
        {showMobileFilters && (
          <div className="bg-slate-100/60 border border-slate-200/40 rounded-2xl p-3 space-y-3 mt-1.5 animate-in fade-in slide-in-from-top-2 duration-200" style={{ colorScheme: 'light' }}>
            <div className="grid grid-cols-2 gap-2.5">
              {/* 级联树形多选下拉选择器 (移动端) */}
              <div className="filter-dropdown-container flex flex-col gap-1 col-span-2 relative">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider">数据源与群组过滤</label>
                <button
                  type="button"
                  onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                  className="w-full flex items-center justify-between bg-white border-2 border-slate-200 text-slate-800 font-bold text-xs px-2.5 py-2 rounded-xl outline-none shadow-sm cursor-pointer"
                >
                  <span className="truncate">
                    {selectedSourceIds.length === 0 && selectedGroupIds.length === 0 ? (
                      <>🌐 所有数据源与群组</>
                    ) : (
                      <>
                        🔍 已选: {selectedSourceIds.length}源 / {selectedGroupIds.length}群组
                      </>
                    )}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                </button>

                {showFilterDropdown && (
                  <div 
                    className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-4 space-y-4 max-h-[350px] overflow-y-auto" 
                    style={{ colorScheme: "light" }}
                  >
                    {/* 顶部操作栏 */}
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                      <span className="text-xs font-black text-slate-800 uppercase tracking-wider">数据过滤设置</span>
                      <button 
                        type="button" 
                        onClick={handleResetFilters}
                        className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-2 py-1 rounded-lg transition-colors"
                      >
                        重置为全量
                      </button>
                    </div>

                    {/* 筛选逻辑说明 */}
                    <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-3 text-[11px] text-slate-600 leading-relaxed space-y-1.5">
                      <div className="font-bold text-slate-900 flex items-center gap-1">
                        <span className="text-xs">💡 筛选与人数计算规则：</span>
                      </div>
                      <ul className="list-disc pl-3.5 space-y-1 text-slate-500">
                        <li>
                          <span className="font-semibold text-slate-700">时效限制</span>：默认仅展示<span className="font-semibold text-slate-700 font-mono">近 15 天</span>活跃的联系人。若勾选后人数不对，请尝试在时效下拉框中更改为<span className="text-blue-600 font-semibold">“全部时间”</span>。
                        </li>
                        <li>
                          <span className="font-semibold text-slate-700">勾选父数据源</span>：加载该源的全部联系人。此时，该源下<span className="text-red-500 font-semibold">未勾选</span>的人群包会被视作“排除项”进行扣除。
                        </li>
                        <li>
                          <span className="font-semibold text-slate-700">只勾选子人群包</span>：不勾选父数据源，此时只加载被勾选人群包中的联系人（并集叠加）。
                        </li>
                      </ul>
                    </div>

                    {/* 树形列表内容 */}
                    <div className="space-y-4">
                      {/* Notion 数据源 */}
                      {dataSources.filter(ds => ds.type === "NOTION").length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Notion 数据库</div>
                          {dataSources.filter(ds => ds.type === "NOTION").map(ds => {
                            const dsGroups = groups.filter(g => getGroupSourceId(g) === ds.id);
                            const isSourceChecked = selectedSourceIds.includes(ds.id);
                            return (
                              <div key={ds.id} className="space-y-1.5 pl-1">
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer hover:text-slate-900 select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={isSourceChecked}
                                    onChange={() => handleToggleSource(ds.id)}
                                    className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                                  />
                                  <span>🇸🇬 {ds.name}</span>
                                </label>
                                {/* 子群组 */}
                                {dsGroups.length > 0 && (
                                  <div className="pl-5 border-l border-slate-100 space-y-1 mt-1">
                                    {dsGroups.map(g => {
                                      const isGroupChecked = selectedGroupIds.includes(g.id);
                                      return (
                                        <label key={g.id} className="flex items-center gap-2 text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer select-none py-0.5">
                                          <input 
                                            type="checkbox" 
                                            checked={isGroupChecked}
                                            onChange={() => handleToggleGroup(g.id, ds.id)}
                                            className="w-3 h-3 rounded text-blue-500 focus:ring-blue-400 border-slate-300 cursor-pointer"
                                          />
                                          <span>🎯 {g.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Excel 数据源 */}
                      {dataSources.filter(ds => ds.type === "EXCEL").length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Excel 导入文件</div>
                          {dataSources.filter(ds => ds.type === "EXCEL").map(ds => {
                            const dsGroups = groups.filter(g => getGroupSourceId(g) === ds.id);
                            const isSourceChecked = selectedSourceIds.includes(ds.id);
                            return (
                              <div key={ds.id} className="space-y-1.5 pl-1">
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer hover:text-slate-900 select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={isSourceChecked}
                                    onChange={() => handleToggleSource(ds.id)}
                                    className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                                  />
                                  <span>📁 {ds.name}</span>
                                </label>
                                {/* 子群组 */}
                                {dsGroups.length > 0 && (
                                  <div className="pl-5 border-l border-slate-100 space-y-1 mt-1">
                                    {dsGroups.map(g => {
                                      const isGroupChecked = selectedGroupIds.includes(g.id);
                                      return (
                                        <label key={g.id} className="flex items-center gap-2 text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer select-none py-0.5">
                                          <input 
                                            type="checkbox" 
                                            checked={isGroupChecked}
                                            onChange={() => handleToggleGroup(g.id, ds.id)}
                                            className="w-3.5 h-3.5 rounded text-blue-500 focus:ring-blue-400 border-slate-300 cursor-pointer"
                                          />
                                          <span>🎯 {g.name}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* 公共群组 */}
                      {groups.filter(g => !getGroupSourceId(g)).length > 0 && (
                        <div className="space-y-2">
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider">公共人群包</div>
                          <div className="space-y-1.5 pl-1">
                            {groups.filter(g => !getGroupSourceId(g)).map(g => {
                              const isGroupChecked = selectedGroupIds.includes(g.id);
                              return (
                                <label key={g.id} className="flex items-center gap-2 text-xs font-bold text-slate-700 hover:text-slate-900 cursor-pointer select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={isGroupChecked}
                                    onChange={() => handleToggleGroup(g.id, null)}
                                    className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                                  />
                                  <span>👥 {g.name}</span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 时效筛选 */}
              <div className="flex flex-col gap-1 col-span-2">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider">时效筛选</label>
                <div className="flex items-center gap-2">
                  <select
                    value={activeDays}
                    onChange={(e) => setActiveDays(e.target.value)}
                    className="flex-1 bg-white border-2 border-slate-200 text-slate-800 font-bold text-xs px-2.5 py-2 rounded-xl outline-none focus:border-blue-600 cursor-pointer shadow-sm"
                  >
                    <option value="3">🕒 近 3 天活跃</option>
                    <option value="7">🕒 近 7 天活跃</option>
                    <option value="15">🕒 近 15 天活跃</option>
                    <option value="all">🌐 全部数据 (超多数据警告)</option>
                  </select>
                  {activeDays === "all" && (
                    <span className="text-[10px] text-amber-500 font-black shrink-0 animate-pulse">
                      ⚠️ 极简模式
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Action buttons on mobile */}
            <div className="border-t border-slate-200/80 pt-2.5">
              <label className="text-[9px] font-black text-slate-500 uppercase tracking-wider mb-1.5 block">快捷操作</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    setStepForm({ id: "", name: "", color: "#3b82f6" });
                    setShowStepModal(true);
                  }}
                  className="flex items-center justify-center gap-1 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-[11px] font-black shadow-sm"
                >
                  <Plus className="w-3 h-3 text-blue-500" />
                  新增阶段
                </button>

                <button
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center justify-center gap-1 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-[11px] font-black shadow-sm"
                >
                  <FileSpreadsheet className="w-3 h-3 text-emerald-500" />
                  批量导入
                </button>

                <button
                  onClick={() => openCardLayoutSettings(null)}
                  className="flex items-center justify-center gap-1 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-[11px] font-black shadow-sm"
                >
                  <SlidersHorizontal className="w-3 h-3 text-indigo-500" />
                  卡片显示
                </button>

                <button
                  onClick={() => setShowAiPanel(!showAiPanel)}
                  className={`flex items-center justify-center gap-1 py-2 rounded-xl text-[11px] font-black shadow-sm border transition-all ${
                    showAiPanel 
                      ? "bg-purple-600 border-purple-600 text-white" 
                      : "bg-purple-50 border-purple-100 text-purple-600"
                  }`}
                >
                  <BarChart2 className="w-3 h-3" />
                  AI 看板
                </button>

                <button
                  onClick={() => {
                    setSettingsModalStepId(null);
                    setAutomationFormRules(globalAutomationRules);
                    setActiveSettingsTab("general");
                    setShowSlaModal(true);
                  }}
                  className="flex items-center justify-center gap-1 py-2 bg-slate-900 border border-slate-900 text-white rounded-xl text-[11px] font-black shadow-sm col-span-2"
                >
                  <Settings2 className="w-3 h-3 text-cyan-400" />
                  系统通用设置
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AI 智能看板面板 */}
      {showAiPanel && (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-4 md:p-6 rounded-3xl border-2 border-purple-100 shadow-lg animate-in slide-in-from-top duration-300 space-y-4">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-3 border-b border-purple-100/80">
            <h3 className="font-black text-purple-900 text-lg flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
              <BarChart2 className="w-5 h-5 text-purple-600" /> AI 智能营销顾问
            </h3>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full lg:w-auto">
              <div className="flex gap-2 w-full sm:w-auto">
                <select
                  value={selectedBrand}
                  onChange={(e) => {
                    setSelectedBrand(e.target.value);
                    if (e.target.value === "gemini") setSelectedModel("gemini-2.5-pro");
                    else if (e.target.value === "openai") setSelectedModel("gpt-4o");
                    else if (e.target.value === "deepseek") setSelectedModel("deepseek-reasoner");
                  }}
                  className="bg-white border border-purple-200 rounded-xl px-3 py-2 text-sm text-purple-900 focus:ring-1 focus:ring-purple-500 outline-none w-[100px] flex-shrink-0 shadow-sm"
                >
                  <option value="gemini">Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="deepseek">DeepSeek</option>
                </select>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-white border border-purple-200 rounded-xl px-3 py-2 text-sm text-purple-900 focus:ring-1 focus:ring-purple-500 outline-none flex-1 min-w-0 max-w-full sm:w-[240px] truncate shadow-sm"
                >
                  {selectedBrand === "gemini" && (
                    <>
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash (快速版 - API有免费额度/低成本)</option>
                      <option value="gemini-2.5-pro">Gemini 2.5 Pro (专业版 - API有免费额度/强推理)</option>
                      <option value="gemini-1.5-pro">Gemini 1.5 Pro (200万超长上下文)</option>
                      <option value="gemini-3.0-flash">Gemini 3.0 Flash (2026最新快速版)</option>
                      <option value="gemini-3.0-pro">Gemini 3.0 Pro (2026最新专业版)</option>
                    </>
                  )}
                  {selectedBrand === "openai" && (
                    <>
                      <option value="gpt-4o">GPT-4o (旗舰多模态 - 智能度高/全能)</option>
                      <option value="gpt-4o-mini">GPT-4o-mini (性价比王 - 极快/超低成本)</option>
                      <option value="o1-preview">o1-preview (强推理 - 适合复杂逻辑思考)</option>
                      <option value="o1-mini">o1-mini (轻量推理 - 适合代码/结构化输出)</option>
                    </>
                  )}
                  {selectedBrand === "deepseek" && (
                    <>
                      <option value="deepseek-chat">DeepSeek-V3 (通用对话 - 极低成本/高智商)</option>
                      <option value="deepseek-reasoner">DeepSeek-R1 (推理版 - 强逻辑/深度思考)</option>
                    </>
                  )}
                </select>
              </div>

              <div className="flex gap-2 w-full sm:w-auto justify-end">
                <button
                  onClick={() => setShowPromptEditor(!showPromptEditor)}
                  className={`p-2.5 border rounded-xl transition-all shadow-sm flex-shrink-0 ${showPromptEditor ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-white border-purple-200 text-purple-600 hover:bg-purple-50'}`}
                  title="修改 AI 提示词"
                >
                  <Settings2 className="w-4 h-4" />
                </button>

                <button 
                  onClick={async () => {
                    setIsAnalyzing(true);
                    try {
                      const res = await fetch("/api/contacts/ai-analyze", { 
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ 
                          selectedBrand, 
                          selectedModel, 
                          customPrompt,
                          useMarketData: selectedAiLists.includes("市场"),
                          useTagData: selectedAiLists.includes("关系"),
                          useCampaignData: selectedAiLists.includes("活动历史"),
                          markets: selectedAiLists.includes("市场") 
                            ? stats?.markets.filter((m: any) => (selectedAiListTags["市场"] || getTagsForList("市场")).includes(m.name)).map((m: any) => `${m.name}: ${m.count}人`) 
                            : [],
                          tags: selectedAiLists.includes("关系") 
                            ? stats?.tags.filter((t: any) => (selectedAiListTags["关系"] || getTagsForList("关系")).includes(t.name)).map((t: any) => `${t.name}: ${t.count}人`) 
                            : [],
                          dynamicColumns: selectedAiLists
                            .filter(l => l !== "市场" && l !== "关系" && l !== "活动历史")
                            .map(l => ({
                              name: l,
                              values: selectedAiListTags[l] || getTagsForList(l)
                            }))
                        })
                      });
                      const data = await res.json();
                      if (res.ok) {
                        setAiAnalysis(data.analysis);
                        setAiAnalysisTime(new Date().toISOString());
                      } else {
                        alert("分析失败: " + data.error);
                      }
                    } catch (e: any) {
                      alert("分析失败: " + e.message);
                    } finally { setIsAnalyzing(false); }
                  }} 
                  disabled={isAnalyzing}
                  className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-md shadow-purple-200 disabled:opacity-50 flex-1 sm:flex-initial"
                >
                  {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : "🤖 帮我分析"}
                </button>
              </div>
            </div>
          </div>

          {showPromptEditor && (
            <div className="p-4 bg-white rounded-xl border border-purple-200 animate-in fade-in slide-in-from-top-1 duration-200 space-y-3" style={{ colorScheme: 'light' }}>
              <div className="flex flex-col gap-2 bg-slate-50 p-3 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">发送给 AI 的数据源 (支持点开细选):</span>
                  <div className="relative">
                    <button 
                      onClick={() => setShowAiListSelector(!showAiListSelector)}
                      className="text-[10px] text-purple-600 hover:text-purple-700 font-bold flex items-center gap-1"
                    >
                      <Settings2 className="w-3 h-3" /> 选择维度 ({selectedAiLists.length}/6)
                    </button>
                    {showAiListSelector && (
                      <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-50 p-2 max-h-60 overflow-y-auto">
                        {["市场", "关系", "活动历史", ...(availableFilters?.availableColumns || [])].map(col => (
                          <label key={col} className="flex items-center gap-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer text-xs font-bold text-slate-700">
                            <input 
                              type="checkbox" 
                              checked={selectedAiLists.includes(col)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  if (selectedAiLists.length >= 6) {
                                    alert("最多只能选择 6 个维度！");
                                    return;
                                  }
                                  setSelectedAiLists([...selectedAiLists, col]);
                                } else {
                                  setSelectedAiLists(selectedAiLists.filter(x => x !== col));
                                }
                              }}
                              className="rounded text-purple-600 w-3.5 h-3.5"
                            />
                            {col}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-6 items-start mt-2">
                  {selectedAiLists.map(listName => (
                    <div key={listName} className="flex flex-col gap-1 min-w-[120px]">
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                          <span className="text-purple-700">●</span> {listName}
                        </label>
                        <button 
                          onClick={() => setExpandedAiList(expandedAiList === listName ? null : listName)}
                          className="text-[10px] text-purple-600 hover:text-purple-700 font-bold"
                        >
                          {expandedAiList === listName ? "收起" : "点开选择"}
                        </button>
                      </div>
                      {expandedAiList === listName && (
                        <div className="flex flex-col gap-1 max-h-40 overflow-y-auto mt-1 border border-slate-200 rounded p-1.5 bg-white shadow-sm">
                          {getTagsForList(listName).map((tag: string) => (
                            <label key={tag} className="flex items-center gap-1 text-[10px] font-bold text-slate-600 cursor-pointer hover:bg-slate-50 p-0.5 rounded">
                              <input 
                                type="checkbox" 
                                checked={isTagSelected(listName, tag)} 
                                onChange={(e) => toggleTagSelection(listName, tag, e.target.checked)} 
                                className="rounded text-purple-600 w-3 h-3" 
                              />
                              {tag}
                            </label>
                          ))}
                          {getTagsForList(listName).length === 0 && (
                            <span className="text-[10px] text-slate-400 p-1">无选项</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <label className="block text-xs font-black text-purple-700 mb-1.5 uppercase">自定义 AI 提示词 (Prompt)</label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="请输入自定义提示词，留空则使用默认提示词"
                rows={6}
                className="w-full border border-purple-100 rounded-lg px-3 py-2 text-sm text-slate-900 focus:border-purple-500 outline-none resize-none"
              />
              <p className="text-[10px] text-slate-500 mt-1">💡 提示：修改后的提示词将发送给 n8n 进行处理。不填则使用默认提示词。</p>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4" style={{ colorScheme: 'light' }}>
            {/* 统计卡片 */}
            <div className="bg-white p-5 rounded-2xl border border-purple-50 shadow-sm space-y-3">
              <div className="text-xs font-black text-slate-500 uppercase">数据概览</div>
              {stats ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-slate-600">总人数:</span>
                    <span className="text-slate-900 font-black">{stats.total} 人</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-slate-600">已发送:</span>
                    <span className="text-green-600 font-black">{stats.sent} 人</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-slate-600">未发送:</span>
                    <span className="text-red-600 font-black">{stats.unsent} 人 ({stats.unsentPercentage}%)</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div className="bg-purple-600 h-full" style={{ width: `${100 - parseFloat(stats.unsentPercentage)}%` }}></div>
                  </div>
                  <div className="text-[10px] text-slate-400 font-bold text-center">紫色代表已发送进度</div>
                </div>
              ) : (
                <div className="text-xs text-slate-400 font-bold flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> 正在加载统计...
                </div>
              )}
            </div>

            {/* 市场与标签卡片 */}
            <div className="bg-white p-5 rounded-2xl border border-purple-50 shadow-sm space-y-3">
              <div className="text-xs font-black text-slate-500 uppercase">构成分析</div>
              {stats ? (
                <div className="space-y-2 max-h-32 overflow-y-auto text-xs pt-1.5 pr-1">
                  {selectedAiLists.map(listName => (
                    <div key={listName}>
                      <span className="font-bold text-slate-700">{listName}:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(selectedAiListTags[listName] || getTagsForList(listName)).map(tag => (
                          <span key={tag} className="bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded-md font-bold">{tag}</span>
                        ))}
                        {(selectedAiListTags[listName] || getTagsForList(listName)).length === 0 && (
                          <span className="text-slate-400">全部</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400 font-bold">等待加载...</div>
              )}
            </div>
            
            {/* AI 分析卡片 */}
            <div className="bg-white p-5 rounded-2xl border border-purple-50 shadow-sm md:col-span-1 space-y-2">
              <div className="flex justify-between items-center">
                <div className="text-xs font-black text-slate-500 uppercase">AI 策略建议</div>
                {aiAnalysisTime && (
                  <div className="text-[10px] text-slate-400 font-bold">
                    分析于: {new Date(aiAnalysisTime).toLocaleString()}
                  </div>
                )}
              </div>
              {aiAnalysis ? (
                <div className="text-xs text-slate-700 font-bold whitespace-pre-wrap max-h-32 overflow-y-auto">
                  {aiAnalysis}
                </div>
              ) : (
                <div className="text-xs text-slate-400 font-bold flex flex-col items-center justify-center h-24 gap-2">
                  <BarChart2 className="w-8 h-8 text-purple-200" />
                  <span>点击“帮我分析”让 AI 为您制定策略</span>
                </div>
              )}
            </div>
          </div>

          {/* 🌟 智能建议执行面板 */}
          {aiAction && (
            <div className="mt-4 bg-purple-50 p-4 rounded-xl border border-purple-200 space-y-3" style={{ colorScheme: 'light' }}>
              <div className="text-xs font-black text-purple-800 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" /> 🤖 AI 智能建议执行
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="font-bold text-slate-500">建议人群名:</span>
                  <p className="font-black text-slate-900">{aiAction.crowdName}</p>
                </div>
                <div>
                  <span className="font-bold text-slate-500">策略类型:</span>
                  <p className="font-black text-purple-700">{aiAction.strategy}</p>
                </div>
                <div className="md:col-span-2">
                  <span className="font-bold text-slate-500">建议理由:</span>
                  <p className="text-slate-700 font-bold">{aiAction.reason}</p>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-3 items-center mt-2">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[10px] font-black text-slate-500 mb-1 uppercase">选择素材包 (可选)</label>
                  <select 
                    value={selectedMaterialId}
                    onChange={(e) => setSelectedMaterialId(e.target.value)}
                    className="w-full border border-purple-100 rounded-lg px-2 py-1.5 text-xs text-slate-900 font-bold focus:border-purple-500 outline-none bg-white"
                  >
                    <option value="">-- 请选择素材包 --</option>
                    {materials.map((m: any) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleExecAction}
                    disabled={isExecuting}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg text-xs font-black hover:bg-purple-700 transition-all flex items-center gap-2 shadow-md shadow-purple-200 disabled:opacity-50"
                  >
                    {isExecuting ? <Loader2 className="w-3 h-3 animate-spin" /> : "一键创建人群与活动"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats Radar Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white border-2 border-slate-100 rounded-3xl p-5 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-100 text-blue-700 rounded-2xl">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">跟进线索总数</div>
            <div className="text-2xl font-black text-slate-950 mt-0.5">{totalTasksCount} 人</div>
          </div>
        </div>

        <div className="bg-white border-2 border-slate-100 rounded-3xl p-5 shadow-sm flex flex-col justify-between gap-2">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-100 text-amber-700 rounded-2xl">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">被动闲置报警</div>
              <div className="text-2xl font-black text-amber-600 mt-0.5">{burningTasksCount} 户</div>
            </div>
          </div>
          {burningTasksCount > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5 max-h-[120px] overflow-y-auto w-full">
              {tasks
                .filter(t => {
                  if (t.due_date && new Date(t.due_date).getTime() < nowTime) return true;
                  const activityTime = t.last_activity_at ? new Date(t.last_activity_at).getTime() : nowTime;
                  return (nowTime - activityTime) > idleThresholdMs;
                })
                .map(t => (
                  <div
                    key={t.id}
                    className="w-full flex items-center justify-between text-[10px] text-slate-600 hover:bg-slate-50 px-2 py-1 rounded-lg transition-all text-left font-bold gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => handleLocateTask(t.id)}
                      className="flex-1 truncate text-left hover:text-amber-600 cursor-pointer"
                    >
                      ⏳ {t.title}
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {t.phone && (
                        <>
                          <a
                            href={`tel:${t.phone.replace(/[^\d+]/g, '')}`}
                            title="呼叫"
                            className="p-1 bg-blue-50 hover:bg-blue-100 rounded text-[9px] flex items-center justify-center w-5 h-5 transition-colors"
                          >
                            📞
                          </a>
                          <a
                            href={`https://wa.me/${t.phone.replace(/[^\d]/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="WhatsApp 聊天"
                            className="p-1 bg-emerald-50 hover:bg-emerald-100 rounded text-[9px] flex items-center justify-center w-5 h-5 transition-colors"
                          >
                            💬
                          </a>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleLocateTask(t.id)}
                        className="text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-black uppercase hover:bg-amber-100 transition-colors"
                      >
                        定位
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className="bg-white border-2 border-slate-100 rounded-3xl p-5 shadow-sm flex flex-col justify-between gap-2">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-red-100 text-red-700 rounded-2xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">紧急跟进卡片</div>
              <div className="text-2xl font-black text-red-600 mt-0.5">{urgentTasksCount} 份</div>
            </div>
          </div>
          {urgentTasksCount > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-100 space-y-1.5 max-h-[120px] overflow-y-auto w-full">
              {tasks
                .filter(t => t.priority === "urgent" || t.priority === "high")
                .map(t => (
                  <div
                    key={t.id}
                    className="w-full flex items-center justify-between text-[10px] text-slate-600 hover:bg-slate-50 px-2 py-1 rounded-lg transition-all text-left font-bold gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => handleLocateTask(t.id)}
                      className="flex-1 truncate text-left hover:text-red-600 cursor-pointer"
                    >
                      🔥 {t.title}
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {t.phone && (
                        <>
                          <a
                            href={`tel:${t.phone.replace(/[^\d+]/g, '')}`}
                            title="呼叫"
                            className="p-1 bg-blue-50 hover:bg-blue-100 rounded text-[9px] flex items-center justify-center w-5 h-5 transition-colors"
                          >
                            📞
                          </a>
                          <a
                            href={`https://wa.me/${t.phone.replace(/[^\d]/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="WhatsApp 聊天"
                            className="p-1 bg-emerald-50 hover:bg-emerald-100 rounded text-[9px] flex items-center justify-center w-5 h-5 transition-colors"
                          >
                            💬
                          </a>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleLocateTask(t.id)}
                        className="text-[9px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-black uppercase hover:bg-red-100 transition-colors"
                      >
                        定位
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Kanban Board Area */}
      <div className="flex gap-6 overflow-x-auto pb-8 snap-x snap-mandatory min-h-[500px]">
        {steps.filter(s => !hiddenStepIds.includes(s.id)).map(step => {
          const stepTasks = tasks
            .filter(t => t.step_id === step.id)
            .sort((a, b) => a.order - b.order);

          return (
            <div
              key={step.id}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDropOnColumn(e, step.id)}
              className="flex-shrink-0 w-[calc(100vw-24px)] md:w-80 bg-slate-50 rounded-[2rem] border-2 border-slate-100 p-4 flex flex-col snap-always snap-center"
              style={{ borderTopColor: step.color, borderTopWidth: "6px" }}
            >
              {/* Step Header */}
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-200">
                <div className="flex items-center gap-2 min-w-0">
                  <div 
                    className="w-3.5 h-3.5 rounded-full shrink-0" 
                    style={{ backgroundColor: step.color }}
                  />
                  <h3 
                    onClick={() => {
                      setStepForm({ id: step.id, name: step.name, color: step.color });
                      setShowStepModal(true);
                    }}
                    className="font-black text-slate-900 truncate text-sm cursor-pointer hover:underline"
                  >
                    {step.name}
                  </h3>
                  <span className="bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full shrink-0 font-bold">
                    {stepTasks.length}
                  </span>
                </div>
                
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setSettingsModalStepId(step.id);
                      const stepRules = step.automation_config && Array.isArray(step.automation_config) && step.automation_config.length === 3
                        ? step.automation_config
                        : defaultRules;
                      setAutomationFormRules(stepRules);
                      setActiveSettingsTab("automation");
                      setShowSlaModal(true);
                    }}
                    className="p-1 text-slate-400 hover:text-purple-700 hover:bg-slate-200/50 rounded-md transition-colors"
                    title="配置阶段自动化"
                  >
                    <Settings2 className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => openCardLayoutSettings(step.id)}
                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-200/50 rounded-md transition-colors"
                    title="配置本列卡片显示字段"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => {
                      setEditingTask({ step_id: step.id });
                      setTaskFormStepId(step.id);
                      setShowTaskModal(true);
                    }}
                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-200/50 rounded-md transition-colors"
                    title="添加联系人"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  
                  <button
                    onClick={() => handleHideStep(step.id)}
                    className="p-1 text-slate-400 hover:text-amber-500 hover:bg-slate-200/50 rounded-md transition-colors"
                    title="隐藏此列"
                  >
                    <EyeOff className="w-4 h-4" />
                  </button>

                  {stepTasks.length === 0 && (
                    <button
                      onClick={() => handleDeleteStep(step.id)}
                      className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-200/50 rounded-md transition-colors"
                      title="物理删除此列"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Cards List */}
              <div className="flex-1 space-y-3 overflow-y-auto max-h-[600px] min-h-[150px] pr-1">
                {stepTasks.length > 0 ? (
                  <>
                    {stepTasks.slice(0, columnLimits[step.id] || 50).map(task => {
                    // Find active rules for this task
                    let taskRules: AutomationRule[] = [];
                    try {
                      const localConfig = step.automation_config;
                      if (Array.isArray(localConfig) && localConfig.some((r: any) => r.enabled)) {
                        taskRules = localConfig;
                      }
                    } catch {}
                    if (taskRules.length === 0) {
                      taskRules = globalAutomationRules;
                    }

                    const refDate = task.last_activity_at ? new Date(task.last_activity_at) : null;
                    const elapsedHours = refDate ? Math.max(0, (nowTime - refDate.getTime()) / (1000 * 60 * 60)) : 0;

                    // Determine active tier
                    let activeTier = -1;
                    if (refDate && Array.isArray(taskRules) && taskRules.length === 3) {
                      for (let i = 2; i >= 0; i--) {
                        const r = taskRules[i];
                        if (r && r.enabled && elapsedHours >= (r.threshold_hours || 0)) {
                          activeTier = i;
                          break;
                        }
                      }
                    }

                    // Compute special border classes & shadows based on activeTier
                    let activeBorderClass = "";
                    let activeShadowStyle = {};
                    if (activeTier === 0) {
                      activeBorderClass = "border-blue-500";
                      activeShadowStyle = { boxShadow: "0 0 10px rgba(59,130,246,0.15)" };
                    } else if (activeTier === 1) {
                      activeBorderClass = "border-amber-500";
                      activeShadowStyle = { boxShadow: "0 0 10px rgba(245,158,11,0.25)" };
                    } else if (activeTier === 2) {
                      activeBorderClass = "border-red-500 bg-red-50/10";
                      activeShadowStyle = { boxShadow: "0 0 12px rgba(239,68,68,0.35)" };
                    }

                    // Calculate countdown bar
                    let countdownBarHtml = null;
                    const showCountdown = taskRules[0] && taskRules[0].enabled && taskRules[0].show_countdown;
                    if (showCountdown && refDate) {
                      let nextRule: AutomationRule | null = null;
                      let nextTierIndex = -1;
                      for (let i = activeTier + 1; i < 3; i++) {
                        if (taskRules[i] && taskRules[i].enabled) {
                          nextRule = taskRules[i];
                          nextTierIndex = i;
                          break;
                        }
                      }

                      if (nextRule) {
                        const currentBase = activeTier >= 0 ? (taskRules[activeTier].threshold_hours || 0) : 0;
                        const target = nextRule.threshold_hours || 1;
                        const range = Math.max(1, target - currentBase);
                        const progress = elapsedHours - currentBase;
                        const mathSafe = Math.min(Math.max(progress / range, 0), 1);
                        const visiblePercent = Math.max(3, mathSafe * 100);
                        const leftTotalHours = Math.max(0, target - elapsedHours);
                        const leftH = Math.floor(leftTotalHours);
                        const leftM = Math.round((leftTotalHours - leftH) * 60);

                        let barGradient = "bg-gradient-to-r from-purple-500 to-pink-500";
                        if (nextTierIndex === 1) barGradient = "bg-gradient-to-r from-amber-500 to-yellow-500";
                        if (nextTierIndex === 2) barGradient = "bg-gradient-to-r from-red-500 to-red-400";

                        const hudTitle = `距离 T${nextTierIndex + 1} 还剩 ${leftH > 0 ? leftH + "h " : ""}${leftM}m`;
                        countdownBarHtml = (
                          <div className="absolute top-0 left-0 w-full h-[3px] bg-slate-100 rounded-t-2xl overflow-hidden" title={hudTitle}>
                            <div 
                              className={`h-full ${barGradient} transition-all duration-500`}
                              style={{ width: `${visiblePercent}%` }}
                            />
                          </div>
                        );
                      } else if (activeTier !== -1) {
                        countdownBarHtml = (
                          <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-red-500 to-red-800 rounded-t-2xl overflow-hidden" title={`T${activeTier + 1} 超时中`}>
                            <div className="h-full w-full bg-gradient-to-r from-red-500 to-red-800" />
                          </div>
                        );
                      }
                    }

                    // Fallback to default SLA config countdown if no custom countdown is shown
                    if (!countdownBarHtml && refDate) {
                      const idleThresholdMs = slaConfig.idle_hours * 60 * 60 * 1000;
                      const isIdle = (nowTime - refDate.getTime()) > idleThresholdMs;
                      countdownBarHtml = (
                        <div className="absolute top-0 left-0 w-full h-[3px] bg-slate-200 rounded-t-2xl overflow-hidden">
                          <div 
                            className={`h-full transition-all duration-500 ${
                              isIdle ? "bg-red-500" : elapsedHours > slaConfig.idle_hours - slaConfig.expiring_hours ? "bg-amber-400" : "bg-blue-500"
                            }`}
                            style={{ width: `${Math.min(100, (elapsedHours / slaConfig.idle_hours) * 100)}%` }}
                          />
                        </div>
                      );
                    }

                    // Priority badges styling
                    let priorityBadge = "bg-slate-100 text-slate-600";
                    if (task.priority === "urgent") priorityBadge = "bg-red-100 text-red-700 animate-pulse";
                    else if (task.priority === "high") priorityBadge = "bg-orange-100 text-orange-700";
                    else if (task.priority === "medium") priorityBadge = "bg-blue-100 text-blue-700";

                    const {
                      subtitleText,
                      subtitleLabel,
                      highlightText,
                      highlightLabel,
                      showHighlight,
                      customBadges,
                      detailRows
                    } = resolveCardFields(task, step.id);

                    const config = (cardLayout.steps && cardLayout.steps[step.id]) 
                      ? cardLayout.steps[step.id] 
                      : cardLayout.global;

                    const isSubtitleDynamic = !!(config.subtitleField && config.subtitleField !== "phone");
                    const subtitleRawField = isSubtitleDynamic ? config.subtitleField! : "phone";

                    const isHighlightDynamic = !!(config.highlightField && config.highlightField !== "note" && config.highlightField !== "none");
                    const highlightRawField = isHighlightDynamic ? config.highlightField! : "note";

                    const resolveCardBorderClass = () => {
                      const lCfg = (cardLayout.steps && cardLayout.steps[step.id]) 
                        ? cardLayout.steps[step.id] 
                        : cardLayout.global;

                      const props = task.properties || {};

                      if (lCfg && lCfg.conditionalStyles && Array.isArray(lCfg.conditionalStyles)) {
                        for (const rule of lCfg.conditionalStyles) {
                          if (!rule.field) continue;
                          const rawVal = props[rule.field] !== undefined ? props[rule.field] : task[rule.field as keyof Task];
                          if (rawVal === undefined || rawVal === null) continue;
                          const strVal = String(rawVal);
                          const matchVal = String(rule.value || "");
                          
                          let isMatch = false;
                          if (rule.operator === "equals") {
                            isMatch = strVal === matchVal;
                          } else if (rule.operator === "contains") {
                            isMatch = strVal.includes(matchVal);
                          } else if (rule.operator === "greater_than") {
                            isMatch = parseFloat(strVal) > parseFloat(matchVal);
                          } else if (rule.operator === "less_than") {
                            isMatch = parseFloat(strVal) < parseFloat(matchVal);
                          }

                          if (isMatch) {
                            if (rule.color === "gold") return "border-amber-500 bg-amber-50/20 border-[3.5px] ring-2 ring-amber-300/40";
                            if (rule.color === "red") return "border-red-500 bg-red-50/20 border-[3.5px] ring-2 ring-red-300/40";
                            if (rule.color === "green") return "border-emerald-500 bg-emerald-50/20 border-[3.5px] ring-2 ring-emerald-300/40";
                            if (rule.color === "blue") return "border-blue-500 bg-blue-50/20 border-[3.5px] ring-2 ring-blue-300/40";
                            if (rule.color === "purple") return "border-purple-500 bg-purple-50/20 border-[3.5px] ring-2 ring-purple-300/40";
                          }
                        }
                      }

                      return activeBorderClass || (elapsedHours > slaConfig.idle_hours ? "border-amber-200 bg-amber-50/20" : "");
                    };

                    const borderClass = resolveCardBorderClass();
                    const isUrgent = task.priority === "urgent";
                    let processedBorderClass = borderClass;
                    if (isUrgent) {
                      if (processedBorderClass) {
                        processedBorderClass = processedBorderClass
                          .split(" ")
                          .filter(c => !c.startsWith("bg-"))
                          .join(" ");
                        if (processedBorderClass.includes("border-amber-200")) {
                          processedBorderClass = processedBorderClass.replace("border-amber-200", "border-red-200");
                        }
                      } else {
                        processedBorderClass = "border-red-200";
                      }
                    }

                    const cardBg = isUrgent ? "bg-red-50/20" : "bg-white";
                    const cardShadow = isUrgent ? "shadow-[0_0_12px_rgba(239,68,68,0.35)] animate-pulse" : "shadow-sm";
                    const cardBorder = processedBorderClass || "border-slate-200";

                    const isSimplifiedMode = activeDays === "all" || stepTasks.length > 100;
                    if (isSimplifiedMode) {
                      return (
                        <div
                          key={task.id}
                          id={`task-card-${task.id}`}
                          draggable
                          onDragStart={(e) => handleDragStart(e, task.id)}
                          onDragOver={handleDragOver}
                          onDrop={(e) => handleDropOnCard(e, task.id, step.id)}
                          onTouchStart={() => startMobileDragTimer(task.id)}
                          onTouchMove={cancelMobileDragTimer}
                          onTouchEnd={cancelMobileDragTimer}
                          className={`bg-white p-3 rounded-2xl border-2 ${cardBorder} shadow-sm relative group hover:border-slate-400 hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${
                            highlightedTaskId === task.id ? "ring-4 ring-blue-500 border-blue-500 scale-105 duration-300 shadow-lg shadow-blue-100 z-10" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <h4 
                                onClick={() => {
                                  setEditingTask(task);
                                  setTaskFormStepId(task.step_id);
                                  setShowTaskModal(true);
                                }}
                                className="font-black text-slate-900 text-xs hover:underline cursor-pointer truncate"
                              >
                                {task.title}
                              </h4>
                              <div className="text-[10px] text-slate-500 font-bold truncate mt-0.5">
                                {task.phone || "无电话"}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className={`w-2.5 h-2.5 rounded-full ${
                                task.priority === "urgent" ? "bg-red-500 animate-pulse" : 
                                task.priority === "high" ? "bg-orange-500" : 
                                task.priority === "medium" ? "bg-blue-500" : "bg-slate-400"
                              }`} title={task.priority === "urgent" ? "紧急" : task.priority === "high" ? "重要" : task.priority === "medium" ? "普通" : "低度"} />
                              
                              <button
                                onClick={() => handleDeleteTask(task.id)}
                                className="p-1 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity rounded-md"
                                title="永久删除"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={task.id}
                        id={`task-card-${task.id}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDropOnCard(e, task.id, step.id)}
                        onTouchStart={() => startMobileDragTimer(task.id)}
                        onTouchMove={cancelMobileDragTimer}
                        onTouchEnd={cancelMobileDragTimer}
                        style={isUrgent ? undefined : activeShadowStyle}
                        className={`${cardBg} p-4 rounded-2xl border-2 ${cardBorder} ${cardShadow} relative group hover:border-slate-400 hover:shadow-md transition-all cursor-grab active:cursor-grabbing ${
                          highlightedTaskId === task.id ? "ring-4 ring-blue-500 border-blue-500 scale-105 duration-300 shadow-lg shadow-blue-100 z-10" : ""
                        }`}
                      >
                        {/* SLA Countdown Bar */}
                        {countdownBarHtml}

                        {/* Card title and actions */}
                        <div className="flex justify-between items-start mt-1">
                          <div className="min-w-0 font-bold w-full">
                            <h4 
                              onClick={() => {
                                setEditingTask(task);
                                setTaskFormStepId(task.step_id);
                                setShowTaskModal(true);
                              }}
                              className="font-black text-slate-900 text-sm hover:underline cursor-pointer truncate"
                            >
                              {task.title}
                            </h4>
                            <div className="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs">
                              {inlineEdit && inlineEdit.taskId === task.id && inlineEdit.field === subtitleRawField ? (
                                <input
                                  autoFocus
                                  type="text"
                                  value={inlineEdit.value}
                                  onChange={(e) => setInlineEdit(prev => prev ? { ...prev, value: e.target.value } : null)}
                                  onKeyDown={async (e) => {
                                    if (e.key === "Enter") {
                                      await submitInlineEdit();
                                    } else if (e.key === "Escape") {
                                      setInlineEdit(null);
                                    }
                                  }}
                                  onBlur={submitInlineEdit}
                                  onClick={(e) => e.stopPropagation()}
                                  className="bg-white border-2 border-blue-500 rounded px-1.5 py-0.5 text-xs text-slate-800 font-bold focus:outline-none w-[130px]"
                                />
                              ) : (
                                <span 
                                  className="font-bold text-slate-500 cursor-pointer hover:bg-slate-100 px-1 rounded truncate max-w-[130px]" 
                                  title={`[双击直接编辑] ${subtitleLabel}`}
                                  onDoubleClick={(e) => {
                                    startInlineEdit(e, task.id, subtitleRawField, subtitleText.startsWith("[无") ? "" : subtitleText, isSubtitleDynamic);
                                  }}
                                >
                                  {formatFieldValue(subtitleText)}
                                </span>
                              )}
                              {task.phone && (
                                <a 
                                  href={`https://wa.me/${task.phone.replace(/[^\d]/g, '')}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded-md text-[9px] font-black transition-colors"
                                  title="在 WhatsApp 中聊天"
                                >
                                  <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24">
                                    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.5-5.739-1.453L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.625 1.451 5.403.002 9.803-4.394 9.805-9.799.002-2.618-1.016-5.08-2.868-6.932C16.357 2.022 13.896 1 11.278 1 5.876 1 1.477 5.4 1.475 10.8c-.001 1.503.4 2.973 1.158 4.279L1.64 19.34l4.318-1.13c1.332.727 2.784 1.074 4.167 1.076zm11.082-7.406c-.29-.145-1.716-.848-1.982-.944-.266-.097-.46-.145-.652.145-.193.29-.747.944-.916 1.137-.168.193-.338.217-.628.072-1.716-.856-2.73-1.44-3.824-3.314-.29-.498.29-.462.83-1.543.097-.193.048-.362-.024-.508-.072-.145-.652-1.573-.894-2.153-.236-.569-.475-.491-.652-.5h-.557c-.193 0-.507.072-.772.362-.266.29-1.014.99-1.014 2.415 0 1.425 1.038 2.8 1.182 2.993.145.193 2.043 3.12 4.949 4.373.692.298 1.233.476 1.654.61.696.221 1.33.19 1.83.115.558-.084 1.717-.7 1.96-1.374.242-.674.242-1.253.168-1.374-.074-.121-.268-.194-.559-.339z" />
                                  </svg>
                                  WhatsApp
                                </a>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="p-1 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity rounded-md"
                            title="永久删除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Highlight Box / Custom Highlight */}
                        {showHighlight && (
                          inlineEdit && inlineEdit.taskId === task.id && inlineEdit.field === highlightRawField ? (
                            <div className="mt-2.5 text-xs bg-slate-50 border-l-2 border-blue-500 p-2 rounded-r-lg" onClick={(e) => e.stopPropagation()}>
                              <textarea
                                autoFocus
                                rows={4}
                                value={inlineEdit.value}
                                onChange={(e) => setInlineEdit(prev => prev ? { ...prev, value: e.target.value } : null)}
                                onKeyDown={async (e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    await submitInlineEdit();
                                  } else if (e.key === "Escape") {
                                    setInlineEdit(null);
                                  }
                                }}
                                onBlur={submitInlineEdit}
                                className="w-full bg-white border-2 border-blue-500 rounded px-1.5 py-1 text-xs text-slate-800 font-bold focus:outline-none resize-y min-h-[220px] md:min-h-[100px]"
                              />
                            </div>
                          ) : (
                            highlightText ? (
                              <div 
                                className="mt-2.5 text-xs bg-slate-50 border-l-2 border-blue-500 p-2 rounded-r-lg font-medium text-slate-700 cursor-pointer hover:bg-slate-100 transition-all whitespace-pre-line max-h-24 overflow-y-auto"
                                title={`[双击直接编辑] ${highlightLabel}`}
                                onDoubleClick={(e) => {
                                  startInlineEdit(e, task.id, highlightRawField, highlightText.startsWith("[无") ? "" : highlightText, isHighlightDynamic);
                                }}
                              >
                                # {highlightLabel}: {formatFieldValue(highlightText)}
                              </div>
                            ) : null
                          )
                        )}

                        {/* Labels / Tags */}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase ${priorityBadge}`}>
                            {task.priority === "urgent" ? "🚨 紧急" : task.priority === "high" ? "🔥 重要" : task.priority === "medium" ? "⚡ 普通" : "☕ 低度"}
                          </span>

                          {task.labels.map((label, idx) => (
                            <span key={idx} className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold">
                              🏷️ {label}
                            </span>
                          ))}

                          {customBadges.map((badge, idx) => (
                            <span key={`cb-${idx}`} className="text-[10px] px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full font-black">
                              ✨ {badge}
                            </span>
                          ))}
                        </div>

                        {/* Compact Key-Value Details */}
                        {detailRows.length > 0 && (
                          <div className="mt-3 pt-2.5 border-t border-dashed border-slate-200 text-[10px] space-y-1 text-slate-700 font-bold">
                            {detailRows.map((row, idx) => {
                              const isEditingThisRow = inlineEdit && inlineEdit.taskId === task.id && inlineEdit.field === row.rawName;
                              return (
                                <div 
                                  key={idx} 
                                  className="flex justify-between items-center gap-2 cursor-pointer hover:bg-slate-100/50 p-0.5 rounded transition-all"
                                  title="双击直接快速编辑该字段"
                                  onDoubleClick={(e) => {
                                    const isDynamic = !["phone", "note", "title"].includes(row.rawName);
                                    startInlineEdit(e, task.id, row.rawName, row.value === "无" ? "" : row.value, isDynamic);
                                  }}
                                >
                                  <span>{row.name}:</span>
                                  {isEditingThisRow ? (
                                    <input
                                      autoFocus
                                      type="text"
                                      value={inlineEdit.value}
                                      onChange={(e) => setInlineEdit(prev => prev ? { ...prev, value: e.target.value } : null)}
                                      onKeyDown={async (e) => {
                                        if (e.key === "Enter") {
                                          await submitInlineEdit();
                                        } else if (e.key === "Escape") {
                                          setInlineEdit(null);
                                        }
                                      }}
                                      onBlur={submitInlineEdit}
                                      onClick={(e) => e.stopPropagation()}
                                      className="bg-white border-2 border-blue-500 rounded px-1 py-0.5 text-[9px] text-slate-800 font-black focus:outline-none w-[110px]"
                                    />
                                  ) : (
                                    <span className="text-slate-900 font-black truncate max-w-[120px]" title={row.value}>
                                      {formatFieldValue(row.value)}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Quick action buttons */}
                        <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center gap-1.5">
                          <button
                            onClick={() => handleTriggerMagicAction(task.id, "quote")}
                            className="flex-1 text-[10px] py-1 bg-blue-50 text-blue-600 rounded-md font-black hover:bg-blue-100 transition-colors"
                          >
                            📄 极速出单
                          </button>
                          <button
                            onClick={() => handleTriggerMagicAction(task.id, "alert")}
                            className="flex-1 text-[10px] py-1 bg-red-50 text-red-600 rounded-md font-black hover:bg-red-100 transition-colors"
                          >
                            🔔 紧急催办
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {stepTasks.length > (columnLimits[step.id] || 50) && (
                    <button
                      type="button"
                      onClick={() => {
                        setColumnLimits(prev => ({
                          ...prev,
                          [step.id]: (prev[step.id] || 50) + 50
                        }));
                      }}
                      className="w-full text-xs py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl font-bold transition-colors mt-2"
                    >
                      展开更多 (已显示 {columnLimits[step.id] || 50}/{stepTasks.length})
                    </button>
                  )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 border-2 border-dashed border-slate-200 rounded-2xl">
                    <p className="text-xs text-slate-400 font-bold">无跟进客户</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Create column button */}
        <div 
          onClick={() => {
            setStepForm({ id: "", name: "", color: "#3b82f6" });
            setShowStepModal(true);
          }}
          className="flex-shrink-0 w-80 bg-slate-50/50 hover:bg-slate-50 border-2 border-dashed border-slate-200 hover:border-blue-400 rounded-[2rem] p-6 flex flex-col items-center justify-center cursor-pointer transition-all hover:shadow-md min-h-[400px]"
        >
          <Plus className="w-8 h-8 text-slate-400" />
          <span className="text-sm font-black text-slate-500 mt-2">创建新看板列</span>
        </div>
      </div>

      {/* Task Creation / Editing Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-250 max-h-[90vh] overflow-y-auto" style={{ colorScheme: 'light' }}>
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900">
                {editingTask?.id ? "✏️ 编辑客户跟进详情" : "➕ 新增跟进联系人"}
              </h3>
              <button 
                onClick={() => { setShowTaskModal(false); setEditingTask(null); }}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSaveTask} className="space-y-4">
              {/* Smart Ingestion Input Area */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-2xl border-2 border-dashed border-blue-200 space-y-2">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-black text-blue-800 uppercase tracking-wide flex items-center gap-1">
                    ⚡ 一键智能解析录入
                  </label>
                  {smartText && (
                    <button
                      type="button"
                      onClick={() => setSmartText("")}
                      className="text-[10px] text-red-500 hover:underline font-bold"
                    >
                      清空解析器
                    </button>
                  )}
                </div>
                <textarea
                  rows={4}
                  value={smartText}
                  onChange={(e) => handleSmartIngestionChange(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:border-blue-500 outline-none resize-none placeholder-slate-400"
                  placeholder="在此粘贴整段介绍/跟进文本，系统将自动识别姓名、电话、下次/最后跟进日期以及其他定义的列（如年龄、职业等）"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">客户姓名</label>
                <input
                  required
                  type="text"
                  value={editingTask?.title || ""}
                  onChange={(e) => setEditingTask(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-2 text-sm font-bold text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                  placeholder="姓名"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">电话号码 *</label>
                <input
                  required
                  type="text"
                  value={editingTask?.phone || ""}
                  onChange={(e) => setEditingTask(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-2 text-sm font-bold text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                  placeholder="例如 +86180..."
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">优先级</label>
                  <select
                    value={editingTask?.priority || "medium"}
                    onChange={(e: any) => setEditingTask(prev => ({ ...prev, priority: e.target.value }))}
                    className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-2.5 text-sm font-black text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                  >
                    <option value="low">☕ 低度</option>
                    <option value="medium">⚡ 普通</option>
                    <option value="high">🔥 重要</option>
                    <option value="urgent">🚨 紧急</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">跟进时限</label>
                  <input
                    type="datetime-local"
                    value={editingTask?.due_date ? new Date(new Date(editingTask.due_date).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}
                    onChange={(e) => setEditingTask(prev => ({ ...prev, due_date: e.target.value ? new Date(e.target.value).toISOString() : null }))}
                    className="w-full bg-white border-2 border-slate-300 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">发送次数</label>
                  <div className="w-full bg-slate-50 border-2 border-slate-200 border-dashed rounded-xl px-4 py-2.5 text-sm font-black text-slate-600 text-center flex items-center justify-center">
                    🚀 {editingTask?.sendCount ?? 0} 次
                  </div>
                </div>
              </div>

              {/* Defined Custom Columns (properties) */}
              <div className="space-y-3 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                <div className="flex justify-between items-center">
                  <label className="block text-xs font-black text-slate-700 uppercase">
                    📋 定义的列 (自定义属性)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const newPropName = prompt("请输入新的自定义列名（例如：微信、性别、国籍）：");
                      if (newPropName && newPropName.trim()) {
                        const trimmed = newPropName.trim();
                        setEditingTask(prev => ({
                          ...prev,
                          properties: {
                            ...(prev?.properties || {}),
                            [trimmed]: ""
                          }
                        }));
                        if (!availableFields.some(f => f.name === trimmed)) {
                          setAvailableFields(prev => [...prev, { name: trimmed, type: "json_property", isDynamic: true }]);
                        }
                      }
                    }}
                    className="text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 px-2 py-1 rounded-lg font-black transition-colors"
                  >
                    + 新增列定义
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 max-h-[160px] overflow-y-auto pr-1">
                  {availableFields.filter(f => f.isDynamic).length === 0 && (
                    <p className="text-[10px] text-slate-400 font-bold py-2 col-span-2 text-center">暂无自定义列，点击右上角新增</p>
                  )}
                  {availableFields.filter(f => f.isDynamic).map(field => {
                    const val = editingTask?.properties?.[field.name] || "";
                    return (
                      <div key={field.name} className="space-y-1">
                        <label className="block text-[10px] font-black text-slate-500 truncate" title={field.name}>
                          {field.name}
                        </label>
                        <input
                          type="text"
                          value={val}
                          onChange={(e) => setEditingTask(prev => ({
                            ...prev,
                            properties: {
                              ...(prev?.properties || {}),
                              [field.name]: e.target.value
                            }
                          }))}
                          className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                          placeholder={`输入 ${field.name}`}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">内部跟进备注</label>
                <textarea
                  rows={6}
                  value={editingTask?.note || ""}
                  onChange={(e) => setEditingTask(prev => ({ ...prev, note: e.target.value }))}
                  className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:border-blue-600 focus:bg-white outline-none resize-y min-h-[300px] md:min-h-[160px]"
                  placeholder="记录该客户需求细节..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setShowTaskModal(false); setEditingTask(null); }}
                  className="px-4 py-2 text-xs font-black text-slate-500 hover:text-slate-900"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 shadow-md shadow-blue-100"
                >
                  确认保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SLA & Automation Configuration Modal */}
      {showSlaModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-250 max-h-[90vh] overflow-y-auto" style={{ colorScheme: 'light' }}>
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900">
                {settingsModalStepId 
                  ? `🤖 [${steps.find(s => s.id === settingsModalStepId)?.name || ""}] 专属自动化`
                  : "⚙️ 系统及全局偏好设置"}
              </h3>
              <button 
                onClick={() => setShowSlaModal(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Tab selection (only show if global settings) */}
            {!settingsModalStepId && (
              <div className="flex border-b border-slate-100 mb-4">
                <button
                  type="button"
                  onClick={() => setActiveSettingsTab("general")}
                  className={`flex-1 pb-2 text-xs font-black transition-colors border-b-2 ${
                    activeSettingsTab === "general"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-400 hover:text-slate-600"
                  }`}
                >
                  常规 SLA 设置
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSettingsTab("automation")}
                  className={`flex-1 pb-2 text-xs font-black transition-colors border-b-2 ${
                    activeSettingsTab === "automation"
                      ? "border-blue-600 text-blue-600"
                      : "border-transparent text-slate-400 hover:text-slate-600"
                  }`}
                >
                  全局自动化规则 (T1-T3)
                </button>

              </div>
            )}

            {/* Modal Body Forms */}
            {(settingsModalStepId || activeSettingsTab === "automation") ? (
              <form onSubmit={handleSaveAutomation} className="space-y-4">
                <p className="text-[10px] text-slate-400 font-bold mb-2 leading-relaxed">
                  通过 3 阶业务自动化规则，当联系人在阶段停留过久时自动触发提权、转移或重置操作。
                </p>
                
                <div className="space-y-4">
                  {[0, 1, 2].map((idx) => {
                    const rule = automationFormRules[idx];
                    return (
                      <div key={idx} className="border border-slate-100 rounded-2xl p-4 bg-slate-50/50 space-y-3">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-black text-white ${
                              idx === 0 ? "bg-blue-500" : idx === 1 ? "bg-amber-500" : "bg-red-500"
                            }`}>
                              Tier {idx + 1}
                            </span>
                            <span className="text-xs font-black text-slate-800">
                              {idx === 0 ? "业务初级感知" : idx === 1 ? "业务深度促活" : "自动流转 / 归档"}
                            </span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                              type="checkbox" 
                              checked={rule?.enabled || false} 
                              onChange={(e) => {
                                const val = e.target.checked;
                                setAutomationFormRules(prev => prev.map((r, i) => i === idx ? { ...r, enabled: val } : r));
                              }}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                          </label>
                        </div>

                        {rule?.enabled && (
                          <div className="space-y-4 pt-2 border-t border-slate-100 animate-in fade-in duration-200">
                            {/* Threshold hours input */}
                            <div>
                              <label className="block text-[10px] font-black text-slate-500 mb-1.5 uppercase">⏱️ 触发阈值 (Idle Time)</label>
                              <div className="flex gap-2">
                                <div className="flex-1 flex items-center bg-white border border-slate-300 rounded-xl px-3 py-1.5">
                                  <input 
                                    type="number" 
                                    min={0}
                                    value={Math.floor(rule.threshold_hours)}
                                    onChange={(e) => {
                                      const hrs = Math.max(0, parseInt(e.target.value) || 0);
                                      const currentMins = Math.round((rule.threshold_hours % 1) * 60);
                                      const newVal = hrs + currentMins / 60;
                                      setAutomationFormRules(prev => prev.map((r, i) => i === idx ? { ...r, threshold_hours: newVal } : r));
                                    }}
                                    className="w-full text-right outline-none font-bold text-slate-900 text-sm"
                                  />
                                  <span className="text-xs text-slate-400 font-bold ml-1.5">小时</span>
                                </div>
                                <div className="flex-1 flex items-center bg-white border border-slate-300 rounded-xl px-3 py-1.5">
                                  <input 
                                    type="number" 
                                    min={0}
                                    max={59}
                                    value={Math.round((rule.threshold_hours % 1) * 60)}
                                    onChange={(e) => {
                                      const mins = Math.min(59, Math.max(0, parseInt(e.target.value) || 0));
                                      const currentHrs = Math.floor(rule.threshold_hours);
                                      const newVal = currentHrs + mins / 60;
                                      setAutomationFormRules(prev => prev.map((r, i) => i === idx ? { ...r, threshold_hours: newVal } : r));
                                    }}
                                    className="w-full text-right outline-none font-bold text-slate-900 text-sm"
                                  />
                                  <span className="text-xs text-slate-400 font-bold ml-1.5">分钟</span>
                                </div>
                              </div>
                            </div>

                            {/* Priority action */}
                            <div className="flex items-center justify-between gap-4">
                              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                                <input 
                                  type="checkbox"
                                  checked={rule.priority_update?.enabled || false}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setAutomationFormRules(prev => prev.map((r, i) => i === idx ? {
                                      ...r,
                                      priority_update: { ...r.priority_update, enabled: val }
                                    } : r));
                                  }}
                                  className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 w-4 h-4"
                                />
                                自动变更为优先级
                              </label>
                              <select
                                disabled={!rule.priority_update?.enabled}
                                value={rule.priority_update?.value || "urgent"}
                                onChange={(e: any) => {
                                  const val = e.target.value;
                                  setAutomationFormRules(prev => prev.map((r, i) => i === idx ? {
                                    ...r,
                                    priority_update: { ...r.priority_update, value: val }
                                  } : r));
                                }}
                                className="bg-white border border-slate-300 rounded-xl px-2 py-1 text-xs font-black text-slate-900 outline-none disabled:bg-slate-100 disabled:text-slate-400"
                              >
                                <option value="low">☕ 低度 (Low)</option>
                                <option value="medium">⚡ 普通 (Medium)</option>
                                <option value="high">🔥 重要 (High)</option>
                                <option value="urgent">🚨 紧急 (Urgent)</option>
                              </select>
                            </div>

                            {/* Auto move (Tier 3 only) */}
                            {idx === 2 && (
                              <div className="flex items-center justify-between gap-4">
                                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                                  <input 
                                    type="checkbox"
                                    checked={rule.auto_move?.enabled || false}
                                    onChange={(e) => {
                                      const val = e.target.checked;
                                      setAutomationFormRules(prev => prev.map((r, i) => i === idx ? {
                                        ...r,
                                        auto_move: { ...r.auto_move, enabled: val }
                                      } : r));
                                    }}
                                    className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 w-4 h-4"
                                  />
                                  自动平移至阶段列
                                </label>
                                <select
                                  disabled={!rule.auto_move?.enabled}
                                  value={rule.auto_move?.step_id || ""}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setAutomationFormRules(prev => prev.map((r, i) => i === idx ? {
                                      ...r,
                                      auto_move: { ...r.auto_move, step_id: val }
                                    } : r));
                                  }}
                                  className="bg-white border border-slate-300 rounded-xl px-2 py-1 text-xs font-black text-slate-900 outline-none disabled:bg-slate-100 disabled:text-slate-400 max-w-[150px]"
                                >
                                  <option value="">-- 选择阶段 --</option>
                                  {steps.filter(s => s.id !== settingsModalStepId).map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Reset active time */}
                            <div className="flex items-center">
                              <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                                <input 
                                  type="checkbox"
                                  checked={rule.reset_date || false}
                                  onChange={(e) => {
                                    const val = e.target.checked;
                                    setAutomationFormRules(prev => prev.map((r, i) => i === idx ? { ...r, reset_date: val } : r));
                                  }}
                                  className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 w-4 h-4"
                                />
                                {idx === 2 ? "平移后清空/重置活跃时间" : "重置闲置记录(获得全新跟进周期)"}
                              </label>
                            </div>

                            {/* Show countdown HUD (Tier 1 & 2 only) */}
                            {idx < 2 && (
                              <div className="flex items-center">
                                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                                  <input 
                                    type="checkbox"
                                    checked={rule.show_countdown || false}
                                    onChange={(e) => {
                                      const val = e.target.checked;
                                      setAutomationFormRules(prev => prev.map((r, i) => i === idx ? { ...r, show_countdown: val } : r));
                                    }}
                                    className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 w-4 h-4"
                                  />
                                  显示升级进度 HUD 条
                                </label>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowSlaModal(false)}
                    className="px-4 py-2 text-xs font-black text-slate-500 hover:text-slate-900"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 shadow-md shadow-blue-100"
                  >
                    保存契约
                  </button>
                </div>
              </form>

            ) : (
              <form onSubmit={handleSaveSla} className="space-y-4">
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">
                    SLA 闲置警告红线 ({slaForm.idle_hours}小时)
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={1}
                      max={120}
                      value={slaForm.idle_hours}
                      onChange={(e) => setSlaForm(prev => ({ ...prev, idle_hours: parseInt(e.target.value) }))}
                      className="flex-1 accent-blue-600 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="w-12 font-black text-sm text-slate-800 text-right">{slaForm.idle_hours}h</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">
                    SLA 临期预警区间 ({slaForm.expiring_hours}小时)
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={1}
                      max={24}
                      value={slaForm.expiring_hours}
                      onChange={(e) => setSlaForm(prev => ({ ...prev, expiring_hours: parseInt(e.target.value) }))}
                      className="flex-1 accent-amber-500 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                    />
                    <span className="w-12 font-black text-sm text-slate-800 text-right">{slaForm.expiring_hours}h</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">逾期标记文本</label>
                  <input
                    required
                    type="text"
                    value={slaForm.overdue_label}
                    onChange={(e) => setSlaForm(prev => ({ ...prev, overdue_label: e.target.value }))}
                    className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-2 text-sm font-bold text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                    placeholder="已逾期"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowSlaModal(false)}
                    className="px-4 py-2 text-xs font-black text-slate-500 hover:text-slate-900"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 shadow-md shadow-blue-100"
                  >
                    保存设置
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Step creation/editing Modal */}
      {showStepModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-250" style={{ colorScheme: 'light' }}>
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900">
                {stepForm.id ? "✏️ 重命名看板阶段" : "➕ 新增看板跟进阶段"}
              </h3>
              <button 
                onClick={() => setShowStepModal(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleSaveStep} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">阶段名称</label>
                <input
                  required
                  autoFocus
                  type="text"
                  value={stepForm.name}
                  onChange={(e) => setStepForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-2 text-sm font-bold text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                  placeholder="例如：跟进中、待成单..."
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">主题颜色</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={stepForm.color}
                    onChange={(e) => setStepForm(prev => ({ ...prev, color: e.target.value }))}
                    className="w-12 h-10 bg-transparent border-0 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={stepForm.color}
                    onChange={(e) => setStepForm(prev => ({ ...prev, color: e.target.value }))}
                    className="flex-1 bg-white border-2 border-slate-300 rounded-xl px-4 py-2 text-sm font-mono text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowStepModal(false)}
                  className="px-4 py-2 text-xs font-black text-slate-500 hover:text-slate-900"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 shadow-md shadow-blue-100"
                >
                  保存阶段
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-250" style={{ colorScheme: 'light' }}>
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900">📥 批量数据快速导入</h3>
              <button 
                onClick={() => setShowImportModal(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={handleBulkImport} className="space-y-4">
              <div>
                <p className="text-xs text-slate-400 font-bold mb-2">
                  支持从 Excel 复制整行整列并粘贴在下方，或者用逗号/制表符隔开。格式：
                  <br />
                  <span className="font-mono text-blue-600">客户姓名, 电话, 备注(可空), 优先级(low/medium/high/urgent), 来源(可空)</span>
                </p>
                <textarea
                  required
                  rows={8}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  className="w-full bg-white border-2 border-slate-300 rounded-2xl px-4 py-3 text-xs font-mono text-slate-900 focus:border-blue-600 focus:bg-white outline-none resize-none"
                  placeholder="张三, +8618012345678, 需要AI介绍, High, 微信私域"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 text-xs font-black text-slate-500 hover:text-slate-900"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={!importText.trim()}
                  className="px-6 py-2.5 bg-emerald-600 text-white rounded-xl text-xs font-black hover:bg-emerald-700 shadow-md shadow-emerald-100 disabled:opacity-50"
                >
                  解析并写入云端
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Save View Modal */}
      {showSaveViewModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-250 animate-out fade-out zoom-out-95" style={{ colorScheme: 'light' }}>
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900">
                {isEditMode ? "⚙️ 修改看板视图属性" : "📋 另存为新看板视图"}
              </h3>
              <button 
                onClick={() => setShowSaveViewModal(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!saveViewForm.name.trim()) return;
              
              setSyncing(true);
              try {
                const payload: any = {
                  name: saveViewForm.name.trim(),
                  sourceId: selectedSourceIds.length > 0 ? JSON.stringify(selectedSourceIds) : null,
                  groupId: selectedGroupIds.length > 0 ? JSON.stringify(selectedGroupIds) : null,
                  hiddenStepIds: hiddenStepIds,
                  slaConfig: slaConfig,
                  stepsConfig: steps.map(s => ({ id: s.id, name: s.name, color: s.color, order: s.order })),
                  cardLayout: cardLayout,
                  instances: saveViewForm.instances,
                  isDefault: saveViewForm.isDefault,
                  isShared: saveViewForm.isShared
                };
                if (isEditMode && saveViewForm.id) {
                  payload.id = saveViewForm.id;
                }
                const res = await fetch("/api/kanban/views", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload)
                });
                if (res.ok) {
                  const data = await res.json();
                  alert(isEditMode ? "✓ 看板视图属性修改成功！" : "✓ 看板视图保存成功！");
                  setShowSaveViewModal(false);
                  setSaveViewForm({ name: "", isDefault: false, isShared: false, instances: [] });
                  
                  const viewsRes = await fetch("/api/kanban/views");
                  if (viewsRes.ok) {
                    const list = await viewsRes.json();
                    setViews(list || []);
                  }
                  if (!isEditMode) {
                    setSelectedViewId(data.id);
                  } else {
                    fetchData(selectedSourceIds, selectedGroupIds, saveViewForm.id);
                  }
                } else {
                  alert("保存失败");
                }
              } catch (err) {
                alert("网络错误，保存失败");
              } finally {
                setSyncing(false);
              }
            }} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">看板视图名称 *</label>
                <input
                  type="text"
                  value={saveViewForm.name}
                  onChange={(e) => setSaveViewForm({ ...saveViewForm, name: e.target.value })}
                  placeholder="例如: 安利会员5月看板"
                  className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-2 text-sm font-bold text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">数据流入实例 (可多选)</label>
                <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/50 max-h-40 overflow-y-auto space-y-2">
                  {whatsappInstances.length === 0 ? (
                    <div className="text-xs text-slate-500 py-2 text-center font-bold">
                      暂无可用实例 (请先绑定 WhatsApp 实例)
                    </div>
                  ) : (
                    whatsappInstances.map((inst) => {
                      const isChecked = saveViewForm.instances.includes(inst.rawName);
                      return (
                        <label key={inst.rawName} className="flex items-center gap-2 cursor-pointer hover:bg-slate-100/50 p-1.5 rounded-lg transition-colors">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              let updated = [...saveViewForm.instances];
                              if (checked) {
                                if (!updated.includes(inst.rawName)) {
                                  updated.push(inst.rawName);
                                }
                              } else {
                                updated = updated.filter(name => name !== inst.rawName);
                              }
                              setSaveViewForm({ ...saveViewForm, instances: updated });
                            }}
                            className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                          />
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-800">
                              {inst.displayName}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {inst.ownerName && inst.ownerName !== "系统全局" ? `${inst.ownerName} - ` : ""}{inst.rawName}
                            </span>
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 font-bold">
                  * 留空表示不限制，所有实例的数据都会流入此看板。
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveViewForm.isDefault}
                    onChange={(e) => setSaveViewForm({ ...saveViewForm, isDefault: e.target.checked })}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                  />
                  <span className="text-xs font-bold text-slate-700">设为我的默认看板（进入系统时自动加载）</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveViewForm.isShared}
                    onChange={(e) => setSaveViewForm({ ...saveViewForm, isShared: e.target.checked })}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                  />
                  <span className="text-xs font-bold text-slate-700">在团队中共享此看板（其他成员可见）</span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSaveViewModal(false)}
                  className="px-4 py-2 text-xs font-black text-slate-500 hover:text-slate-900"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 shadow-md shadow-blue-100"
                >
                  确定保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Card Layout Customizer Modal */}
      {showCardLayoutModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-xl border border-slate-100 animate-in fade-in zoom-in-95 duration-250 max-h-[90vh] overflow-y-auto" style={{ colorScheme: 'light' }}>
            <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
              <h3 className="text-lg font-black text-slate-900">
                {layoutModalStepId 
                  ? `🎨 [${steps.find(s => s.id === layoutModalStepId)?.name || ""}] 卡片显示设置`
                  : "🎨 全局卡片显示设置"}
              </h3>
              <button 
                onClick={() => setShowCardLayoutModal(false)}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {loadingFields ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                <span className="mt-2 text-xs font-bold text-slate-500">正在分析数据源列名...</span>
              </div>
            ) : (
              <form onSubmit={handleSaveLayoutForm} className="space-y-5">
                <p className="text-xs text-slate-500 font-bold leading-relaxed bg-slate-50 p-3 rounded-xl">
                  {layoutModalStepId 
                    ? "提示：本看板列已开启个性化卡片排版。未设置的字段默认继承全局设置。" 
                    : "提示：全局卡片排版是系统默认排列样式。您可以针对特定看板列独立定制以覆盖全局。"}
                </p>

                {/* Subtitle Select */}
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">
                    卡片副标题显示位置
                  </label>
                  <select
                    value={layoutForm.subtitleField}
                    onChange={(e) => setLayoutForm(prev => ({ ...prev, subtitleField: e.target.value }))}
                    className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-2.5 text-xs font-black text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                  >
                    <option value="phone">📞 默认电话号码</option>
                    <optgroup label="自定义列 (数据源)">
                      {availableFields.filter(f => f.isDynamic).map(f => (
                        <option key={f.name} value={f.name}>📁 {f.name}</option>
                      ))}
                    </optgroup>
                    <optgroup label="静态属性">
                      {availableFields.filter(f => !f.isDynamic && f.name !== "phone").map(f => (
                        <option key={f.name} value={f.name}>📍 {f.name}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                {/* Highlight Box Select */}
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">
                    高亮备注框显示数据
                  </label>
                  <select
                    value={layoutForm.highlightField}
                    onChange={(e) => setLayoutForm(prev => ({ ...prev, highlightField: e.target.value }))}
                    className="w-full bg-white border-2 border-slate-300 rounded-xl px-4 py-2.5 text-xs font-black text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                  >
                    <option value="note">📝 默认备注信息</option>
                    <option value="none">🚫 不展示高亮框</option>
                    <optgroup label="自定义列 (数据源)">
                      {availableFields.filter(f => f.isDynamic).map(f => (
                        <option key={f.name} value={f.name}>📁 {f.name}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                {/* Tag Fields Multi-Select */}
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">
                    徽章标签展示字段（可勾选多个）
                  </label>
                  <div className="border-2 border-slate-200 rounded-xl p-3 max-h-[120px] overflow-y-auto space-y-2">
                    {availableFields.filter(f => f.isDynamic).length === 0 ? (
                      <p className="text-[10px] text-slate-400 font-bold py-2 text-center">当前数据源无自定义列</p>
                    ) : (
                      availableFields.filter(f => f.isDynamic).map(f => {
                        const checked = layoutForm.tagFields?.includes(f.name);
                        return (
                          <label key={f.name} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const list = layoutForm.tagFields || [];
                                const next = checked ? list.filter(item => item !== f.name) : [...list, f.name];
                                setLayoutForm(prev => ({ ...prev, tagFields: next }));
                              }}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                            />
                            <span>{f.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Detail Fields Multi-Select */}
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">
                    底部紧凑详情展示（最多展示 4 项）
                  </label>
                  <div className="border-2 border-slate-200 rounded-xl p-3 max-h-[120px] overflow-y-auto space-y-2">
                    {availableFields.filter(f => f.isDynamic).length === 0 ? (
                      <p className="text-[10px] text-slate-400 font-bold py-2 text-center">当前数据源无自定义列</p>
                    ) : (
                      availableFields.filter(f => f.isDynamic).map(f => {
                        const checked = layoutForm.detailFields?.includes(f.name);
                        return (
                          <label key={f.name} className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!checked && (layoutForm.detailFields?.length || 0) >= 4}
                              onChange={() => {
                                const list = layoutForm.detailFields || [];
                                const next = checked ? list.filter(item => item !== f.name) : [...list, f.name];
                                setLayoutForm(prev => ({ ...prev, detailFields: next }));
                              }}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                            />
                            <span>{f.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Alias Configuration Section */}
                {(() => {
                  const selectedCustomFields = Array.from(new Set([
                    ...(layoutForm.subtitleField && layoutForm.subtitleField !== "phone" ? [layoutForm.subtitleField] : []),
                    ...(layoutForm.highlightField && layoutForm.highlightField !== "note" && layoutForm.highlightField !== "none" ? [layoutForm.highlightField] : []),
                    ...(layoutForm.tagFields || []),
                    ...(layoutForm.detailFields || [])
                  ]));

                  if (selectedCustomFields.length === 0) return null;

                  return (
                    <div>
                      <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">
                        📝 字段显示别名配置 (Aliases)
                      </label>
                      <div className="space-y-2 bg-slate-50 p-3 rounded-2xl border border-slate-100 max-h-[140px] overflow-y-auto">
                        {selectedCustomFields.map(field => (
                          <div key={field} className="flex items-center gap-3">
                            <span className="text-xs font-bold text-slate-800 truncate min-w-[100px] max-w-[140px]" title={field}>
                              {field} ➡️
                            </span>
                            <input
                              type="text"
                              value={layoutForm.aliases?.[field] || ""}
                              onChange={(e) => {
                                setLayoutForm(prev => ({
                                  ...prev,
                                  aliases: {
                                    ...(prev.aliases || {}),
                                    [field]: e.target.value
                                  }
                                }));
                              }}
                              placeholder="输入显示别名"
                              className="flex-1 bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-900 focus:border-blue-600 focus:bg-white outline-none"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Conditional Styles Section */}
                <div>
                  <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">
                    🎨 卡片条件边框高亮 (Conditional Borders)
                  </label>
                  <div className="space-y-3 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <div className="space-y-2 max-h-[140px] overflow-y-auto">
                      {(layoutForm.conditionalStyles || []).length === 0 ? (
                        <p className="text-[10px] text-slate-400 font-bold py-2 text-center">暂无条件边框规则</p>
                      ) : (
                        (layoutForm.conditionalStyles || []).map((rule, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-white border border-slate-200 p-2 rounded-xl text-xs font-bold text-slate-800 shadow-sm">
                            <span className="truncate max-w-[80px]" title={rule.field}>{rule.field === "title" ? "姓名" : rule.field === "phone" ? "电话" : rule.field === "note" ? "备注" : rule.field}</span>
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                              {rule.operator === "equals" ? "等于" : rule.operator === "contains" ? "包含" : rule.operator === "greater_than" ? ">" : "<"}
                            </span>
                            <span className="truncate max-w-[80px]" title={rule.value}>"{rule.value}"</span>
                            <span className="w-3.5 h-3.5 rounded-full shrink-0 ml-auto border" style={{
                              backgroundColor: rule.color === "gold" ? "#f59e0b" : rule.color === "red" ? "#ef4444" : rule.color === "green" ? "#10b981" : rule.color === "blue" ? "#3b82f6" : "#8b5cf6"
                            }} />
                            <button
                              type="button"
                              onClick={() => {
                                const next = (layoutForm.conditionalStyles || []).filter((_, i) => i !== idx);
                                setLayoutForm(prev => ({ ...prev, conditionalStyles: next }));
                              }}
                              className="text-red-500 hover:text-red-700 p-1"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="border-t border-slate-200 pt-3 flex flex-wrap gap-2 items-center">
                      <select
                        id="new-rule-field"
                        className="bg-white border border-slate-300 rounded-xl p-1.5 text-[11px] font-bold text-slate-800 outline-none max-w-[110px]"
                      >
                        <option value="">-- 选择列 --</option>
                        <option value="title">客户姓名</option>
                        <option value="phone">电话号码</option>
                        <option value="note">跟进备注</option>
                        {availableFields.filter(f => f.isDynamic).map(f => (
                          <option key={f.name} value={f.name}>{f.name}</option>
                        ))}
                      </select>

                      <select
                        id="new-rule-operator"
                        className="bg-white border border-slate-300 rounded-xl p-1.5 text-[11px] font-bold text-slate-800 outline-none w-[75px]"
                      >
                        <option value="equals">等于</option>
                        <option value="contains">包含</option>
                        <option value="greater_than">大于</option>
                        <option value="less_than">小于</option>
                      </select>

                      <input
                        id="new-rule-value"
                        type="text"
                        placeholder="匹配值"
                        className="bg-white border border-slate-300 rounded-xl px-2.5 py-1.5 text-[11px] font-bold text-slate-900 outline-none flex-1 min-w-[70px]"
                      />

                      <select
                        id="new-rule-color"
                        className="bg-white border border-slate-300 rounded-xl p-1.5 text-[11px] font-bold text-slate-800 outline-none w-[65px]"
                      >
                        <option value="gold">金色</option>
                        <option value="red">红色</option>
                        <option value="green">绿色</option>
                        <option value="blue">蓝色</option>
                        <option value="purple">紫色</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          const fieldEl = document.getElementById("new-rule-field") as HTMLSelectElement;
                          const opEl = document.getElementById("new-rule-operator") as HTMLSelectElement;
                          const valEl = document.getElementById("new-rule-value") as HTMLInputElement;
                          const colorEl = document.getElementById("new-rule-color") as HTMLSelectElement;

                          if (!fieldEl.value) {
                            alert("请选择列名");
                            return;
                          }
                          const newRule: ConditionalStyleRule = {
                            field: fieldEl.value,
                            operator: opEl.value as any,
                            value: valEl.value,
                            color: colorEl.value as any
                          };

                          setLayoutForm(prev => ({
                            ...prev,
                            conditionalStyles: [...(prev.conditionalStyles || []), newRule]
                          }));

                          fieldEl.value = "";
                          valEl.value = "";
                        }}
                        className="bg-blue-600 text-white text-[11px] px-3 py-1.5 rounded-xl font-black hover:bg-blue-700"
                      >
                        添加规则
                      </button>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                  {layoutModalStepId && cardLayout.steps[layoutModalStepId] && (
                    <button
                      type="button"
                      onClick={() => {
                        const nextSteps = { ...cardLayout.steps };
                        delete nextSteps[layoutModalStepId];
                        handleSaveLayout({
                          ...cardLayout,
                          steps: nextSteps
                        });
                        setShowCardLayoutModal(false);
                      }}
                      className="text-xs font-black text-red-500 hover:text-red-700 transition-colors"
                    >
                      恢复默认继承
                    </button>
                  )}
                  <div className="flex gap-2 ml-auto">
                    <button
                      type="button"
                      onClick={() => setShowCardLayoutModal(false)}
                      className="px-4 py-2 text-xs font-black text-slate-500 hover:text-slate-900"
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black hover:bg-blue-700 shadow-md shadow-blue-100"
                    >
                      保存设置
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Mobile Teleport / Move Selector Modal */}
      {showTeleportModal && teleportTaskId && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200" style={{ colorScheme: 'light' }}>
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-100 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-sm font-black text-slate-950">移动至看板列</h3>
                <p className="text-xs text-slate-500 font-bold mt-0.5">
                  客户: {tasks.find(t => t.id === teleportTaskId)?.title}
                </p>
              </div>
              <button 
                onClick={() => {
                  setShowTeleportModal(false);
                  setTeleportTaskId(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {steps.map(step => {
                const isCurrent = tasks.find(t => t.id === teleportTaskId)?.step_id === step.id;
                return (
                  <button
                    key={step.id}
                    onClick={() => {
                      handleTeleportTask(teleportTaskId, step.id);
                      setShowTeleportModal(false);
                      setTeleportTaskId(null);
                    }}
                    className={`w-full flex items-center justify-between p-3.5 rounded-2xl text-xs font-black transition-all ${
                      isCurrent 
                        ? "bg-blue-50 border-2 border-blue-500 text-blue-600 shadow-sm" 
                        : "bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700"
                    }`}
                  >
                    <span>{step.name}</span>
                    {isCurrent ? (
                      <span className="text-[9px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-black">当前阶段</span>
                    ) : (
                      <span className="text-slate-400 text-[10px]">点击移入 ➡️</span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100">
              <button
                onClick={() => {
                  setShowTeleportModal(false);
                  setTeleportTaskId(null);
                }}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-black rounded-xl transition-all"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
