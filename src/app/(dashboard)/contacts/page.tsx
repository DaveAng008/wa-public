"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { RefreshCw, Users, Ban, Loader2, Save, Filter, Tag, ChevronRight, BarChart2, Check, X, Settings2, Trash2, Plus, ArrowUpRight, ClipboardList, Sparkles, Edit3, Eye, EyeOff, AlertTriangle, UserX, RotateCcw } from "lucide-react";
import { contactsApi, Contact, blacklistApi } from "@/lib/api";
import { FilterBuilder, FilterRule } from "@/components/contacts/FilterBuilder";
import { DataTable, Column } from "@/components/ui/DataTable";
import { PageLoading } from "@/components/ui/LoadingSpinner";
import { SyncMappingModal } from "@/components/contacts/SyncMappingModal";
import { ForwardSyncMappingModal } from "@/components/contacts/ForwardSyncMappingModal";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import * as XLSX from "xlsx";

interface Group {
  id: string;
  name: string;
  filterConfig: any;
}

// ─── 多选组件 ──────────────────────────────────────────────────────────────
function MultiSelect({ label, options, selected, onChange }: { label: string, options: string[], selected: string[], onChange: (val: string[]) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const toggle = (opt: string) => {
    const next = selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt];
    onChange(next);
  };

  return (
    <div className="relative space-y-2">
      <label className="text-xs font-black text-slate-500 uppercase ml-1">{label}</label>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="min-h-[46px] border-2 border-slate-200 rounded-xl px-4 py-2 flex flex-wrap gap-1 items-center bg-slate-50 cursor-pointer hover:border-blue-400 transition-all"
      >
        {selected.length === 0 && <span className="text-slate-400 text-sm font-bold">全部...</span>}
        {selected.map(s => (
          <span key={s} className="bg-blue-600 text-white text-[10px] font-black px-2 py-1 rounded-lg flex items-center gap-1">
            {s} <X className="w-3 h-3" onClick={(e) => { e.stopPropagation(); toggle(s); }} />
          </span>
        ))}
      </div>
      {isOpen && (
        <div className="absolute z-50 top-full mt-2 w-full bg-white border-2 border-slate-200 rounded-2xl shadow-xl p-2 max-h-60 overflow-y-auto animate-in fade-in zoom-in duration-150">
          {options.map(opt => (
            <div 
              key={opt} 
              onClick={() => toggle(opt)}
              className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer hover:bg-slate-50 ${selected.includes(opt) ? "text-blue-600 font-black bg-blue-50" : "text-slate-700 font-bold"}`}
            >
              {opt}
              {selected.includes(opt) && <Check className="w-4 h-4" />}
            </div>
          ))}
          <div className="border-t mt-2 pt-2 flex justify-center">
             <button onClick={() => setIsOpen(false)} className="text-xs font-black text-blue-600 py-1 px-4 hover:bg-blue-50 rounded-lg">完成</button>
          </div>
        </div>
      )}
    </div>
  );
}

// 智能清理并解析多号码格式 (主要: +60 10-450 3858, 移动设备: +65 11286620) -> 规范为纯数字格式 (如 60104503858)
function cleanAndExtractPhones(rawPhone: string) {
  if (!rawPhone) return { primary: "", phonesList: [], allPhonesJoined: "" };

  // 用逗号、分号或换行符分割
  const parts = String(rawPhone).split(/[,;\n\r]+/);
  const phonesList: Array<{ label: string; number: string }> = [];

  parts.forEach(part => {
    const trimmed = part.trim();
    if (!trimmed) return;

    let label = "电话";
    let numStr = trimmed;

    // 匹配标签，如 "主要: +60..."
    const labelMatch = trimmed.match(/^([^:+0-9]+)\s*[:：]\s*(.+)$/);
    if (labelMatch) {
      label = labelMatch[1].trim();
      numStr = labelMatch[2].trim();
    }

    // 彻底擦除所有非数字字符（包含 + 符号），保持全网统一纯数字格式
    const cleanedDigits = numStr.replace(/[^\d]/g, "");
    
    if (cleanedDigits) {
      phonesList.push({ label, number: cleanedDigits });
    }
  });

  const allPhonesJoined = phonesList.map(p => p.number).join(",");
  const primary = phonesList.length > 0 ? allPhonesJoined : "";
  return { primary, phonesList, allPhonesJoined };
}

// ─── 主页面 ──────────────────────────────────────────────────────────────
export default function ContactsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [draftEdits, setDraftEdits] = useState<Record<string, Record<string, any>>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [addingColumn, setAddingColumn] = useState(false);
  const [showDirtyDialog, setShowDirtyDialog] = useState<{ action: "leave"; targetUrl?: string } | null>(null);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [availableFilters, setAvailableFilters] = useState<{ markets: string[], relations: string[], availableColumns: string[] }>({ markets: [], relations: [], availableColumns: [] });
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncingWhatsapp, setSyncingWhatsapp] = useState(false);
  const [showColSelector, setShowColSelector] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [reverseSyncing, setReverseSyncing] = useState(false);
  const [lastReverseSyncAt, setLastReverseSyncAt] = useState<string | null>(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [showForwardMappingModal, setShowForwardMappingModal] = useState(false);
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);
  
  // 多数据源状态
  const [dataSources, setDataSources] = useState<any[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("all");
  const [showExcelImportModal, setShowExcelImportModal] = useState(false);
  const [excelSourceName, setExcelSourceName] = useState("");
  const [excelDescription, setExcelDescription] = useState("");
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [importingExcel, setImportingExcel] = useState(false);

  // Excel 预检校验弹窗状态
  const [showExcelPreviewModal, setShowExcelPreviewModal] = useState(false);
  const [excelPreviewRows, setExcelPreviewRows] = useState<Array<{
    id: string;
    name: string;
    phone: string;
    rawPhone: string;
    market: string;
    relation: string;
    properties: Record<string, any>;
    selected: boolean;
  }>>([]);
  const [excelAllowNoPhone, setExcelAllowNoPhone] = useState(false);
  const [excelDuplicateStrategy, setExcelDuplicateStrategy] = useState<"SKIP" | "OVERWRITE" | "ALLOW">("ALLOW");
  const [excelPreviewSearch, setExcelPreviewSearch] = useState("");
  const [isMerging, setIsMerging] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSelectedSources, setMergeSelectedSources] = useState<string[]>([]);
  const [mergeTargetName, setMergeTargetName] = useState("");
  const [mergeSaveMode, setMergeSaveMode] = useState<"NEW" | "EXISTING">("NEW");
  const [mergeTargetSourceId, setMergeTargetSourceId] = useState<string>("");
  const [mergeAllColumns, setMergeAllColumns] = useState<string[]>([]);
  const [mergeColumnSettings, setMergeColumnSettings] = useState<Record<string, "MERGE" | "PRIMARY_ONLY">>({});
  const [mergeAutoSyncNotion, setMergeAutoSyncNotion] = useState<boolean>(true);

  // WhatsApp 直接导入状态
  const [showWhatsappImportModal, setShowWhatsappImportModal] = useState(false);
  const [whatsappInstances, setWhatsappInstances] = useState<any[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  const [whatsappImportForm, setWhatsappImportForm] = useState({
    name: "",
    description: "",
    instanceName: "all"
  });
  const [whatsappImportFields, setWhatsappImportFields] = useState<Array<{ key: string, value: string }>>([]);
  const [selectedSyncInstances, setSelectedSyncInstances] = useState<string[]>([]);
  const [importOnSave, setImportOnSave] = useState(false);

  // 新增：数据源导入模式和目标ID
  const [whatsappImportSourceId, setWhatsappImportSourceId] = useState<string>("whatsapp_sync");
  const [whatsappImportNewName, setWhatsappImportNewName] = useState<string>("");
  const [whatsappImportNewDesc, setWhatsappImportNewDesc] = useState<string>("");

  // 新增：去重和全新状态控制
  const [autoIgnoreExisting, setAutoIgnoreExisting] = useState<boolean>(false);
  const [showOnlyNewContacts, setShowOnlyNewContacts] = useState<boolean>(false);
  const [whatsappDuplicateStrategy, setWhatsappDuplicateStrategy] = useState<"ALLOW" | "MERGE" | "SKIP">("ALLOW");
  const [dbUnassignedCount, setDbUnassignedCount] = useState<number>(0);

  // WhatsApp 导入预览与多账号选择的增强状态
  const [previewContacts, setPreviewContacts] = useState<any[]>([]);
  const [fetchingPreview, setFetchingPreview] = useState(false);
  const [selectedPreviewPhones, setSelectedPreviewPhones] = useState<Set<string>>(new Set());
  const [previewFilterType, setPreviewFilterType] = useState<"ALL" | "INDIVIDUAL" | "GROUP">("ALL");
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewPage, setPreviewPage] = useState(1);
  const [previewPageSize] = useState(15);
  const [showAddFieldMenu, setShowAddFieldMenu] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());

  const PRESET_ADD_VARIABLES = useMemo(() => [
    { key: "WhatsApp昵称", value: "{pushName}", desc: "个人/群昵称" },
    { key: "是否保存好友", value: "{isSaved}", desc: "通讯录保存状态(是/否)" },
    { key: "类型", value: "{type}", desc: "账号类型(individual/group)" },
    { key: "是否群组", value: "{isGroup}", desc: "是否为群组(是/否)" },
    { key: "原始JID", value: "{jid}", desc: "WhatsApp 完整 JID" },
    { key: "市场", value: "{market}", desc: "识别国家地区(马来西亚/新加坡/中国等)" },
    { key: "国家区号", value: "{countryCode}", desc: "国际电话前缀(60/65/86等)" },
    { key: "规范号码", value: "{phone}", desc: "纯数字手机号/群号" },
    { key: "来源实例", value: "{instance}", desc: "导入来源账号实例名" },
    { key: "导入日期", value: "{date}", desc: "格式化导入日期" },
    { key: "导入时间", value: "{time}", desc: "格式化导入时间" }
  ], []);

  const filteredPreviewContacts = useMemo(() => {
    return previewContacts.filter(c => {
      const matchType = 
        previewFilterType === "ALL" ||
        (previewFilterType === "INDIVIDUAL" && !c.isGroup) ||
        (previewFilterType === "GROUP" && c.isGroup);
      
      const matchSearch = 
        !previewSearch ||
        c.name.toLowerCase().includes(previewSearch.toLowerCase()) ||
        c.phone.toLowerCase().includes(previewSearch.toLowerCase());

      const matchNewOnly = !showOnlyNewContacts || !c.exists;
      
      return matchType && matchSearch && matchNewOnly;
    });
  }, [previewContacts, previewFilterType, previewSearch, showOnlyNewContacts]);

  const selectedPreviewStats = useMemo(() => {
    const selectedList = previewContacts.filter(c => selectedPreviewPhones.has(c.phone));
    const total = selectedList.length;
    const groups = selectedList.filter(c => c.isGroup).length;
    const individuals = total - groups;
    return { total, groups, individuals };
  }, [previewContacts, selectedPreviewPhones]);



  // 批量修改状态
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkEditCol, setBulkEditCol] = useState("");
  const [bulkEditVal, setBulkEditVal] = useState("");
  const [bulkEditMode, setBulkEditMode] = useState<"OVERWRITE" | "APPEND" | "ADD_PREFIX" | "REMOVE_PREFIX">("OVERWRITE");
  const [isBulkEditing, setIsBulkEditing] = useState(false);

  // 批量拉黑确认状态
  const [showBatchBlacklistConfirm, setShowBatchBlacklistConfirm] = useState(false);
  const [isBatchBlacklisting, setIsBatchBlacklisting] = useState(false);

  // 列编辑与特定列批量修改状态
  const [colEditModalOpen, setColEditModalOpen] = useState(false);
  const [colEditOldName, setColEditOldName] = useState("");
  const [colEditNewName, setColEditNewName] = useState("");
  const [colEditEnableBulk, setColEditEnableBulk] = useState(false);
  const [colEditUniqueValues, setColEditUniqueValues] = useState<{ value: string; count: number }[]>([]);
  const [isLoadingColValues, setIsLoadingColValues] = useState(false);
  const [colEditSelectedValues, setColEditSelectedValues] = useState<string[]>([]);
  const [colEditBulkNewVal, setColEditBulkNewVal] = useState("");
  const [isColEditing, setIsColEditing] = useState(false);
  const colEditSelectedCountSum = useMemo(() => {
    return colEditUniqueValues
      .filter(item => colEditSelectedValues.includes(item.value))
      .reduce((sum, item) => sum + item.count, 0);
  }, [colEditUniqueValues, colEditSelectedValues]);
  const [showDataSourceConfigModal, setShowDataSourceConfigModal] = useState(false);
  const [showSourceSecret, setShowSourceSecret] = useState(false);
  const [dataSourceConfigForm, setDataSourceConfigForm] = useState({
    id: "",
    name: "",
    type: "NOTION",
    notionSecret: "",
    notionDatabaseId: "",
    notionSyncWebhookUrl: "",
    description: ""
  });
  const [savingDataSource, setSavingDataSource] = useState(false);
  
  // 同步倒数计时与状态提醒 states
  const [syncResult, setSyncResult] = useState<{
    type: 'FORWARD' | 'REVERSE' | 'WHATSAPP';
    success: boolean;
    message: string;
    detail?: string;
  } | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const [syncTimeLeft, setSyncTimeLeft] = useState(0);
  const [reverseSyncTimeLeft, setReverseSyncTimeLeft] = useState(0);
  
  // 移动端编辑联系人状态
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [tempName, setTempName] = useState("");
  const [tempPhone, setTempPhone] = useState("");
  const [tempMarket, setTempMarket] = useState("");
  const [tempRelation, setTempRelation] = useState("");
  const [tempProperties, setTempProperties] = useState<Record<string, string>>({});
  const [savingContact, setSavingContact] = useState(false);

  useEffect(() => {
    if (editingContact) {
      setTempName(editingContact.name || "");
      setTempPhone(editingContact.phone || "");
      setTempMarket(editingContact.market || "");
      
      let relVal = "";
      try {
        const parsed = JSON.parse(editingContact.relation || "[]");
        relVal = Array.isArray(parsed) ? parsed.join(", ") : editingContact.relation || "";
      } catch {
        relVal = editingContact.relation || "";
      }
      setTempRelation(relVal);

      const props: Record<string, string> = {};
      availableFilters.availableColumns.forEach(colName => {
        const val = editingContact.properties?.[colName];
        props[colName] = Array.isArray(val) ? val.join(", ") : val?.toString() || "";
      });
      setTempProperties(props);
    }
  }, [editingContact, availableFilters.availableColumns]);

  const handleSaveContactModal = async () => {
    if (!editingContact) return;
    const changedFields: { key: string, value: any }[] = [];

    if (tempName !== editingContact.name) changedFields.push({ key: "name", value: tempName });
    if (tempPhone !== editingContact.phone) changedFields.push({ key: "phone", value: tempPhone });
    if (tempMarket !== (editingContact.market || "")) changedFields.push({ key: "market", value: tempMarket });

    let relValInit = "";
    try {
      const parsed = JSON.parse(editingContact.relation || "[]");
      relValInit = Array.isArray(parsed) ? parsed.join(", ") : editingContact.relation || "";
    } catch {
      relValInit = editingContact.relation || "";
    }
    if (tempRelation !== relValInit) changedFields.push({ key: "relation", value: tempRelation });

    availableFilters.availableColumns.forEach(colName => {
      const initVal = editingContact.properties?.[colName];
      const initValStr = Array.isArray(initVal) ? initVal.join(", ") : initVal?.toString() || "";
      const currentVal = tempProperties[colName] || "";
      if (currentVal !== initValStr) {
        changedFields.push({ key: `prop_${colName}`, value: currentVal });
      }
    });

    if (changedFields.length === 0) {
      setEditingContact(null);
      return;
    }

    setSavingContact(true);
    try {
      for (const item of changedFields) {
        await handleCellEdit([editingContact.id], item.key, item.value);
      }
      setEditingContact(null);
    } catch (e: any) {
      alert("保存失败: " + e.message);
    } finally {
      setSavingContact(false);
    }
  };

  // AI 智能看板状态
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiAnalysisTime, setAiAnalysisTime] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState("gemini");
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-pro");
  const [useMarketData, setUseMarketData] = useState(true);
  const [useTagData, setUseTagData] = useState(true);
  const [useCampaignData, setUseCampaignData] = useState(true);
  const [useRespondedData, setUseRespondedData] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [customPrompt, setCustomPrompt] = useState(`你是一位顶级的私域流量与 WhatsApp 营销专家。
请根据我提供的客户数据（市场分布、标签分布、活动历史）进行深度分析。

【硬性要求】
1. 严禁说任何开场白、客套话或自我介绍（例如“好的”、“我理解了”、“作为专家...”等）。
2. 直接开始输出分析结果！
3. 分析结果必须包含：
   - 数据现状解读
   - 核心问题识别
   - 具体可执行的 WhatsApp 营销建议
4. 语言要专业、简练、直击痛点。`);

  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [isExecuting, setIsExecuting] = useState(false);
  const [selectedAiLists, setSelectedAiLists] = useState<string[]>(["市场", "关系"]);
  const [expandedAiList, setExpandedAiList] = useState<string | null>(null);
  const [selectedAiListTags, setSelectedAiListTags] = useState<{[key: string]: string[]}>({});
  const [showAiListSelector, setShowAiListSelector] = useState(false);

  const activeSource = useMemo(() => {
    return dataSources.find(ds => ds.id === selectedSourceId);
  }, [dataSources, selectedSourceId]);

  const sourceGroupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    groups.forEach(g => {
      try {
        const cfg = typeof g.filterConfig === 'string' ? JSON.parse(g.filterConfig) : g.filterConfig;
        const sId = cfg?.sourceId || "all";
        counts[sId] = (counts[sId] || 0) + 1;
      } catch {}
    });
    return counts;
  }, [groups]);

  const unassignedCount = useMemo(() => {
    if (selectedSourceId === "unassigned") {
      return total;
    }
    return dbUnassignedCount;
  }, [selectedSourceId, total, dbUnassignedCount]);

  const getGroupSourceInfo = (group: Group) => {
    try {
      const cfg = typeof group.filterConfig === 'string' ? JSON.parse(group.filterConfig) : group.filterConfig;
      const sourceId = cfg?.sourceId;
      if (!sourceId || sourceId === "all") {
        return {
          name: "🌐 所有联系人",
          dotColor: "bg-blue-500",
          type: "ALL"
        };
      }
      const ds = dataSources.find(d => d.id === sourceId);
      if (!ds) {
        return {
          name: "未知数据源",
          dotColor: "bg-slate-400",
          type: "UNKNOWN"
        };
      }
      let dotColor = "bg-slate-500";
      if (ds.type === "NOTION") dotColor = "bg-sky-500";
      else if (ds.type === "EXCEL") dotColor = "bg-amber-500";
      else if (ds.type === "WHATSAPP") dotColor = "bg-emerald-500";
      
      return {
        name: ds.name,
        dotColor,
        type: ds.type
      };
    } catch (e) {
      return {
        name: "解析失败",
        dotColor: "bg-red-400",
        type: "ERROR"
      };
    }
  };

  const getTagsForList = (listName: string) => {
    if (listName === "市场") return stats?.markets?.map((m: any) => m.name) || [];
    if (listName === "关系") return stats?.tags?.map((t: any) => t.name) || [];
    if (listName === "活动历史") return [];
    
    const uniqueValues = new Set<string>();
    contacts.forEach(c => {
      let props = c.properties;
      if (typeof props === 'string') {
        try { props = JSON.parse(props); } catch (e) { props = null; }
      }
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

  // 高级筛选状态
  const [selectedMarkets, setSelectedMarkets] = useState<string[]>([]);
  const [selectedRelations, setSelectedRelations] = useState<string[]>([]);
  const [matchMode, setMatchMode] = useState<"ANY" | "ALL">("ANY");
  const [ruleMatchMode, setRuleMatchMode] = useState<"AND" | "OR">("AND");
  const [filterSent, setFilterSent] = useState<"" | "true" | "false">("");
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [showExcludedModal, setShowExcludedModal] = useState(false);
  const [excludedContactsSearch, setExcludedContactsSearch] = useState("");
  const [editingGroup, setEditingGroup] = useState<{ id: string, name: string } | null>(null);

  const fetchContacts = async () => {
    setLoading(true);
    try {
      const params: any = { 
        page,
        limit: pageSize,
        markets: selectedMarkets.join(","),
        relations: selectedRelations.join(","),
        matchMode,
        ruleMatchMode,
        sent: filterSent,
        rules: filterRules,
        sourceId: selectedSourceId
      };
      const data = await contactsApi.list(params);
      setContacts(data.contacts);
      setTotal(data.total);
    } catch {
      setContacts([]);
    } finally { setLoading(false); }
  };

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
      // 刷新数据
      fetchData();
    } catch (e: any) {
      alert("执行失败: " + e.message);
    } finally {
      setIsExecuting(false);
    }
  };

  const fetchData = async () => {
    try {
      const fRes = await fetch(`/api/contacts/filters?sourceId=${selectedSourceId}`);
      const gRes = await fetch("/api/groups");
      const sRes = await fetch("/api/settings");
      const statsRes = await fetch("/api/contacts/stats");
      const dsRes = await fetch("/api/data-sources");
      
      if (fRes.ok) {
        const data = await fRes.json();
        setAvailableFilters(data);
        const cacheKey = `contacts_visible_columns_${selectedSourceId}`;
        const saved = localStorage.getItem(cacheKey);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              setVisibleColumns(parsed);
            } else {
              setVisibleColumns(data.availableColumns || []);
            }
          } catch {
            setVisibleColumns(data.availableColumns || []);
          }
        } else {
          setVisibleColumns(data.availableColumns || []);
        }
      }
      if (gRes.ok) setGroups(await gRes.json());
      if (dsRes.ok) setDataSources(await dsRes.json());
      if (sRes.ok) {
        const data = await sRes.json();
        setLastReverseSyncAt(data.lastReverseSyncAt);
        if (data.latestAiAnalysis) {
          setAiAnalysis(data.latestAiAnalysis);
        }
        if (data.latestAiAnalysisTime) {
          setAiAnalysisTime(data.latestAiAnalysisTime);
        }
      }
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData);
        // 默认选中所有市场和标签
        setSelectedAiListTags({
          "市场": statsData.markets.map((m: any) => m.name),
          "关系": statsData.tags.map((t: any) => t.name),
        });
      }
    } catch {}
  };


  useEffect(() => {
    const saved = localStorage.getItem("contacts_page_size");
    if (saved) setPageSize(Number(saved));
  }, []);

  useEffect(() => {
    setPage(1);
    setSelectedContactIds(new Set());
  }, [pageSize, selectedMarkets, selectedRelations, matchMode, ruleMatchMode, filterSent, filterRules, selectedSourceId]);

  useEffect(() => { 
    fetchContacts(); 
    fetchData();
  }, [page, pageSize, selectedMarkets, selectedRelations, matchMode, ruleMatchMode, filterSent, filterRules, selectedSourceId]);

  // 估算剩余时间与倒计时逻辑
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showResultModal && countdown > 0) {
      timer = setTimeout(() => {
        setCountdown(prev => prev - 1);
      }, 1000);
    } else if (showResultModal && countdown === 0) {
      setShowResultModal(false);
    }
    return () => clearTimeout(timer);
  }, [showResultModal, countdown]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (syncing && syncTimeLeft > 1) {
      interval = setInterval(() => {
        setSyncTimeLeft(prev => Math.max(1, prev - 1));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [syncing, syncTimeLeft]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (reverseSyncing && reverseSyncTimeLeft > 1) {
      interval = setInterval(() => {
        setReverseSyncTimeLeft(prev => Math.max(1, prev - 1));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [reverseSyncing, reverseSyncTimeLeft]);

  const handleSync = async (mapping: Record<string, string>, selectedFields: string[], purge = false) => {
    setSyncing(true);
    // 自动估算导入时间：每 80 条联系人估算 2 秒，最低 8 秒
    const estSec = Math.max(8, Math.ceil(total / 80) * 2);
    setSyncTimeLeft(estSec);
    setShowForwardMappingModal(false);

    try {
      const res = await contactsApi.sync(purge, { mapping, selectedFields, sourceId: selectedSourceId });
      setSyncResult({
        type: 'FORWARD',
        success: true,
        message: purge ? "旧数据已清除，重新从 Notion 拉取同步成功！" : `从 Notion 拉取同步成功！共导入/更新了 ${res.synced || 0} 个联系人。`
      });
      setCountdown(8); // 8 秒倒计时
      setShowResultModal(true);
      
      await fetchContacts();
      await fetchData();
    } catch (e: any) {
      setSyncResult({
        type: 'FORWARD',
        success: false,
        message: "从 Notion 拉取同步失败: " + e.message
      });
      setCountdown(10);
      setShowResultModal(true);
    } finally {
      setSyncing(false);
    }
  };

  const openWhatsappImport = async () => {
    const today = new Date().toISOString().slice(0, 10);
    setWhatsappImportForm({
      name: `WhatsApp导入_${today}`,
      description: "",
      instanceName: "all"
    });

    // 重置预览状态
    setPreviewContacts([]);
    setSelectedPreviewPhones(new Set());
    setPreviewSearch("");
    setPreviewFilterType("ALL");
    setPreviewPage(1);
    
    setWhatsappImportSourceId("whatsapp_sync");
    setWhatsappImportNewName(`WhatsApp导入_${today}`);
    setWhatsappImportNewDesc("");
    setAutoIgnoreExisting(false);
    setShowOnlyNewContacts(false);

    const saved = localStorage.getItem("whatsapp_import_fields_template");
    if (saved) {
      try {
        setWhatsappImportFields(JSON.parse(saved));
      } catch {
        setWhatsappImportFields([
          { key: "relation", value: "新名单" },
          { key: "是否有回应", value: "未回复" },
          { key: "导入日期", value: today },
          { key: "WhatsApp昵称", value: "{pushName}" },
          { key: "是否保存好友", value: "{isSaved}" },
          { key: "类型", value: "{type}" },
          { key: "是否群组", value: "{isGroup}" },
          { key: "原始JID", value: "{jid}" }
        ]);
      }
    } else {
      setWhatsappImportFields([
        { key: "relation", value: "新名单" },
        { key: "是否有回应", value: "未回复" },
        { key: "导入日期", value: today },
        { key: "WhatsApp昵称", value: "{pushName}" },
        { key: "是否保存好友", value: "{isSaved}" },
        { key: "类型", value: "{type}" },
        { key: "是否群组", value: "{isGroup}" },
        { key: "原始JID", value: "{jid}" }
      ]);
    }

    setShowWhatsappImportModal(true);
    setLoadingInstances(true);
    try {
      const res = await fetch("/api/instances");
      if (res.ok) {
        const list = await res.json();
        const activeInsts = list.filter((inst: any) => !inst.isOverQuota);
        setWhatsappInstances(activeInsts);
        setSelectedSyncInstances(activeInsts.map((inst: any) => inst.rawName || inst.name));
      }
    } catch (e) {
      console.error("加载实例失败", e);
    } finally {
      setLoadingInstances(false);
    }
  };

  const handleSaveFieldsTemplate = () => {
    localStorage.setItem("whatsapp_import_fields_template", JSON.stringify(whatsappImportFields));
    alert("当前属性标签配置已成功保存为默认模板，下次导入将自动加载！");
  };

  const handleRestoreDefaultFields = () => {
    if (confirm("确定要将属性配置恢复为系统内定默认值吗？这将覆盖您当前的所有改动。")) {
      const todayVal = new Date().toISOString().slice(0, 10);
      setWhatsappImportFields([
        { key: "relation", value: "新名单" },
        { key: "是否有回应", value: "未回复" },
        { key: "导入日期", value: todayVal },
        { key: "WhatsApp昵称", value: "{pushName}" },
        { key: "是否保存好友", value: "{isSaved}" },
        { key: "类型", value: "{type}" },
        { key: "是否群组", value: "{isGroup}" },
        { key: "原始JID", value: "{jid}" }
      ]);
    }
  };

  const handleAddFieldRow = () => {
    setWhatsappImportFields([...whatsappImportFields, { key: "", value: "" }]);
  };

  const handleAddPresetField = (presetKey: string, presetVal: string) => {
    const existingIdx = whatsappImportFields.findIndex(f => f.key === presetKey);
    if (existingIdx >= 0) {
      setWhatsappImportFields(prev => prev.map((f, i) => i === existingIdx ? { ...f, value: presetVal } : f));
    } else {
      setWhatsappImportFields(prev => [...prev, { key: presetKey, value: presetVal }]);
    }
    setShowAddFieldMenu(false);
  };

  const handleRemoveFieldRow = (index: number) => {
    setWhatsappImportFields(whatsappImportFields.filter((_, idx) => idx !== index));
  };

  const handleFieldChange = (index: number, field: "key" | "value", val: string) => {
    setWhatsappImportFields(prev => prev.map((item, idx) => {
      if (idx === index) {
        return { ...item, [field]: val };
      }
      return item;
    }));
  };

  const handleToggleAutoIgnoreExisting = (checked: boolean) => {
    setAutoIgnoreExisting(checked);
    setSelectedPreviewPhones(prev => {
      const next = new Set(prev);
      previewContacts.forEach(c => {
        if (c.exists) {
          if (checked) {
            next.delete(c.phone);
          } else {
            next.add(c.phone);
          }
        }
      });
      return next;
    });
  };

  const fetchWhatsappPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (whatsappImportSourceId === "new" && !whatsappImportNewName.trim()) {
      alert("请输入数据源名称！");
      return;
    }

    if (selectedSyncInstances.length === 0) {
      alert("请至少选择一个 WhatsApp 实例！");
      return;
    }

    setFetchingPreview(true);
    setPreviewContacts([]);
    setSelectedPreviewPhones(new Set());
    setPreviewPage(1);

    try {
      const res = await fetch("/api/contacts/sync-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preview: true,
          instanceName: selectedSyncInstances,
          defaultFields: whatsappImportFields
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取预览失败");

      const contactsList = data.contacts || [];
      setPreviewContacts(contactsList);
      
      const selectedPhones = new Set<string>();
      contactsList.forEach((c: any) => {
        if (autoIgnoreExisting && c.exists) {
          return;
        }
        selectedPhones.add(c.phone);
      });
      setSelectedPreviewPhones(selectedPhones);
    } catch (e: any) {
      alert("获取预览失败: " + e.message);
    } finally {
      setFetchingPreview(false);
    }
  };

  const triggerWhatsappSync = async () => {
    if (selectedPreviewPhones.size === 0) {
      alert("请至少勾选一位联系人进行导入！");
      return;
    }

    setSyncingWhatsapp(true);
    setShowWhatsappImportModal(false);

    try {
      const selectedContactsToImport = previewContacts.filter(c => selectedPreviewPhones.has(c.phone));

      const payload: any = {
        instanceName: selectedSyncInstances,
        defaultFields: whatsappImportFields,
        contacts: selectedContactsToImport,
        duplicateStrategy: whatsappDuplicateStrategy
      };

      if (whatsappImportSourceId === "new") {
        payload.sourceName = whatsappImportNewName;
        payload.description = whatsappImportNewDesc;
      } else {
        payload.sourceId = whatsappImportSourceId;
      }

      const res = await fetch("/api/contacts/sync-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");

      setSyncResult({
        type: 'WHATSAPP',
        success: true,
        message: data.summary || "WhatsApp 实例联系人导入成功！",
        detail: data.errors && data.errors.length > 0 ? data.errors.join("\n") : undefined
      });
      setCountdown(5);
      setShowResultModal(true);

      if (data.sourceId) {
        setSelectedSourceId(data.sourceId);
      }
      await fetchContacts();
      await fetchData();
    } catch (e: any) {
      setSyncResult({
        type: 'WHATSAPP',
        success: false,
        message: "导入失败: " + e.message
      });
      setCountdown(8);
      setShowResultModal(true);
    } finally {
      setSyncingWhatsapp(false);
    }
  };

  const fetchSyncLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetch("/api/sync-logs");
      if (res.ok) {
        setLogs(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch logs", e);
    } finally {
      setLoadingLogs(false);
    }
  };

  // 轮询后台反向同步日志
  const pollReverseSyncLog = (startTime: Date) => {
    let attempts = 0;
    const maxAttempts = 60; // 最多轮询 3 分钟 (60 次 * 3 秒)
    
    const interval = setInterval(async () => {
      attempts++;
      try {
        const logRes = await fetch("/api/sync-logs");
        if (logRes.ok) {
          const syncLogs = await logRes.json();
          const latestLog = syncLogs.find((log: any) => {
            return log.syncType === 'REVERSE_SYNC' && new Date(log.createdAt) >= startTime;
          });

          if (latestLog) {
            clearInterval(interval);
            setReverseSyncing(false);
            
            const isSuccess = latestLog.status === 'SUCCESS';
            setSyncResult({
              type: 'REVERSE',
              success: isSuccess,
              message: isSuccess ? "反向同步到 Notion 成功！" : "反向同步到 Notion 失败",
              detail: latestLog.summary || "详情请查看同步日志。"
            });
            setCountdown(8); // 8 秒后自动关闭
            setShowResultModal(true);

            await fetchContacts();
            await fetchData();
            setLogs(syncLogs);
            return;
          }
        }
      } catch (err) {
        console.error("Error polling logs", err);
      }

      if (attempts >= maxAttempts) {
        clearInterval(interval);
        setReverseSyncing(false);
        setSyncResult({
          type: 'REVERSE',
          success: false,
          message: "反向同步结果轮询超时",
          detail: "同步仍在后台进行中，请稍后打开同步日志面板确认最新状态。"
        });
        setCountdown(10);
        setShowResultModal(true);
      }
    }, 3000);
  };

  const confirmReverseSync = async (mapping: Record<string, string>, selectedFields: string[]) => {
    setReverseSyncing(true);
    // 估算反向同步时间：由于 Notion API 较慢，每条约 1.5 秒，最低 10 秒
    const estSec = Math.max(10, Math.ceil(total * 1.5));
    setReverseSyncTimeLeft(estSec);
    setShowMappingModal(false);

    const startTime = new Date();

    try {
      const res = await fetch("/api/contacts/reverse-sync", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mapping, selectedFields, sourceId: selectedSourceId })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "触发反向同步失败");
      }

      // 启动后台日志轮询
      pollReverseSyncLog(startTime);

    } catch (e: any) {
      setSyncResult({
        type: 'REVERSE',
        success: false,
        message: "启动反向同步失败: " + e.message
      });
      setCountdown(10);
      setShowResultModal(true);
      setReverseSyncing(false);
    }
  };

  const handleExcelImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!excelFile || !excelSourceName.trim()) {
      alert("请填写数据源名称并选择 Excel 文件");
      return;
    }
    setImportingExcel(true);
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: "binary" });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json<any>(ws);
          
          if (!data || data.length === 0) {
            throw new Error("Excel 文件中未读取到任何有效数据行");
          }

          const parsedRows = data.map((row: any, idx: number) => {
            const nameKey = Object.keys(row).find(k => k.includes("姓名") || k.includes("名字") || k.toLowerCase().includes("name") || k.includes("联系人")) || "";
            const phoneKey = Object.keys(row).find(k => k.includes("电话") || k.includes("手机") || k.toLowerCase().includes("phone") || k.toLowerCase().includes("mobile") || k.toLowerCase().includes("tel")) || "";
            const marketKey = Object.keys(row).find(k => k.includes("市场") || k.includes("国家") || k.includes("地区") || k.toLowerCase().includes("market") || k.toLowerCase().includes("country")) || "";
            const relationKey = Object.keys(row).find(k => k.includes("关系") || k.includes("标签") || k.toLowerCase().includes("relation") || k.toLowerCase().includes("tag")) || "";
            
            const rawPhoneVal = String(row[phoneKey] || "").trim();
            const { primary, phonesList } = cleanAndExtractPhones(rawPhoneVal);

            const properties: Record<string, any> = {
              all_phones: phonesList
            };
            
            Object.keys(row).forEach(k => {
              if (![nameKey, phoneKey, marketKey, relationKey].includes(k)) {
                properties[k] = row[k];
              }
            });

            return {
              id: `row_${idx}_${Math.random().toString(36).slice(2, 7)}`,
              name: row[nameKey] || "未命名",
              phone: primary,
              rawPhone: rawPhoneVal,
              market: row[marketKey] || "",
              relation: row[relationKey] || "",
              properties,
              selected: true
            };
          });

          setExcelPreviewRows(parsedRows);
          setShowExcelImportModal(false);
          setShowExcelPreviewModal(true);
        } catch (err: any) {
          alert("解析 Excel 失败: " + err.message);
        } finally {
          setImportingExcel(false);
        }
      };
      reader.readAsBinaryString(excelFile);
    } catch (err: any) {
      alert("读取文件失败: " + err.message);
      setImportingExcel(false);
    }
  };

  const handleUpdatePreviewPhone = (idx: number, newPhoneValue: string) => {
    const digitsOnly = newPhoneValue.replace(/[^\d]/g, "");
    setExcelPreviewRows(prev => {
      const next = [...prev];
      if (next[idx]) {
        next[idx] = {
          ...next[idx],
          phone: digitsOnly
        };
      }
      return next;
    });
  };

  // 计算当前预览列表中存在相同电话号码的分组 (包含 2 条、3 条或多条相同的重复记录 A, B, C...)
  const duplicateGroupsMap = useMemo(() => {
    const groups: Record<string, Array<{ row: (typeof excelPreviewRows)[0]; origIndex: number }>> = {};
    excelPreviewRows.forEach((r, idx) => {
      if (r.phone && r.selected) {
        if (!groups[r.phone]) groups[r.phone] = [];
        groups[r.phone].push({ row: r, origIndex: idx });
      }
    });
    return Object.entries(groups).filter(([_, list]) => list.length > 1);
  }, [excelPreviewRows]);

  const handleConfirmExcelImport = async () => {
    const finalContactsToImport = excelPreviewRows.filter(r => r.selected && (excelAllowNoPhone || !!r.phone));

    if (finalContactsToImport.length === 0) {
      alert("未勾选任何有效记录，请检查勾选或重试！");
      return;
    }

    setImportingExcel(true);
    try {
      const response = await fetch("/api/contacts/import-excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceName: excelSourceName.trim(),
          description: excelDescription.trim(),
          contacts: finalContactsToImport,
          duplicateStrategy: excelDuplicateStrategy
        })
      });

      const resData = await response.json();
      if (!response.ok) throw new Error(resData.error || "导入失败");

      alert(`🎉 导入成功！共写入/更新 ${resData.count} 位联系人。`);
      setShowExcelPreviewModal(false);
      setExcelFile(null);
      setExcelSourceName("");
      setExcelDescription("");

      const dsRes = await fetch("/api/data-sources");
      if (dsRes.ok) {
        setDataSources(await dsRes.json());
      }
      if (resData.sourceId) {
        setSelectedSourceId(resData.sourceId);
      }
      await fetchContacts();
      await fetchData();
    } catch (err: any) {
      alert("解析/导入 Excel 失败: " + err.message);
    } finally {
      setImportingExcel(false);
    }
  };

  const handleOpenMergeModal = async () => {
    // Reset priority arrays, target names, save mode, and auto-sync Notion check state.
    setMergeSelectedSources([]);
    setMergeTargetName(`去重合并_${new Date().toLocaleDateString()}`);
    setMergeSaveMode("NEW");
    setMergeTargetSourceId("");
    setMergeAutoSyncNotion(true);
    
    // Fetch custom column names and dynamic schema fields.
    try {
      const res = await fetch("/api/contacts/schema?sourceId=all");
      if (res.ok) {
        const data = await res.json();
        const dynamicFields = data.dynamicFields || [];
        const cols = ["姓名", "市场", "关系标签", ...dynamicFields.map((df: any) => df.name)];
        setMergeAllColumns(cols);
        
        // Initialize merge settings for each column to "MERGE"
        const initialSettings: Record<string, "MERGE" | "PRIMARY_ONLY"> = {};
        cols.forEach(col => {
          initialSettings[col] = "MERGE";
        });
        setMergeColumnSettings(initialSettings);
      }
    } catch (e) {
      console.error("加载字段列表失败", e);
    }
    
    setShowMergeModal(true);
  };

  const handleMergeDuplicates = async () => {
    if (mergeSelectedSources.length === 0) {
      alert("请选择至少一个要合并的数据库！");
      return;
    }
    if (mergeSaveMode === "NEW" && !mergeTargetName.trim()) {
      alert("请输入合并后的新数据库名称！");
      return;
    }
    if (mergeSaveMode === "EXISTING" && !mergeTargetSourceId) {
      alert("请选择覆盖的现有数据库！");
      return;
    }

    setIsMerging(true);
    try {
      const res = await fetch("/api/contacts/merge-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceIds: mergeSelectedSources,
          targetSourceName: mergeTargetName,
          saveMode: mergeSaveMode,
          targetSourceId: mergeTargetSourceId,
          columnSettings: mergeColumnSettings,
          autoSyncNotion: mergeAutoSyncNotion
        })
      });
      const data = await res.json();
      if (res.ok) {
        let successMsg = `智能去重合并完成！\n系统已成功合并去重了 ${data.mergedCount} 个重复项，包含 ${data.insertedCount} 个唯一的联系人记录。`;
        if (data.archivedCount > 0) {
          successMsg += `\n已在后台启动同步归档了 Notion 的 ${data.archivedCount} 个重复页面。`;
        }
        alert(successMsg);
        setShowMergeModal(false);
        fetchContacts();
        fetchData();
        if (data.newSourceId) {
          setSelectedSourceId(data.newSourceId);
        }
      } else {
        alert("去重合并失败: " + data.error);
      }
    } catch (e: any) {
      alert("网络错误，合并失败: " + e.message);
    } finally {
      setIsMerging(false);
    }
  };

  const handleBulkEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkEditCol) {
      alert("请选择要批量修改的列");
      return;
    }
    const colLabel = bulkEditCol === "market" ? "市场" : bulkEditCol === "relation" ? "关系标签" : bulkEditCol === "phone" ? "电话号码" : bulkEditCol === "name" ? "姓名" : bulkEditCol;
    const modeLabelMap: Record<string, string> = {
      OVERWRITE: "覆盖更新为",
      APPEND: "追加内容",
      ADD_PREFIX: "批量添加前缀",
      REMOVE_PREFIX: "批量移除前缀"
    };
    if (!confirm(`确定要将当前筛选出来的 ${total} 位联系人的「${colLabel}」以【${modeLabelMap[bulkEditMode] || "覆盖更新"}】模式修改为 "${bulkEditVal}" 吗？此操作不可撤销！`)) {
      return;
    }

    setIsBulkEditing(true);
    try {
      const res = await contactsApi.bulkEdit({
        field: bulkEditCol,
        value: bulkEditVal,
        editMode: bulkEditMode,
        markets: selectedMarkets,
        relations: selectedRelations,
        matchMode,
        ruleMatchMode,
        sent: filterSent,
        rules: filterRules,
        sourceId: selectedSourceId
      });
      if (res.success) {
        alert(`修改成功！共更新了 ${res.updatedCount} 位联系人。`);
        setShowBulkEditModal(false);
        setBulkEditVal("");
        fetchContacts();
        fetchData();
      }
    } catch (err: any) {
      alert("批量修改失败: " + err.message);
    } finally {
      setIsBulkEditing(false);
    }
  };

  const handleSaveDataSourceConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dataSourceConfigForm.name.trim()) {
      alert("请输入数据源名称");
      return;
    }
    setSavingDataSource(true);
    try {
      const isEdit = !!dataSourceConfigForm.id;
      const url = isEdit ? `/api/data-sources/${dataSourceConfigForm.id}` : "/api/data-sources";
      const method = isEdit ? "PUT" : "POST";
      
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataSourceConfigForm)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      
      alert(isEdit ? "配置更新成功！" : "新增数据库来源成功！");
      setShowDataSourceConfigModal(false);
      
      const dsRes = await fetch("/api/data-sources");
      if (dsRes.ok) {
        setDataSources(await dsRes.json());
      }
      
      const nextSourceId = isEdit ? dataSourceConfigForm.id : data.id;
      if (nextSourceId) {
        setSelectedSourceId(nextSourceId);
      }

      if (importOnSave && nextSourceId) {
        setTimeout(() => {
          setShowForwardMappingModal(true);
        }, 300);
      }
    } catch (err: any) {
      alert("操作失败: " + err.message);
    } finally {
      setSavingDataSource(false);
      setImportOnSave(false);
    }
  };

  const handleSaveGroup = async (isUpdate: boolean = false) => {
    const name = isUpdate ? editingGroup?.name : prompt("请输入人群包名称:");
    if (!name) return;
    
    try {
      const result = await fetch("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          id: isUpdate ? editingGroup?.id : null,
          isUpdate,
          name: name,
          filterConfig: { 
            sourceId: selectedSourceId !== "all" ? selectedSourceId : undefined,
            markets: selectedMarkets, 
            relations: selectedRelations, 
            matchMode, 
            ruleMatchMode,
            sent: filterSent,
            rules: filterRules,
            excludedIds: Array.from(excludedIds)
          }
        })
      });
      const data = await result.json();
      if (data.success) {
        alert(isUpdate ? `群组 "${name}" 已更新！` : `群组 "${name}" 已保存！`);
        if (!isUpdate) {
          setEditingGroup({ id: data.id, name: name });
        }
        fetchData();
      }
    } catch (e: any) {
      alert("操作失败: " + (e.message || "未知错误"));
    }
  };

  const handleDeleteGroup = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("确定要删除这个人群包吗？此操作不可撤销。")) return;
    try {
      const res = await fetch(`/api/groups?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        if (editingGroup?.id === id) setEditingGroup(null);
        fetchData();
      }
    } catch (e: any) { alert("删除失败: " + e.message); }
  };

  const handleCellEdit = async (rowIds: string[], columnKey: string, newValue: any) => {
    try {
      const actualKey = columnKey.startsWith("prop_") ? columnKey.substring(5) : columnKey;
      let finalValue = newValue;
      
      // 特殊处理 relation 字段，如果不是 JSON 数组，尝试从逗号分隔的文本转换成 JSON 数组
      if (actualKey === "relation") {
        try {
          const parsed = JSON.parse(newValue);
          if (!Array.isArray(parsed)) throw new Error();
        } catch {
          const tags = newValue.split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
          finalValue = JSON.stringify(tags);
        }
      }

      setDraftEdits(prev => {
        const next = { ...prev };
        rowIds.forEach(id => {
          if (!next[id]) next[id] = {};
          next[id][columnKey] = finalValue;
        });
        return next;
      });
      setHasChanges(true);
    } catch (e: any) {
      alert("编辑暂存失败: " + e.message);
      throw e;
    }
  };

  const handleDiscardEdits = () => {
    if (confirm("确定要丢弃当前所有未保存的数据修改吗？")) {
      setDraftEdits({});
      setHasChanges(false);
    }
  };

  const handleSaveEdits = async () => {
    setLoading(true);
    try {
      const batchPayload: any[] = [];
      const fieldGroups: Record<string, Record<string, string[]>> = {};

      Object.keys(draftEdits).forEach(contactId => {
        const edits = draftEdits[contactId];
        Object.keys(edits).forEach(columnKey => {
          const val = edits[columnKey];
          const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
          
          if (!fieldGroups[columnKey]) {
            fieldGroups[columnKey] = {};
          }
          if (!fieldGroups[columnKey][valStr]) {
            fieldGroups[columnKey][valStr] = [];
          }
          fieldGroups[columnKey][valStr].push(contactId);
        });
      });

      Object.keys(fieldGroups).forEach(columnKey => {
        const actualKey = columnKey.startsWith("prop_") ? columnKey.substring(5) : columnKey;
        const valMap = fieldGroups[columnKey];
        Object.keys(valMap).forEach(valStr => {
          let value: any = valStr;
          if (actualKey === "relation") {
            try { value = JSON.parse(valStr); } catch {}
          } else if (valStr === "true") {
            value = true;
          } else if (valStr === "false") {
            value = false;
          }

          batchPayload.push({
            contactIds: valMap[valStr],
            field: actualKey,
            value: value
          });
        });
      });

      if (batchPayload.length > 0) {
        const res = await fetch("/api/contacts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch: batchPayload })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "保存修改失败");
      }

      alert("修改已成功保存至数据库！");
      setDraftEdits({});
      setHasChanges(false);
      
      await fetchContacts();
      await fetchData();
    } catch (e: any) {
      alert("保存失败: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = async () => {
    if (total === 0) {
      alert("当前没有可导出的联系人数据！");
      return;
    }
    setExporting(true);
    try {
      const params: any = { 
        page: 1,
        limit: total,
        markets: selectedMarkets.join(","),
        relations: selectedRelations.join(","),
        matchMode,
        ruleMatchMode,
        sent: filterSent,
        rules: filterRules,
        sourceId: selectedSourceId
      };
      const data = await contactsApi.list(params);
      const allFilteredContacts = data.contacts;

      const excelRows = allFilteredContacts.map(c => {
        const row: Record<string, any> = {
          "姓名": c.name,
          "电话号码": c.phone,
          "市场": c.market || "",
          "关系标签": (() => {
            try {
              const tags = JSON.parse(c.relation || "[]");
              return Array.isArray(tags) ? tags.join(", ") : c.relation;
            } catch {
              return c.relation || "";
            }
          })(),
          "发送状态": c.sent ? "已发送" : "待发送",
          "回复状态": c.responded ? "已回复" : "未回复",
        };

        if (c.properties && typeof c.properties === 'object') {
          Object.keys(c.properties).forEach(key => {
            if (key !== "all_phones") {
              const val = c.properties[key];
              row[key] = Array.isArray(val) ? val.join(", ") : val;
            }
          });
        }
        return row;
      });

      const worksheet = XLSX.utils.json_to_sheet(excelRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "联系人名单");
      const fileName = `联系人导出_${new Date().toISOString().slice(0, 10)}.xlsx`;
      XLSX.writeFile(workbook, fileName);
    } catch (e: any) {
      alert("导出失败: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleBatchBlacklist = async () => {
    const contactsToBlacklist = contacts.filter(c => selectedContactIds.has(c.id));

    if (contactsToBlacklist.length === 0) {
      alert("请先勾选需要拉黑的联系人！");
      return;
    }

    setIsBatchBlacklisting(true);
    try {
      const contactsToPost = contactsToBlacklist.map(c => ({
        phone: c.phone,
        name: c.name || "",
        reason: "用户手动批量拉黑"
      }));

      const res = await blacklistApi.addBatch(contactsToPost);
      if (res.success) {
        alert(`✓ 成功将 ${contactsToBlacklist.length} 位联系人移入黑名单！`);
        setSelectedContactIds(new Set());
        setExcludedIds(new Set());
        setShowBatchBlacklistConfirm(false);
        await fetchContacts();
      } else {
        alert("批量拉黑失败");
      }
    } catch (err: any) {
      alert("操作失败: " + err.message);
    } finally {
      setIsBatchBlacklisting(false);
    }
  };

  const handleBatchDelete = async () => {
    const contactsToDelete = contacts.filter(c => selectedContactIds.has(c.id));

    if (contactsToDelete.length === 0) {
      alert("请先勾选需要删除的联系人！");
      return;
    }

    const count = contactsToDelete.length;
    if (!confirm(`确定要彻底删除选中的 ${count} 位联系人吗？此操作不可撤销！`)) {
      return;
    }

    try {
      const idsArr = contactsToDelete.map(c => c.id);
      const res = await fetch("/api/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: idsArr })
      });
      if (res.ok) {
        alert(`✓ 成功批量删除 ${count} 位联系人！`);
        setContacts(prev => prev.filter(c => !idsArr.includes(c.id)));
        setTotal(t => Math.max(0, t - count));
        setSelectedContactIds(new Set());
      } else {
        const err = await res.json();
        alert("批量删除失败: " + (err.error || "未知错误"));
      }
    } catch (e: any) {
      alert("批量删除失败: " + e.message);
    }
  };

  const handleAddColumn = async () => {
    if (!newColName.trim()) {
      alert("请输入列名！");
      return;
    }
    const cleanName = newColName.trim();
    setAddingColumn(true);
    try {
      const res = await fetch("/api/contacts/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ADD", name: cleanName })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "添加列失败");
      
      alert(`自定义列「${cleanName}」创建成功！`);
      setNewColName("");
      
      await fetchData();
      await fetchContacts();
      
      setVisibleColumns(prev => {
        if (prev.includes(cleanName)) return prev;
        const next = [...prev, cleanName];
        localStorage.setItem(`contacts_visible_columns_${selectedSourceId}`, JSON.stringify(next));
        return next;
      });
    } catch (e: any) {
      alert("添加列失败: " + e.message);
    } finally {
      setAddingColumn(false);
    }
  };

  const handleRenameColumn = async (oldName: string) => {
    setColEditOldName(oldName);
    setColEditNewName(oldName);
    setColEditEnableBulk(false);
    setColEditUniqueValues([]);
    setColEditSelectedValues([]);
    setColEditBulkNewVal("");
    setColEditModalOpen(true);

    setIsLoadingColValues(true);
    try {
      const res = await fetch("/api/contacts/column-values", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          field: oldName,
          markets: selectedMarkets,
          relations: selectedRelations,
          matchMode,
          ruleMatchMode,
          sent: filterSent,
          rules: filterRules,
          sourceId: selectedSourceId
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const sorted = data.values.sort((a: any, b: any) => {
            if (a.value === "__EMPTY__") return -1;
            if (b.value === "__EMPTY__") return 1;
            return String(a.value).localeCompare(String(b.value));
          });
          setColEditUniqueValues(sorted);
        }
      }
    } catch (e) {
      console.error("加载列数值失败", e);
    } finally {
      setIsLoadingColValues(false);
    }
  };

  const handleColEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!colEditNewName.trim()) {
      alert("请输入列名称");
      return;
    }
    const cleanNewName = colEditNewName.trim();
    const nameChanged = cleanNewName !== colEditOldName;
    
    setIsColEditing(true);
    try {
      // 1. 如果修改了列名，执行重命名 API
      if (nameChanged) {
        const res = await fetch("/api/contacts/schema", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "RENAME", name: colEditOldName, newName: cleanNewName })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "重命名列失败");
      }

      // 2. 如果勾选了批量修改该列数据，执行 bulkEdit API
      if (colEditEnableBulk) {
        if (colEditSelectedValues.length === 0) {
          throw new Error("请至少选择一个要修改的数据值范围");
        }
        const targetCol = nameChanged ? cleanNewName : colEditOldName;
        
        const res = await contactsApi.bulkEdit({
          field: targetCol,
          value: colEditBulkNewVal,
          markets: selectedMarkets,
          relations: selectedRelations,
          matchMode,
          ruleMatchMode,
          sent: filterSent,
          rules: filterRules,
          sourceId: selectedSourceId,
          targetValues: colEditSelectedValues
        });
        
        if (res.success) {
          alert(`修改成功！共更新了 ${res.updatedCount} 位联系人。`);
        } else {
          throw new Error("批量更新列数据失败");
        }
      } else {
        if (nameChanged) {
          alert(`列「${colEditOldName}」已成功重命名为「${cleanNewName}」！`);
        }
      }

      setColEditModalOpen(false);
      
      await fetchData();
      await fetchContacts();
      
      if (nameChanged) {
        setVisibleColumns(prev => {
          const next = prev.map(c => c === colEditOldName ? cleanNewName : c);
          localStorage.setItem(`contacts_visible_columns_${selectedSourceId}`, JSON.stringify(next));
          return next;
        });
      }
    } catch (e: any) {
      alert("保存失败: " + e.message);
    } finally {
      setIsColEditing(false);
    }
  };

  const handleDeleteColumn = async (name: string) => {
    if (!confirm(`确定要删除列「${name}」吗？这将同时清空数据库中所有联系人在该列的数据，此操作不可逆！`)) return;
    
    setAddingColumn(true);
    try {
      const res = await fetch("/api/contacts/schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DELETE", name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除列失败");
      
      alert(`自定义列「${name}」已成功删除！`);
      
      await fetchData();
      await fetchContacts();
      
      setVisibleColumns(prev => {
        const next = prev.filter(c => c !== name);
        localStorage.setItem(`contacts_visible_columns_${selectedSourceId}`, JSON.stringify(next));
        return next;
      });
    } catch (e: any) {
      alert("删除列失败: " + e.message);
    } finally {
      setAddingColumn(false);
    }
  };

  const handleDirtyLeave = async (action: "save" | "discard" | "cancel") => {
    if (!showDirtyDialog) return;
    const targetUrl = showDirtyDialog.targetUrl;
    
    if (action === "save") {
      setLoading(true);
      try {
        const batchPayload: any[] = [];
        const fieldGroups: Record<string, Record<string, string[]>> = {};

        Object.keys(draftEdits).forEach(contactId => {
          const edits = draftEdits[contactId];
          Object.keys(edits).forEach(columnKey => {
            const val = edits[columnKey];
            const valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
            
            if (!fieldGroups[columnKey]) {
              fieldGroups[columnKey] = {};
            }
            if (!fieldGroups[columnKey][valStr]) {
              fieldGroups[columnKey][valStr] = [];
            }
            fieldGroups[columnKey][valStr].push(contactId);
          });
        });

        Object.keys(fieldGroups).forEach(columnKey => {
          const actualKey = columnKey.startsWith("prop_") ? columnKey.substring(5) : columnKey;
          const valMap = fieldGroups[columnKey];
          Object.keys(valMap).forEach(valStr => {
            let value: any = valStr;
            if (actualKey === "relation") {
              try { value = JSON.parse(valStr); } catch {}
            } else if (valStr === "true") {
              value = true;
            } else if (valStr === "false") {
              value = false;
            }

            batchPayload.push({
              contactIds: valMap[valStr],
              field: actualKey,
              value: value
            });
          });
        });

        if (batchPayload.length > 0) {
          const res = await fetch("/api/contacts", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ batch: batchPayload })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "保存修改失败");
        }

        setDraftEdits({});
        setHasChanges(false);
        
        setShowDirtyDialog(null);
        if (targetUrl) {
          router.push(targetUrl);
        }
      } catch (e: any) {
        alert("保存失败: " + e.message);
      } finally {
        setLoading(false);
      }
    } else if (action === "discard") {
      setDraftEdits({});
      setHasChanges(false);
      setShowDirtyDialog(null);
      if (targetUrl) {
        router.push(targetUrl);
      }
    } else {
      setShowDirtyDialog(null);
    }
  };

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = ""; 
      }
    };
    
    const handleAnchorClick = (e: MouseEvent) => {
      if (!hasChanges) return;
      
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      
      if (anchor) {
        const href = anchor.getAttribute("href");
        if (!href || href === "#" || href.startsWith("javascript:") || href.startsWith("#")) return;
        if (anchor.getAttribute("target") === "_blank") return;
        
        e.preventDefault();
        e.stopPropagation();
        setShowDirtyDialog({ action: "leave", targetUrl: href });
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleAnchorClick, true);
    
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleAnchorClick, true);
    };
  }, [hasChanges, router]);

  const mergedContacts = useMemo(() => {
    return contacts.map(c => {
      const draft = draftEdits[c.id];
      if (!draft) return c;
      
      const nextProps = { ...c.properties };
      let nextC = { ...c };
      
      Object.keys(draft).forEach(key => {
        const val = draft[key];
        if (key.startsWith("prop_")) {
          const propName = key.substring(5);
          nextProps[propName] = val;
        } else {
          nextC = { ...nextC, [key]: val };
        }
      });
      
      return { ...nextC, properties: nextProps };
    });
  }, [contacts, draftEdits]);

  const baseColumns: Column<Contact>[] = [
    {
      key: "selection",
      header: (
        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => {
              const currentPageIds = contacts.map(c => c.id);
              const allOnPageSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedContactIds.has(id));
              const next = new Set(selectedContactIds);
              if (allOnPageSelected) {
                currentPageIds.forEach(id => next.delete(id));
              } else {
                currentPageIds.forEach(id => next.add(id));
              }
              setSelectedContactIds(next);
            }}
            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all cursor-pointer ${
              contacts.length > 0 && contacts.every(c => selectedContactIds.has(c.id))
                ? "bg-blue-600 border-blue-600"
                : "border-slate-300 bg-white"
            }`}
            title="全选/取消全选本页"
          >
            {contacts.length > 0 && contacts.every(c => selectedContactIds.has(c.id)) && <Check className="w-3.5 h-3.5 text-white" />}
          </button>
        </div>
      ),
      width: "60px",
      render: (row) => {
        const isSelected = selectedContactIds.has(row.id);
        return (
          <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={() => {
                const next = new Set(selectedContactIds);
                if (isSelected) next.delete(row.id);
                else next.add(row.id);
                setSelectedContactIds(next);
              }}
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all cursor-pointer ${isSelected ? "bg-blue-600 border-blue-600" : "border-slate-300 bg-white"}`}
            >
              {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
            </button>
          </div>
        );
      }
    },
    { 
      key: "name", 
      header: "姓名", 
      editable: true, 
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-bold text-slate-900">{row.name}</span>
          {row.isHistoricallyBlacklisted ? (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                ⚠️ 曾拉黑历史
              </span>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  if (confirm(`确定要洗白此联系人吗？系统将从历史删除记录中将其移除，使其恢复为普通状态。`)) {
                    try {
                      await blacklistApi.clearHistoryBatch([row.id || row.phone]);
                      alert("✓ 洗白成功！");
                      setContacts(prev => prev.map(c => c.id === row.id ? { ...c, isHistoricallyBlacklisted: 0 } : c));
                    } catch (err) {
                      alert("洗白失败");
                    }
                  }
                }}
                className="text-[10px] font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
              >
                洗白
              </button>
            </div>
          ) : null}
        </div>
      ) 
    },
    { key: "phone", header: "电话", editable: true, render: (row) => <span className="font-mono text-slate-800">{row.phone}</span> },
    { 
      key: "market", 
      header: "市场", 
      editable: true, 
      render: (row) => {
        const displayMarket = row.market || row.properties?.["市场"] || row.properties?.["market"] || "—";
        return <span className="text-blue-700 font-bold">{displayMarket}</span>;
      } 
    },
    { 
      key: "relation", 
      header: "关系标签", 
      editable: true,
      getEditValue: (row) => {
        try {
          const tags = JSON.parse(row.relation || "[]");
          return tags.join(", ");
        } catch {
          return row.relation || "";
        }
      },
      render: (row) => {
        try {
          const tags = JSON.parse(row.relation || "[]");
          return (
            <div className="flex flex-wrap gap-1">
              {tags.map((t: string) => <span key={t} className="text-[10px] font-black bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">{t}</span>)}
              {tags.length === 0 && "—"}
            </div>
          );
        } catch { return <span className="text-purple-700 font-bold">{row.relation || "—"}</span>; }
      }
    },
    {
      key: "sent",
      header: "发送状态",
      render: (row) => (
        <span className={`px-2 py-1 rounded-lg text-xs font-black ${row.sent ? "bg-green-100 text-green-800 border-2 border-green-200" : "bg-slate-100 text-slate-500 border-2 border-slate-200"}`}>
          {row.sent ? "✓ 已发送" : "○ 待发送"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "操作",
      width: "120px",
      render: (row) => {
        const isExcluded = excludedIds.has(row.id);
        return (
          <div className="flex items-center gap-1.5">
            {isExcluded ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const next = new Set(excludedIds);
                  next.delete(row.id);
                  setExcludedIds(next);
                }}
                className="p-1 hover:bg-amber-50 text-amber-700 hover:text-amber-800 rounded-lg transition-colors flex items-center gap-0.5 font-bold text-xs cursor-pointer"
                title="将此联系人加回当前人群包"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-amber-700">加回</span>
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const next = new Set(excludedIds);
                  next.add(row.id);
                  setExcludedIds(next);
                }}
                className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors flex items-center gap-0.5 font-bold text-xs cursor-pointer"
                title="从当前人群包排除此联系人"
              >
                <UserX className="w-3.5 h-3.5 text-red-500" />
                <span className="text-red-500">剔除</span>
              </button>
            )}

            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (confirm(`确定要彻底删除联系人「${row.name || row.phone}」吗？此操作不可撤销！`)) {
                  try {
                    const res = await fetch("/api/contacts", {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ contactIds: [row.id] })
                    });
                    if (res.ok) {
                      setContacts(prev => prev.filter(c => c.id !== row.id));
                      setTotal(t => Math.max(0, t - 1));
                    } else {
                      const err = await res.json();
                      alert("删除失败: " + (err.error || "未知错误"));
                    }
                  } catch (err: any) {
                    alert("删除失败: " + err.message);
                  }
                }
              }}
              className="p-1 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors flex items-center gap-0.5 font-bold text-xs"
              title="彻底删除单条联系人"
            >
              <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" />
            </button>
          </div>
        );
      }
    }
  ];

  const dynamicColumns: Column<Contact>[] = visibleColumns.map(colName => ({
    key: `prop_${colName}`,
    header: colName,
    editable: true,
    render: (row) => {
      const val = row.properties?.[colName];
      if (Array.isArray(val)) return val.join(", ");
      return val?.toString() || "—";
    }
  }));

  const columns = [...baseColumns, ...dynamicColumns];

  const toggleColumn = (col: string) => {
    const next = visibleColumns.includes(col) 
      ? visibleColumns.filter(c => c !== col) 
      : [...visibleColumns, col];
    setVisibleColumns(next);
    localStorage.setItem(`contacts_visible_columns_${selectedSourceId}`, JSON.stringify(next));
  };

  const toggleAllColumns = () => {
    const all = availableFilters.availableColumns;
    const next = visibleColumns.length === all.length ? [] : [...all];
    setVisibleColumns(next);
    localStorage.setItem(`contacts_visible_columns_${selectedSourceId}`, JSON.stringify(next));
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 pb-16" onClick={() => setShowColSelector(false)}>
      {/* 桌面端左侧侧边栏 (单独特有) */}
      <aside className="hidden lg:block w-72 flex-shrink-0 space-y-6">
        <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-sm p-4 lg:p-6">
          <h3 className="font-black text-slate-900 text-lg flex items-center justify-between gap-2 mb-4 lg:mb-6 text-emerald-700">
            <span className="flex items-center gap-2">
              <Tag className="w-5 h-5" /> 已存人群包
            </span>
            {selectedSourceId !== "all" && (
              <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-mono">
                当前源: {dataSources.find(d => d.id === selectedSourceId)?.name || selectedSourceId}
              </span>
            )}
          </h3>
          <div className="space-y-2">
            {(() => {
              const sortedGroups = [...groups].sort((a, b) => {
                const cfgA = typeof a.filterConfig === 'string' ? JSON.parse(a.filterConfig) : a.filterConfig;
                const cfgB = typeof b.filterConfig === 'string' ? JSON.parse(b.filterConfig) : b.filterConfig;
                const sA = cfgA?.sourceId || "all";
                const sB = cfgB?.sourceId || "all";
                const matchA = sA === selectedSourceId;
                const matchB = sB === selectedSourceId;
                if (matchA && !matchB) return -1;
                if (!matchA && matchB) return 1;
                return 0;
              });

              const filteredGroups = sortedGroups.filter(g => {
                if (selectedSourceId === "all") return true;
                const cfg = typeof g.filterConfig === 'string' ? JSON.parse(g.filterConfig) : g.filterConfig;
                const groupSourceId = cfg?.sourceId || "all";
                return groupSourceId === selectedSourceId;
              });

              if (filteredGroups.length === 0) {
                return (
                  <div className="text-center py-4 px-2 text-xs font-bold text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    {selectedSourceId === "all" ? "暂无人群包，配置好筛选条件后点击「保存此人群包」" : "此数据源下暂无独立人群包"}
                  </div>
                );
              }

              return filteredGroups.map((g) => {
                const cfg = typeof g.filterConfig === 'string' ? JSON.parse(g.filterConfig) : g.filterConfig;
                const groupSourceId = cfg?.sourceId || "all";
                const isCurrentSource = selectedSourceId !== "all" 
                  ? groupSourceId === selectedSourceId
                  : groupSourceId === "all";
                const sourceInfo = getGroupSourceInfo(g);
                const isActive = editingGroup?.id === g.id;

                return (
                  <button 
                    key={g.id} 
                    onClick={() => {
                      setSelectedContactIds(new Set());
                      if (isActive) {
                        // 取消选中人群包：保持在当前数据源，仅清空编辑状态与筛选条件，不跳回“所有联系人”
                        setEditingGroup(null);
                        setSelectedMarkets([]);
                        setSelectedRelations([]);
                        setMatchMode("ANY");
                        setRuleMatchMode("AND");
                        setFilterSent("");
                        setFilterRules([]);
                        setExcludedIds(new Set());
                      } else {
                        // 选择人群包：加载该人群包的筛选规则，并同步切换至其绑定的数据源
                        setSelectedMarkets(cfg.markets || []);
                        setSelectedRelations(cfg.relations || []);
                        setMatchMode(cfg.matchMode || "ANY");
                        setRuleMatchMode(cfg.ruleMatchMode || "AND");
                        setFilterSent(cfg.sent || "");
                        setFilterRules(cfg.rules || []);
                        setExcludedIds(new Set(cfg.excludedIds || []));
                        setEditingGroup({ id: g.id, name: g.name });
                        setSelectedSourceId(cfg.sourceId || "all");
                      }
                    }} 
                    className={`w-full flex items-center justify-between p-3 rounded-xl text-sm font-black transition-all group border-2 shadow-sm ${
                      isActive 
                        ? "bg-blue-600 text-white border-blue-400" 
                        : isCurrentSource
                          ? "text-slate-900 bg-white border-blue-200 hover:border-blue-400 hover:bg-blue-50/50"
                          : "text-slate-500 bg-slate-50/80 border-transparent hover:bg-slate-100"
                    }`}
                  >
                    <div className="flex flex-col items-start gap-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 w-full">
                        <span className="truncate">{g.name}</span>
                        {isCurrentSource && !isActive && (
                          <span className="text-[9px] font-black bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded flex-shrink-0">
                            当前源
                          </span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md flex-shrink-0 ${isActive ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                          {(g as any).contactCount || 0}
                        </span>
                      </div>
                      {/* Source display */}
                      <div className="flex items-center gap-1.5 text-[10px] font-bold">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isActive ? "bg-blue-200" : sourceInfo.dotColor}`} />
                        <span className={`truncate ${isActive ? "text-blue-100" : "text-slate-400 font-medium"}`}>
                          {sourceInfo.name}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button 
                        onClick={(e) => handleDeleteGroup(e, g.id)}
                        className={`p-1.5 rounded-lg opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity ${isActive ? "hover:bg-blue-700 text-white" : "hover:bg-red-50 text-red-500"}`}
                        title="删除人群包"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                      <ChevronRight className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-white" : "text-slate-300"}`} />
                    </div>
                  </button>
                );
              });
            })()}
          </div>
        </div>

        <div className="bg-blue-700 rounded-2xl p-4 lg:p-6 text-white shadow-xl">
          <div className="flex items-center gap-2 mb-2 lg:mb-4 opacity-80">
            <BarChart2 className="w-5 h-5" />
            <span className="text-[10px] font-black uppercase tracking-widest">匹配人数</span>
          </div>
          <div className="text-3xl lg:text-5xl font-black mb-1">{total}</div>
          <div className="text-xs font-bold opacity-90">符合当前复杂规则</div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 space-y-6">
        {/* 多租户隔离指示器 */}
        <div className="flex items-center justify-between px-6 py-3 bg-blue-50 border-2 border-blue-100 rounded-2xl shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-black text-xs">
              {(session?.user?.name?.charAt(0) || "U").toUpperCase()}
            </div>
            <div>
              <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">当前隔离系统</p>
              <p className="text-sm font-black text-slate-900">{session?.user?.name || "User"} ({session?.user?.role || "operator"})</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-white rounded-lg border border-blue-200">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            <span className="text-[10px] font-bold text-slate-500">数据已加密隔离</span>
          </div>
        </div>

        <header className="flex flex-col gap-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl md:text-3xl font-black tracking-tighter text-slate-950">
                  {selectedSourceId === "all" ? "🌐 所有联系人" : activeSource?.name || "联系人"}
                </h1>
                <select
                  value={selectedSourceId}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "ADD_NOTION") {
                      setDataSourceConfigForm({
                        id: "",
                        name: "",
                        type: "NOTION",
                        notionSecret: "",
                        notionDatabaseId: "",
                        notionSyncWebhookUrl: "",
                        description: ""
                      });
                      setShowSourceSecret(false);
                      setShowDataSourceConfigModal(true);
                    } else if (val === "IMPORT_EXCEL") {
                      setShowExcelImportModal(true);
                    } else if (val === "SYNC_WHATSAPP") {
                      openWhatsappImport();
                    } else {
                      // 选择数据源时：关联人群包全部自动置顶（浅蓝色），不做自动强行选中，保持数据源全量展示
                      setSelectedSourceId(val);
                      setEditingGroup(null);
                      setSelectedMarkets([]);
                      setSelectedRelations([]);
                      setFilterRules([]);
                      setExcludedIds(new Set());
                      setFilterSent("");
                      setMatchMode("ANY");
                      setRuleMatchMode("AND");
                      setSelectedContactIds(new Set());
                    }
                  }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-800 font-black text-xs md:text-sm px-3 py-2 rounded-xl border border-slate-300 focus:outline-none cursor-pointer"
                >
                  <option value="all">
                    🌐 所有联系人 (合并视图{sourceGroupCounts["all"] ? ` · ${sourceGroupCounts["all"]} 个人群包` : ""})
                  </option>
                  <optgroup label="Notion 数据库">
                    {dataSources.filter(ds => ds.type === "NOTION").map(ds => {
                      const count = sourceGroupCounts[ds.id] || 0;
                      return (
                        <option key={ds.id} value={ds.id}>
                          🇸🇬 {ds.name} {count > 0 ? `(${count} 个人群包)` : "(0 包)"}
                        </option>
                      );
                    })}
                  </optgroup>
                  <optgroup label="Excel 导入文件">
                    {dataSources.filter(ds => ds.type === "EXCEL").map(ds => {
                      const count = sourceGroupCounts[ds.id] || 0;
                      return (
                        <option key={ds.id} value={ds.id}>
                          📁 {ds.name} {count > 0 ? `(${count} 个人群包)` : "(0 包)"}
                        </option>
                      );
                    })}
                  </optgroup>
                  <optgroup label="WhatsApp 导入源">
                    {dataSources.filter(ds => ds.type === "WHATSAPP").map(ds => {
                      const count = sourceGroupCounts[ds.id] || 0;
                      return (
                        <option key={ds.id} value={ds.id}>
                          🟢 {ds.name} {count > 0 ? `(${count} 个人群包)` : "(0 包)"}
                        </option>
                      );
                    })}
                  </optgroup>
                  <optgroup label="未归类/历史数据">
                    <option value="unassigned">
                      ❓ 未归类/默认数据源 ({unassignedCount > 0 ? `${unassignedCount} 人` : "0 人"})
                    </option>
                  </optgroup>
                  <optgroup label="快捷操作">
                    <option value="ADD_NOTION">➕ 新建 Notion 数据库来源</option>
                    <option value="IMPORT_EXCEL">📁 导入 Excel 文件</option>
                    <option value="SYNC_WHATSAPP">🟢 从 WhatsApp 实例导入</option>
                  </optgroup>
                </select>
              </div>
              
              <div className="flex flex-wrap gap-2 items-center">
                {lastReverseSyncAt && (
                  <span className="text-xs text-slate-500 font-bold mr-2 w-full md:w-auto">
                    上次反向同步: {new Date(lastReverseSyncAt).toLocaleString()}
                  </span>
                )}
                
                <button 
                  onClick={() => setShowAiPanel(!showAiPanel)} 
                  className={`flex items-center gap-2 px-3 py-2 md:px-5 md:py-3.5 rounded-xl md:rounded-2xl text-xs md:text-sm font-black transition-all border-2 shadow-sm ${showAiPanel ? "bg-purple-100 border-purple-300 text-purple-700 shadow-purple-100" : "bg-purple-50 hover:bg-purple-100 text-purple-600 border-purple-200"}`}
                  title="打开或关闭 AI 智能分析与建议看板"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{showAiPanel ? "关闭 AI 看板" : "🤖 AI 策略分析"}</span>
                </button>

                <button 
                  onClick={handleOpenMergeModal} 
                  disabled={isMerging}
                  className="flex items-center gap-2 px-3 py-2 md:px-5 md:py-3.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl md:rounded-2xl text-xs md:text-sm font-black transition-all border-2 border-blue-200 shadow-sm disabled:opacity-50"
                  title="智能扫描并合并重复联系人，合并其标签和属性列。"
                >
                  {isMerging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span className="hidden md:inline">{isMerging ? "正在合并..." : "智能去重合并"}</span>
                  <span className="md:hidden">{isMerging ? "去重中..." : "智能去重"}</span>
                </button>

                <button 
                  onClick={openWhatsappImport}
                  className="flex items-center gap-2 px-3 py-2 md:px-5 md:py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl md:rounded-2xl text-xs md:text-sm font-black transition-all border-2 border-emerald-500 shadow-xl shadow-emerald-100"
                  title="从绑定的 WhatsApp 实例中同步新联系人并执行自通知。"
                >
                  <RefreshCw className="w-4 h-4 animate-none" />
                  <span className="hidden md:inline">同步 WhatsApp 联系人</span>
                  <span className="md:hidden">同步WhatsApp</span>
                </button>

                <button 
                  onClick={() => {
                    if (total === 0) {
                      alert("当前名单中没有任何联系人，无法进行批量修改！");
                      return;
                    }
                    // Reset fields
                    setBulkEditCol("");
                    setBulkEditVal("");
                    setShowBulkEditModal(true);
                  }} 
                  className="flex items-center gap-2 px-3 py-2 md:px-5 md:py-3.5 bg-amber-50 hover:bg-amber-100 text-amber-600 rounded-xl md:rounded-2xl text-xs md:text-sm font-black transition-all border-2 border-amber-200 shadow-sm"
                  title="批量一键修改当前筛选出来的所有联系人的某个属性。"
                >
                  <Edit3 className="w-4 h-4" />
                  <span className="hidden md:inline">批量修改名单</span>
                  <span className="md:hidden">批量修改</span>
                </button>

                {selectedContactIds.size > 0 && (
                  <button 
                    onClick={async () => {
                      const count = selectedContactIds.size;
                      if (confirm(`确定要批量删除选中的 ${count} 位联系人吗？此操作不可撤销！`)) {
                        try {
                          const idsArr = Array.from(selectedContactIds);
                          const res = await fetch("/api/contacts", {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ contactIds: idsArr })
                          });
                          if (res.ok) {
                            alert(`✓ 成功批量删除 ${count} 位联系人！`);
                            setContacts(prev => prev.filter(c => !selectedContactIds.has(c.id)));
                            setTotal(t => Math.max(0, t - count));
                            setSelectedContactIds(new Set());
                          } else {
                            const err = await res.json();
                            alert("批量删除失败: " + (err.error || "未知错误"));
                          }
                        } catch (e: any) {
                          alert("批量删除失败: " + e.message);
                        }
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-2 md:px-5 md:py-3.5 bg-red-600 hover:bg-red-700 text-white rounded-xl md:rounded-2xl text-xs md:text-sm font-black transition-all border-2 border-red-500 shadow-xl shadow-red-100 animate-in fade-in zoom-in-95 duration-150"
                    title="一键批量删除勾选选中的联系人"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>🗑️ 批量删除 (已选 {selectedContactIds.size} 项)</span>
                  </button>
                )}

                {false && (
                  <>
                    <button 
                      onClick={() => {
                        if (selectedSourceId === "all") {
                          alert("请先选择一个特定的 Notion 数据库数据源，再进行反向同步！");
                          return;
                        }
                        setShowMappingModal(true);
                      }} 
                      disabled={reverseSyncing} 
                      className="flex items-center gap-2 px-3 py-2 md:px-5 md:py-3.5 bg-emerald-50 text-emerald-600 rounded-xl md:rounded-2xl text-xs md:text-sm font-black hover:bg-emerald-100 transition-all border-2 border-emerald-200 shadow-sm disabled:opacity-80 disabled:cursor-not-allowed"
                      title="将 MySQL 中的发送状态、次数等反向同步到 Notion。"
                    >
                      {reverseSyncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpRight className="w-4 h-4" />}
                      <span className="hidden md:inline">{reverseSyncing ? `正在反向同步 (预计 ${reverseSyncTimeLeft} 秒)...` : "反向同步到 Notion"}</span>
                      <span className="md:hidden">{reverseSyncing ? `同步中 (${reverseSyncTimeLeft}s)` : "反向同步"}</span>
                    </button>

                    <button 
                      onClick={() => {
                        setShowLogsModal(true);
                        fetchSyncLogs();
                      }} 
                      className="flex items-center gap-2 px-3 py-2 md:px-5 md:py-3.5 bg-slate-50 text-slate-600 rounded-xl md:rounded-2xl text-xs md:text-sm font-black hover:bg-slate-100 transition-all border-2 border-slate-200 shadow-sm"
                      title="查看反向同步的更新日志。"
                    >
                      <ClipboardList className="w-4 h-4" />
                      <span className="hidden md:inline">查看同步日志</span>
                      <span className="md:hidden">同步日志</span>
                    </button>

                    <button 
                      onClick={() => {
                        if (selectedSourceId === "all") {
                          alert("请先选择一个特定的 Notion 数据库数据源，再进行从 Notion 拉取！");
                          return;
                        }
                        setShowForwardMappingModal(true);
                      }} 
                      disabled={syncing} 
                      className="flex items-center gap-2 px-4 py-2 md:px-8 md:py-3.5 bg-blue-600 text-white rounded-xl md:rounded-2xl text-xs md:text-sm font-black hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 disabled:opacity-80 disabled:cursor-not-allowed"
                    >
                      {syncing ? <Loader2 className="w-4 h-4 md:w-5 md:h-5 animate-spin" /> : <RefreshCw className="w-4 h-4 md:w-5 md:h-5" />}
                      <span>{syncing ? `正在从 Notion 同步 (预计 ${syncTimeLeft} 秒)...` : "从 Notion 拉取"}</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {activeSource && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-50 border border-slate-200/60 p-4 rounded-2xl gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="text-xs md:text-sm text-slate-600 font-bold">
                  <span className="text-slate-400 font-medium">数据源类型:</span> {activeSource.type === "NOTION" ? "Notion 数据库" : "Excel 导入文件"}
                  {activeSource.description && (
                    <>
                      <span className="mx-2 text-slate-300">|</span>
                      <span className="text-slate-400 font-medium">来源说明:</span> {activeSource.description}
                    </>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setDataSourceConfigForm({
                        id: activeSource.id,
                        name: activeSource.name,
                        type: activeSource.type,
                        notionSecret: activeSource.notionSecret || "",
                        notionDatabaseId: activeSource.notionDatabaseId || "",
                        notionSyncWebhookUrl: activeSource.notionSyncWebhookUrl || "",
                        description: activeSource.description || ""
                      });
                      setShowSourceSecret(false);
                      setShowDataSourceConfigModal(true);
                    }}
                    className="text-[10px] md:text-xs font-black text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 transition-colors"
                  >
                    ⚙️ 配置此数据源
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm("确定要删除这个数据库源吗？此操作会同时删除该来源下的所有联系人！")) {
                        try {
                          const res = await fetch(`/api/data-sources/${activeSource.id}`, { method: "DELETE" });
                          if (res.ok) {
                            alert("删除成功！");
                            setSelectedSourceId("all");
                            fetchData();
                          } else {
                            const err = await res.json();
                            alert("删除失败: " + err.error);
                          }
                        } catch (e: any) {
                          alert("删除失败: " + e.message);
                        }
                      }
                    }}
                    className="text-[10px] md:text-xs font-black text-red-600 hover:text-red-700 bg-red-50 px-3 py-1.5 rounded-lg border border-red-200 transition-colors"
                  >
                    🗑️ 删除此源
                  </button>
                </div>
              </div>
            )}
          </header>

      {/* AI 智能看板面板 */}
      {showAiPanel && (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 p-4 md:p-6 rounded-3xl border-2 border-purple-100 shadow-lg animate-in slide-in-from-top duration-300 space-y-4 mb-6" style={{ colorScheme: 'light' }}>
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
                  className="bg-white border border-purple-200 rounded-xl px-3 py-2 text-sm text-purple-900 focus:ring-1 focus:ring-purple-500 outline-none w-[100px] flex-shrink-0 shadow-sm font-bold"
                >
                  <option value="gemini">Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="deepseek">DeepSeek</option>
                </select>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-white border border-purple-200 rounded-xl px-3 py-2 text-sm text-purple-900 focus:ring-1 focus:ring-purple-500 outline-none flex-1 min-w-0 max-w-full sm:w-[240px] truncate shadow-sm font-bold"
                >
                  {selectedBrand === "gemini" && (
                    <>
                      <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                      <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                      <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                      <option value="gemini-3.0-flash">Gemini 3.0 Flash</option>
                      <option value="gemini-3.0-pro">Gemini 3.0 Pro</option>
                    </>
                  )}
                  {selectedBrand === "openai" && (
                    <>
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="gpt-4o-mini">GPT-4o-mini</option>
                      <option value="o1-preview">o1-preview</option>
                      <option value="o1-mini">o1-mini</option>
                    </>
                  )}
                  {selectedBrand === "deepseek" && (
                    <>
                      <option value="deepseek-chat">DeepSeek-V3</option>
                      <option value="deepseek-reasoner">DeepSeek-R1</option>
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
                            ? stats?.markets?.filter((m: any) => (selectedAiListTags["市场"] || getTagsForList("市场")).includes(m.name)).map((m: any) => `${m.name}: ${m.count}人`) 
                            : [],
                          tags: selectedAiLists.includes("关系") 
                            ? stats?.tags?.filter((t: any) => (selectedAiListTags["关系"] || getTagsForList("关系")).includes(t.name)).map((t: any) => `${t.name}: ${t.count}人`) 
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
            <div className="p-4 bg-white rounded-xl border border-purple-200 animate-in fade-in slide-in-from-top-1 duration-200 space-y-3">
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
                className="w-full border border-purple-100 rounded-lg px-3 py-2 text-sm text-slate-900 focus:border-purple-500 outline-none resize-none font-bold"
              />
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 统计卡片 */}
            <div className="bg-white p-5 rounded-2xl border border-purple-50 shadow-sm space-y-3">
              <div className="text-xs font-black text-slate-500 uppercase">数据概览</div>
              {stats ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-slate-600">总人数:</span>
                    <span className="text-slate-950 font-black">{stats.total} 人</span>
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
                </div>
              ) : (
                <div className="text-xs text-slate-400 font-bold">等待加载...</div>
              )}
            </div>
            
            {/* AI 分析卡片 */}
            <div className="bg-white p-5 rounded-2xl border border-purple-50 shadow-sm md:col-span-2 space-y-2">
              <div className="flex justify-between items-center">
                <div className="text-xs font-black text-slate-500 uppercase">AI 策略建议</div>
                {aiAnalysisTime && (
                  <div className="text-[10px] text-slate-400 font-bold">
                    分析于: {new Date(aiAnalysisTime).toLocaleString()}
                  </div>
                )}
              </div>
              {aiAnalysis ? (
                <div className="text-xs text-slate-700 font-bold whitespace-pre-wrap max-h-48 overflow-y-auto">
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
        </div>
      )}

        <div className="bg-white p-4 md:p-8 rounded-3xl md:rounded-[2.5rem] border-2 border-slate-200 shadow-lg relative">
          <div className="flex flex-col gap-3 mb-4 md:mb-8 pb-4 border-b-2 border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-slate-950 font-black text-lg md:text-xl">
                <div className="flex items-center gap-2">
                  <Filter className="w-5 h-5 md:w-6 md:h-6 text-blue-600" /> 人群精细化筛选
                </div>
                <span className="text-xs text-slate-500 font-bold">
                  (已选 {selectedMarkets.length + selectedRelations.length + filterRules.length} 项)
                </span>
              </div>
              
              <div className="flex items-center gap-2 self-start sm:self-auto">
                {editingGroup && (
                  <button 
                    onClick={() => {
                      setEditingGroup(null);
                      setSelectedMarkets([]);
                      setSelectedRelations([]);
                      setFilterRules([]);
                      setExcludedIds(new Set());
                    }}
                    className="px-2.5 py-1 bg-red-50 hover:bg-red-100 border border-red-200 text-xs font-black text-red-600 rounded-lg flex items-center gap-1 transition-all whitespace-nowrap"
                    title="退出编辑模式"
                  >
                    退出编辑模式 <X className="w-3 h-3" />
                  </button>
                )}
                <button 
                  onClick={() => setShowFiltersMobile(!showFiltersMobile)}
                  className="lg:hidden px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-xl text-xs font-black text-slate-700 hover:bg-slate-200 transition-all whitespace-nowrap"
                >
                  {showFiltersMobile ? "收起筛选 ▲" : "展开筛选 ▼"}
                </button>
              </div>
            </div>

            <div className="hidden lg:flex bg-slate-100 p-1.5 rounded-2xl border-2 border-slate-200 self-end lg:self-auto">
              <button 
                onClick={() => setMatchMode("ANY")}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${matchMode === "ANY" ? "bg-white text-blue-700 shadow-sm border-2 border-slate-100" : "text-slate-600"}`}
              >
                满足任一 (OR)
              </button>
              <button 
                onClick={() => setMatchMode("ALL")}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${matchMode === "ALL" ? "bg-white text-blue-700 shadow-sm border-2 border-slate-100" : "text-slate-600"}`}
              >
                满足全部 (AND)
              </button>
            </div>
          </div>

          <div className={`${showFiltersMobile ? "block" : "hidden"} lg:block space-y-6 md:space-y-8`}>
            {/* Mobile logic selector */}
            <div className="lg:hidden flex bg-slate-100 p-1 rounded-xl border border-slate-200 justify-between items-center mb-4">
              <span className="text-xs font-black text-slate-500 pl-2">逻辑关系：</span>
              <div className="flex gap-1">
                <button 
                  onClick={() => setMatchMode("ANY")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${matchMode === "ANY" ? "bg-white text-blue-700 shadow-sm border border-slate-200" : "text-slate-600"}`}
                >
                  满足任一 (OR)
                </button>
                <button 
                  onClick={() => setMatchMode("ALL")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${matchMode === "ALL" ? "bg-white text-blue-700 shadow-sm border border-slate-200" : "text-slate-600"}`}
                >
                  满足全部 (AND)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8">
              <MultiSelect 
                label="市场区域 (可多选)" 
                options={availableFilters.markets} 
                selected={selectedMarkets} 
                onChange={setSelectedMarkets} 
              />
              <MultiSelect 
                label="业务关系标签 (核心筛选)" 
                options={availableFilters.relations} 
                selected={selectedRelations} 
                onChange={setSelectedRelations} 
              />
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-900 uppercase ml-1">发送状态过滤</label>
                <select value={filterSent} onChange={(e) => setFilterSent(e.target.value as any)} className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 text-sm font-black text-slate-950 bg-slate-50 focus:border-blue-600 focus:ring-0 h-[46px]">
                  <option value="">全部状态</option>
                  <option value="true">✓ 只看已发送</option>
                  <option value="false">○ 只看未发送</option>
                </select>
              </div>
            </div>

            <div className="mt-4 md:mt-8 pt-4 md:pt-8 border-t-2 border-slate-100">
              <FilterBuilder 
                availableColumns={availableFilters.availableColumns} 
                rules={filterRules} 
                onChange={setFilterRules} 
                contacts={contacts} 
                ruleMatchMode={ruleMatchMode}
                onRuleMatchModeChange={setRuleMatchMode}
              />
            </div>

            <div className="mt-6 md:mt-10 flex flex-col md:flex-row justify-between items-stretch md:items-center bg-slate-50/50 p-4 md:p-6 rounded-2xl md:rounded-3xl border-2 border-dashed border-slate-200 gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-100 rounded-xl md:rounded-2xl text-blue-700">
                    <Settings2 className="w-5 h-5 md:w-6 md:h-6" />
                  </div>
                  <div>
                    <div className="text-xs md:text-sm font-black text-slate-900 uppercase">当前锁定目标</div>
                    <div className="text-lg md:text-2xl font-black text-slate-950">{total - excludedIds.size} 位联系人</div>
                    {excludedIds.size > 0 && (
                      <button
                        onClick={() => setShowExcludedModal(true)}
                        className="mt-1 flex items-center gap-1.5 px-3 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-black border border-red-200 shadow-sm transition-all cursor-pointer animate-in fade-in"
                        title="点击查看并管理已手动排除的联系人"
                      >
                        <UserX className="w-3.5 h-3.5 text-red-500" />
                        <span>已手动排除 {excludedIds.size} 人 (点击查看/管理) 🔍</span>
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="flex flex-col gap-2">
                  {editingGroup && (
                    <div className="text-center animate-pulse">
                      <span className="text-[10px] font-black text-red-500 uppercase tracking-widest">
                        ⚠ 正在编辑: {editingGroup.name}
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {editingGroup ? (
                      <>
                        <button 
                          onClick={() => handleSaveGroup(true)} 
                          className="px-4 py-3 md:px-6 md:py-4 bg-blue-600 text-white rounded-xl md:rounded-2xl text-xs md:text-sm font-black hover:bg-blue-700 transition-all shadow-lg flex-1 flex items-center justify-center gap-2"
                        >
                          <Save className="w-4 h-4" /> 覆盖更新
                        </button>
                        <button 
                          onClick={() => handleSaveGroup(false)} 
                          className="px-4 py-3 md:px-6 md:py-4 bg-emerald-600 text-white rounded-xl md:rounded-2xl text-xs md:text-sm font-black hover:bg-emerald-700 transition-all shadow-lg flex-1 flex items-center justify-center gap-2"
                        >
                          <Plus className="w-4 h-4" /> 另存新包
                        </button>
                      </>
                    ) : (
                      <button 
                        onClick={() => handleSaveGroup(false)} 
                        disabled={selectedMarkets.length === 0 && selectedRelations.length === 0 && filterRules.length === 0 && selectedSourceId === "all"} 
                        className="px-6 py-3 md:px-10 md:py-4 bg-emerald-600 text-white rounded-xl md:rounded-2xl text-xs md:text-sm font-black hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-200 disabled:opacity-20 flex items-center justify-center gap-2 w-full"
                      >
                        <Save className="w-4 h-4" /> 保存此人群包
                      </button>
                    )}
                  </div>
                </div>
            </div>
          </div>
        </div>

        {/* 📱 移动端专享：人群包与匹配人数展示区域 (居中在数据源与联系人列表资料之间) */}
        <div className="block lg:hidden space-y-4">
          <div className="bg-white rounded-2xl border-2 border-slate-200 shadow-sm p-4">
            <h3 className="font-black text-slate-900 text-base flex items-center justify-between gap-2 mb-3 text-emerald-700">
              <span className="flex items-center gap-2">
                <Tag className="w-4 h-4" /> 已存人群包
              </span>
              {selectedSourceId !== "all" && (
                <span className="text-[9px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-mono">
                  当前源: {dataSources.find(d => d.id === selectedSourceId)?.name || selectedSourceId}
                </span>
              )}
            </h3>
            <div className="space-y-2">
              {(() => {
                const sortedGroups = [...groups].sort((a, b) => {
                  const cfgA = typeof a.filterConfig === 'string' ? JSON.parse(a.filterConfig) : a.filterConfig;
                  const cfgB = typeof b.filterConfig === 'string' ? JSON.parse(b.filterConfig) : b.filterConfig;
                  const sA = cfgA?.sourceId || "all";
                  const sB = cfgB?.sourceId || "all";
                  const matchA = sA === selectedSourceId;
                  const matchB = sB === selectedSourceId;
                  if (matchA && !matchB) return -1;
                  if (!matchA && matchB) return 1;
                  return 0;
                });

                const filteredGroups = sortedGroups.filter(g => {
                  if (selectedSourceId === "all") return true;
                  const cfg = typeof g.filterConfig === 'string' ? JSON.parse(g.filterConfig) : g.filterConfig;
                  const groupSourceId = cfg?.sourceId || "all";
                  return groupSourceId === selectedSourceId;
                });

                if (filteredGroups.length === 0) {
                  return (
                    <div className="text-center py-3 px-2 text-xs font-bold text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                      {selectedSourceId === "all" ? "暂无人群包，配置好筛选条件后点击「保存此人群包」" : "此数据源下暂无独立人群包"}
                    </div>
                  );
                }

                return filteredGroups.map((g) => {
                  const cfg = typeof g.filterConfig === 'string' ? JSON.parse(g.filterConfig) : g.filterConfig;
                  const groupSourceId = cfg?.sourceId || "all";
                  const isCurrentSource = selectedSourceId !== "all" 
                    ? groupSourceId === selectedSourceId
                    : groupSourceId === "all";
                  const sourceInfo = getGroupSourceInfo(g);
                  const isActive = editingGroup?.id === g.id;

                  return (
                    <button 
                      key={g.id} 
                      onClick={() => {
                        if (isActive) {
                          setEditingGroup(null);
                          setSelectedMarkets([]);
                          setSelectedRelations([]);
                          setMatchMode("ANY");
                          setRuleMatchMode("AND");
                          setFilterSent("");
                          setFilterRules([]);
                          setExcludedIds(new Set());
                        } else {
                          setSelectedMarkets(cfg.markets || []);
                          setSelectedRelations(cfg.relations || []);
                          setMatchMode(cfg.matchMode || "ANY");
                          setRuleMatchMode(cfg.ruleMatchMode || "AND");
                          setFilterSent(cfg.sent || "");
                          setFilterRules(cfg.rules || []);
                          setExcludedIds(new Set(cfg.excludedIds || []));
                          setEditingGroup({ id: g.id, name: g.name });
                          setSelectedSourceId(cfg.sourceId || "all");
                        }
                      }} 
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-black transition-all group border-2 shadow-sm ${
                        isActive 
                          ? "bg-blue-600 text-white border-blue-400" 
                          : isCurrentSource
                            ? "text-slate-900 bg-white border-blue-200 hover:border-blue-400 hover:bg-blue-50/50"
                            : "text-slate-500 bg-slate-50/80 border-transparent hover:bg-slate-100"
                      }`}
                    >
                      <div className="flex flex-col items-start gap-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 w-full">
                          <span className="truncate">{g.name}</span>
                          {isCurrentSource && !isActive && (
                            <span className="text-[8px] font-black bg-blue-100 text-blue-700 px-1 py-0.5 rounded flex-shrink-0">
                              当前源
                            </span>
                          )}
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md flex-shrink-0 ${isActive ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                            {(g as any).contactCount || 0}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button 
                          onClick={(e) => handleDeleteGroup(e, g.id)}
                          className={`p-1 rounded-lg transition-opacity ${isActive ? "hover:bg-blue-700 text-white" : "hover:bg-red-50 text-red-500"}`}
                          title="删除人群包"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-white" : "text-slate-300"}`} />
                      </div>
                    </button>
                  );
                });
              })()}
            </div>
          </div>

          <div className="bg-blue-700 rounded-2xl p-4 text-white shadow-lg flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 opacity-80" />
              <span className="text-xs font-black uppercase tracking-widest">匹配人数</span>
            </div>
            <div className="text-2xl font-black">{total} 人</div>
          </div>
        </div>

        <div className="bg-white rounded-2xl lg:rounded-[2rem] border-2 border-slate-200 shadow-md overflow-hidden w-full">
          <div className="p-4 border-b-2 border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50/50">
            {/* Top row / Left section */}
            <div className="flex items-center justify-between w-full md:w-auto gap-3">
              <div className="flex items-center gap-2">
                {/* Select All Checkbox for Mobile */}
                <button
                  onClick={() => {
                    const currentPageIds = contacts.map(c => c.id);
                    const allSelected = currentPageIds.length > 0 && currentPageIds.every(id => selectedContactIds.has(id));
                    const next = new Set(selectedContactIds);
                    if (allSelected) {
                      currentPageIds.forEach(id => next.delete(id));
                    } else {
                      currentPageIds.forEach(id => next.add(id));
                    }
                    setSelectedContactIds(next);
                  }}
                  className={`lg:hidden w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all flex-shrink-0 cursor-pointer ${
                    contacts.length > 0 && contacts.map(c => c.id).every(id => selectedContactIds.has(id))
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-slate-300 bg-white"
                  }`}
                  title="全选/取消全选本页所有联系人"
                >
                  {contacts.length > 0 && contacts.map(c => c.id).every(id => selectedContactIds.has(id)) && <Check className="w-3.5 h-3.5" />}
                </button>

                <div className="text-xs md:text-sm font-black text-slate-900 uppercase flex items-center gap-1.5 whitespace-nowrap">
                  <Users className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span>联系人列表 ({total})</span>
                </div>
                {selectedContactIds.size > 0 && (
                  <span className="text-[10px] font-black bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex-shrink-0">
                    已选 {selectedContactIds.size} 项
                  </span>
                )}
              </div>

              {/* Mobile Columns Button */}
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setShowColSelector(!showColSelector);
                }}
                className="md:hidden flex items-center gap-1.5 px-2.5 py-1.5 bg-white border-2 border-slate-200 rounded-xl text-xs font-black text-slate-800 hover:border-slate-400 flex-shrink-0"
              >
                <Settings2 className="w-3.5 h-3.5 text-blue-600" />
                <span>显示列</span>
              </button>
            </div>

            {/* Bottom row / Right action buttons toolbar (Horizontally scrollable on mobile) */}
            <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 md:pb-0 scrollbar-none w-full md:w-auto">
              {contacts.length > 0 && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={handleBatchDelete}
                    className="flex items-center gap-1.5 px-3 py-1.5 lg:px-4 lg:py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black transition-all shadow-sm cursor-pointer flex-shrink-0"
                    title="彻底删除选中的联系人数据（不可撤销）"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>
                      批量删除 ({selectedContactIds.size})
                    </span>
                  </button>

                  <button
                    onClick={() => {
                      if (selectedContactIds.size === 0) {
                        alert("请先勾选需要拉黑的联系人！");
                        return;
                      }
                      setShowBatchBlacklistConfirm(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 lg:px-4 lg:py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-black transition-all shadow-sm cursor-pointer flex-shrink-0"
                    title="将勾选的联系人移入黑名单（停止接收任何群发消息）"
                  >
                    <Ban className="w-4 h-4 text-amber-400" />
                    <span>
                      批量拉黑 ({selectedContactIds.size})
                    </span>
                  </button>
                </div>
              )}

              <button
                onClick={handleExportExcel}
                disabled={exporting}
                className="flex items-center gap-2 px-3 py-1.5 lg:px-4 lg:py-2 bg-white border-2 border-slate-300 text-slate-800 rounded-xl text-xs font-black hover:border-slate-400 transition-all disabled:opacity-50 flex-shrink-0"
                title="一键导出当前筛选后的联系人数据为 Excel 文件"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin text-green-600" /> : <ClipboardList className="w-4 h-4 text-green-600" />}
                <span>导出 Excel</span>
              </button>

              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  setShowColSelector(!showColSelector);
                }}
                className={`hidden md:flex items-center gap-2 px-3 py-1.5 lg:px-4 lg:py-2 bg-white border-2 rounded-xl text-xs font-black transition-all flex-shrink-0 ${showColSelector ? "border-blue-600 ring-2 ring-blue-50" : "border-slate-300 text-slate-800 hover:border-slate-400"}`}
              >
                <Settings2 className="w-4 h-4 text-blue-600" /> 
                <span>显示列 ({visibleColumns.length})</span>
                <ChevronRight className={`w-3 h-3 transition-transform ${showColSelector ? "rotate-90" : ""}`} />
              </button>
            </div>
          </div>
          {showColSelector && (
            <div 
              onClick={(e) => {
                e.stopPropagation();
                setShowColSelector(false);
              }}
              className="fixed inset-0 z-[100] bg-slate-950/40 backdrop-blur-[2px] flex items-end md:items-center justify-center p-0 md:p-4"
            >
              <div 
                onClick={(e) => e.stopPropagation()}
                className="w-full md:w-80 bg-white border-2 border-slate-200 rounded-t-3xl md:rounded-3xl shadow-2xl p-4 flex flex-col gap-2 max-h-[85vh] overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-200"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="text-xs font-black text-slate-900 uppercase flex items-center gap-2">
                    <Settings2 className="w-4 h-4 text-blue-600" />
                    可选字段 (系统及自定义)
                  </div>
                  <button onClick={() => setShowColSelector(false)} className="p-1 text-slate-400 hover:text-slate-600">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-[10px] text-slate-400 font-bold">
                  已选择 {visibleColumns.length} 列，未选择 {availableFilters.availableColumns.length - visibleColumns.length} 列
                </div>
                  {availableFilters.availableColumns.length > 0 && (
                    <div className="px-2 pb-1.5 flex justify-between border-b border-slate-100">
                      <button 
                        onClick={toggleAllColumns}
                        className="text-xs font-black text-blue-600 hover:text-blue-700 hover:underline"
                      >
                        {visibleColumns.length === availableFilters.availableColumns.length ? "全部清除" : "全选所有列"}
                      </button>
                    </div>
                  )}
                  <div className="max-h-60 overflow-y-auto">
                    {availableFilters.availableColumns.map(col => (
                      <div 
                        key={col} 
                        onClick={() => toggleColumn(col)}
                        className="flex items-center justify-between p-2 rounded-xl cursor-pointer hover:bg-slate-50 text-sm font-black text-slate-800 group"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${visibleColumns.includes(col) ? "bg-blue-600 border-blue-600" : "border-slate-400"}`}>
                            {visibleColumns.includes(col) && <Check className="w-3.5 h-3.5 text-white" />}
                          </div>
                          <span className="truncate max-w-[120px]" title={col}>{col}</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRenameColumn(col);
                            }}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded transition-colors"
                            title="重命名列"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteColumn(col);
                            }}
                            className="p-1 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded transition-colors"
                            title="删除列"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {availableFilters.availableColumns.length === 0 && (
                      <div className="p-4 text-center text-xs text-slate-500 font-bold">暂无更多属性，请在下方添加</div>
                    )}
                  </div>
                  {/* 新增列区域 */}
                  <div className="border-t border-slate-100 pt-2.5 mt-1.5 px-1 space-y-2">
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-1">
                      添加新自定义列
                    </div>
                    <div className="flex gap-2 items-center">
                      <input 
                        type="text" 
                        value={newColName}
                        onChange={(e) => setNewColName(e.target.value)}
                        placeholder="输入新列名..."
                        className="flex-1 min-w-0 border-2 border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-800 bg-slate-50 hover:border-slate-300 focus:border-blue-500 outline-none transition-all"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddColumn();
                          }
                        }}
                      />
                      <button 
                        onClick={handleAddColumn}
                        disabled={addingColumn || !newColName.trim()}
                        className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:hover:bg-blue-600 flex-shrink-0"
                        title="添加列"
                      >
                        {addingColumn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

          {/* 移动端卡片流列表 (lg以下屏幕可见) */}
          <div className="block lg:hidden divide-y divide-slate-100">
            {mergedContacts.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-400 text-sm font-bold">
                暂无数据
              </div>
            ) : (
              mergedContacts.map((row) => {
                const isSelected = selectedContactIds.has(row.id);
                let relationTags: string[] = [];
                try {
                  relationTags = JSON.parse(row.relation || "[]");
                } catch {
                  if (row.relation) relationTags = [row.relation];
                }

                return (
                  <div 
                    key={row.id} 
                    className={`p-4 transition-colors flex flex-col gap-2 ${isSelected ? "bg-blue-50/40" : "bg-white"}`}
                  >
                    {/* Header: Checkbox + Name + Edit + Status */}
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => {
                            const next = new Set(selectedContactIds);
                            if (isSelected) next.delete(row.id);
                            else next.add(row.id);
                            setSelectedContactIds(next);
                          }}
                          className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all cursor-pointer ${isSelected ? "bg-blue-600 border-blue-600" : "border-slate-300 bg-white"}`}
                        >
                          {isSelected && <Check className="w-4 h-4 text-white" />}
                        </button>
                        <span className="font-bold text-slate-900 text-base">{row.name}</span>
                        <button 
                          onClick={() => setEditingContact(row)}
                          className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-blue-600 transition-colors flex items-center justify-center"
                          title="编辑联系人"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black border ${row.sent ? "bg-green-50 text-green-700 border-green-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
                        {row.sent ? "✓ 已发送" : "○ 待发送"}
                      </span>
                    </div>

                    {/* Contact details */}
                    <div className="flex flex-col gap-1.5 pl-9 text-xs text-slate-600">
                      <div className="flex items-center gap-1 font-mono">
                        <span>📞</span>
                        <a href={`tel:${row.phone}`} className="hover:text-blue-600 hover:underline">{row.phone}</a>
                      </div>
                      
                      {/* Tags & Market */}
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {row.market && (
                          <span className="text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 rounded-md">
                            {row.market}
                          </span>
                        )}
                        {relationTags.map((tag) => (
                          <span 
                            key={tag} 
                            className="text-[10px] font-bold bg-slate-50 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded-md"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      {/* Notion Dynamic properties (if any visible) */}
                      {visibleColumns.length > 0 && (
                        <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-100 text-[10px]">
                          {visibleColumns.map(colName => {
                            const val = row.properties?.[colName];
                            const displayVal = Array.isArray(val) ? val.join(", ") : val?.toString() || "—";
                            return (
                              <div key={colName} className="flex gap-1">
                                <span className="font-bold text-slate-400">{colName}:</span>
                                <span className="text-slate-800 font-bold truncate" title={displayVal}>{displayVal}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* Pagination for Mobile */}
            <div className="p-4 border-t border-slate-100 flex flex-col gap-3 bg-slate-50/30 items-center">
              <span className="text-xs font-bold text-slate-500">
                第 {page} / {Math.max(1, Math.ceil(total / pageSize))} 页 (共 {total} 条)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-black disabled:opacity-30"
                >
                  上一页
                </button>
                <button
                  onClick={() => setPage(Math.min(Math.max(1, Math.ceil(total / pageSize)), page + 1))}
                  disabled={page >= Math.ceil(total / pageSize)}
                  className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs font-black disabled:opacity-30"
                >
                  下一页
                </button>
              </div>
            </div>
          </div>

          {/* 桌面端大屏表格 (lg以上屏幕可见) */}
          <div className="hidden lg:block">
             <DataTable 
              columns={columns} 
              data={mergedContacts} 
              pageSize={pageSize}
              totalTotalRows={total}
              currentPage={page}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1); 
                localStorage.setItem("contacts_page_size", String(size));
              }}
              onCellEdit={handleCellEdit}
              selectedRowIds={selectedContactIds}
              onSelectionChange={(selectedSet) => setSelectedContactIds(selectedSet)}
              autocompleteSuggestions={{
                market: availableFilters.markets,
                relation: availableFilters.relations,
              }}
              draftEdits={draftEdits}
              onHeaderDoubleClick={(key) => {
                if (key.startsWith("prop_")) {
                  const colName = key.substring(5);
                  handleRenameColumn(colName);
                }
              }}
              getRowClassName={(row) => row.isHistoricallyBlacklisted ? "bg-amber-50/30 hover:bg-amber-50/50" : ""}
            />
          </div>
        </div>
      </div>

      {showLogsModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onClick={() => setShowLogsModal(false)}>
          <div className="bg-white rounded-[2.5rem] border-2 border-slate-200 shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b-2 border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h3 className="font-black text-slate-900 text-xl flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-blue-600" /> 数据同步日志
              </h3>
              <button onClick={() => setShowLogsModal(false)} className="p-2 hover:bg-slate-100 rounded-full transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {loadingLogs ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                </div>
              ) : logs.length === 0 ? (
                <div className="text-center py-12 text-slate-500 font-bold">
                  暂无同步日志记录
                </div>
              ) : (
                logs.map((log: any) => (
                  <div key={log.id} className="p-4 rounded-2xl border-2 border-slate-100 hover:border-blue-100 transition-all bg-white hover:shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-xs font-black px-2 py-0.5 rounded-md ${
                          log.syncType === 'FORWARD_SYNC'
                            ? 'bg-blue-50 text-blue-700'
                            : log.syncType === 'WHATSAPP_SYNC'
                            ? 'bg-indigo-50 text-indigo-700'
                            : 'bg-purple-50 text-purple-700'
                        }`}>
                          {log.syncType === 'FORWARD_SYNC'
                            ? '从 Notion 拉取'
                            : log.syncType === 'WHATSAPP_SYNC'
                            ? 'WhatsApp 导入'
                            : '反向同步'}
                        </span>
                        <span className={`text-xs font-black px-2 py-0.5 rounded-md ${log.status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : log.status === 'WARNING' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                          {log.status === 'SUCCESS' ? '成功' : log.status === 'WARNING' ? '提示' : '失败'}
                        </span>
                        <span className="text-sm font-black text-slate-800 ml-1">{log.summary}</span>
                      </div>
                      <span className="text-xs text-slate-400 font-bold">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {log.details && (
                      <pre className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg overflow-x-auto font-mono whitespace-pre-wrap mt-2">
                        {log.details}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
            
            <div className="p-6 border-t-2 border-slate-100 flex justify-end bg-slate-50/50">
              <button onClick={() => setShowLogsModal(false)} className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black hover:bg-blue-700 transition-all shadow-lg shadow-blue-200">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showBatchBlacklistConfirm}
        onClose={() => setShowBatchBlacklistConfirm(false)}
        onConfirm={handleBatchBlacklist}
        title="确认批量拉黑"
        description={`确定要把选中的 ${selectedContactIds.size} 位联系人移入黑名单吗？拉黑后他们将不再出现在联系人列表中，且不会收到任何群发消息。`}
        confirmText={isBatchBlacklisting ? "正在拉黑..." : "确定拉黑"}
        variant="danger"
      />

      <SyncMappingModal 
        open={showMappingModal} 
        onClose={() => setShowMappingModal(false)}
        onConfirm={confirmReverseSync}
        isExecuting={reverseSyncing}
        sourceId={selectedSourceId}
      />

      <ForwardSyncMappingModal
        open={showForwardMappingModal}
        onClose={() => setShowForwardMappingModal(false)}
        onConfirm={handleSync}
        isExecuting={syncing}
        sourceId={selectedSourceId}
      />

      {showResultModal && syncResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div 
            className="bg-white rounded-[2.5rem] border-2 border-slate-200 shadow-2xl max-w-md w-full overflow-hidden flex flex-col p-8 text-center relative transform scale-100 transition-all animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Close button in top-right */}
            <button 
              onClick={() => setShowResultModal(false)} 
              className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Icon */}
            <div className="mx-auto w-20 h-20 rounded-full flex items-center justify-center mb-6 shadow-lg shadow-slate-100 border border-slate-50">
              {syncResult.success ? (
                <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                  <span className="text-4xl">🎉</span>
                </div>
              ) : (
                <div className="w-16 h-16 rounded-full bg-red-50 border border-red-200 flex items-center justify-center">
                  <span className="text-4xl">❌</span>
                </div>
              )}
            </div>

            {/* Title */}
            <h3 className="text-2xl font-black text-slate-900 mb-2">
              {syncResult.type === 'FORWARD' 
                ? "Notion 拉取同步" 
                : syncResult.type === 'WHATSAPP' 
                ? "WhatsApp 实例导入" 
                : "反向同步 Notion"}
              {syncResult.success ? "成功" : "失败"}
            </h3>

            {/* Description */}
            <p className="text-sm font-bold text-slate-600 mb-4 whitespace-pre-wrap leading-relaxed">
              {syncResult.message}
            </p>
            {syncResult.detail && (
              <div className="text-xs text-slate-500 bg-slate-50 p-4 rounded-2xl border border-slate-100 text-left font-bold mb-6 max-h-32 overflow-y-auto leading-relaxed">
                {syncResult.detail}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => {
                  setShowResultModal(false);
                  setShowLogsModal(true);
                  fetchSyncLogs();
                }} 
                className="w-full py-3 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-sm font-black hover:bg-slate-100 transition-all flex items-center justify-center gap-2"
              >
                <ClipboardList className="w-4 h-4" /> 查看详细同步日志
              </button>
              <button 
                onClick={() => setShowResultModal(false)} 
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-black transition-all shadow-lg shadow-blue-200 flex items-center justify-center gap-2"
              >
                关闭 ({countdown}s)
              </button>
            </div>
          </div>
        </div>
      )}

      {editingContact && (
        <Modal 
          open={!!editingContact} 
          onClose={() => setEditingContact(null)} 
          title="修改联系人信息"
          className="max-w-md w-full"
        >
          <div className="space-y-4">
            <div>
              <label className="text-xs font-black text-slate-500 uppercase">姓名</label>
              <input 
                type="text" 
                value={tempName} 
                onChange={(e) => setTempName(e.target.value)}
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-black text-slate-500 uppercase">电话</label>
              <input 
                type="text" 
                value={tempPhone} 
                onChange={(e) => setTempPhone(e.target.value)}
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-black text-slate-500 uppercase">市场区域</label>
              <input 
                type="text" 
                value={tempMarket} 
                onChange={(e) => setTempMarket(e.target.value)}
                placeholder="例如：马来西亚"
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-black text-slate-500 uppercase">业务关系标签 (以英文逗号隔开)</label>
              <input 
                type="text" 
                value={tempRelation} 
                onChange={(e) => setTempRelation(e.target.value)}
                placeholder="例如：客户, 代理, 合作"
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-black text-slate-500 uppercase">历史发送次数</label>
              <div className="w-full mt-1 border border-slate-200 border-dashed bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-600 flex items-center gap-1.5 select-none">
                🚀 {editingContact.sendCount ?? 0} 次
              </div>
            </div>

            {availableFilters.availableColumns.map(colName => (
              <div key={colName}>
                <label className="text-xs font-black text-slate-500 uppercase">{colName}</label>
                <input 
                  type="text" 
                  value={tempProperties[colName] || ""} 
                  onChange={(e) => setTempProperties({ ...tempProperties, [colName]: e.target.value })}
                  className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
                />
              </div>
            ))}

            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <button 
                onClick={() => setEditingContact(null)} 
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
              >
                取消
              </button>
              <button 
                onClick={handleSaveContactModal} 
                disabled={savingContact}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2"
              >
                {savingContact ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showExcelImportModal && (
        <Modal
          open={showExcelImportModal}
          onClose={() => setShowExcelImportModal(false)}
          title="导入 Excel 数据源"
          className="max-w-md w-full"
        >
          <form onSubmit={handleExcelImport} className="space-y-4">
            <div>
              <label className="text-xs font-black text-slate-500 uppercase">数据源名称 *</label>
              <input
                type="text"
                required
                value={excelSourceName}
                onChange={(e) => setExcelSourceName(e.target.value)}
                placeholder="例如：马来西亚代理名册"
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-black text-slate-500 uppercase">描述说明</label>
              <textarea
                value={excelDescription}
                onChange={(e) => setExcelDescription(e.target.value)}
                placeholder="简要描述此来源用途（可选）"
                rows={2}
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none resize-none"
              />
            </div>
            <div>
              <label className="text-xs font-black text-slate-500 uppercase">选择 Excel 文件 *</label>
              <input
                type="file"
                required
                accept=".xlsx,.xls"
                onChange={(e) => setExcelFile(e.target.files?.[0] || null)}
                className="w-full mt-1 text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
              />
            </div>
            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <button
                type="button"
                onClick={() => setShowExcelImportModal(false)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={importingExcel}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2"
              >
                {importingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : "解析与预览数据"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showExcelPreviewModal && (
        <Modal
          open={showExcelPreviewModal}
          onClose={() => setShowExcelPreviewModal(false)}
          title="Excel 数据解析预检与处理"
          className="max-w-4xl w-full"
        >
          <div className="space-y-4 max-h-[85vh] flex flex-col">
            {/* 顶栏数据统计 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                <div className="text-xs font-bold text-slate-500">解析总行数</div>
                <div className="text-lg font-black text-slate-800">{excelPreviewRows.length}</div>
              </div>
              <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100 text-center">
                <div className="text-xs font-bold text-emerald-600">有电话号码</div>
                <div className="text-lg font-black text-emerald-700">
                  {excelPreviewRows.filter(r => !!r.phone).length}
                </div>
              </div>
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-100 text-center">
                <div className="text-xs font-bold text-amber-600">无电话号码</div>
                <div className="text-lg font-black text-amber-700">
                  {excelPreviewRows.filter(r => !r.phone).length}
                </div>
              </div>
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100 text-center">
                <div className="text-xs font-bold text-blue-600">处理后预计导入</div>
                <div className="text-lg font-black text-blue-700">
                  {excelPreviewRows.filter(r => r.selected && (excelAllowNoPhone || !!r.phone)).length}
                </div>
              </div>
            </div>

            {/* 重复号码高亮对比与处理专区 */}
            {duplicateGroupsMap.length > 0 && (
              <div className="bg-amber-50/80 border-2 border-amber-200 rounded-2xl p-3.5 space-y-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-black text-amber-900 text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <span>检测到 {duplicateGroupsMap.length} 组重复电话号码（共包含 {duplicateGroupsMap.reduce((acc, [_, list]) => acc + list.length, 0)} 条记录）</span>
                  </div>
                  <span className="text-[11px] text-amber-700 font-bold">💡 勾选保留记录，或修改号码消除重复</span>
                </div>

                <div className="space-y-2.5 max-h-48 overflow-y-auto pr-1">
                  {duplicateGroupsMap.map(([phoneNum, items]) => (
                    <div key={phoneNum} className="bg-white border border-amber-200 rounded-xl p-2.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between font-black border-b border-slate-100 pb-1.5">
                        <span className="text-amber-800 font-mono">📞 电话号码: {phoneNum} （在 Excel 中包含 {items.length} 条冲突数据）</span>
                        <button
                          type="button"
                          onClick={() => {
                            // 合并该组记录为一个联系人
                            const primaryName = items.map(i => i.row.name).filter(n => n && n !== "未命名").join(" / ") || "未命名";
                            const primaryRowIdx = items[0].origIndex;
                            setExcelPreviewRows(prev => {
                              const next = [...prev];
                              next[primaryRowIdx] = {
                                ...next[primaryRowIdx],
                                name: primaryName,
                                selected: true
                              };
                              items.slice(1).forEach(i => {
                                next[i.origIndex] = {
                                  ...next[i.origIndex],
                                  selected: false
                                };
                              });
                              return next;
                            });
                          }}
                          className="text-[10px] bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
                        >
                          🔀 一键合并为 1 条记录
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {items.map(({ row, origIndex }) => (
                          <div key={row.id} className={`flex items-center justify-between gap-2 p-2 rounded-lg border ${row.selected ? "bg-amber-50/50 border-amber-200" : "bg-slate-50 border-slate-200 opacity-60"}`}>
                            <label className="flex items-center gap-2 cursor-pointer select-none font-bold text-slate-800 truncate">
                              <input
                                type="checkbox"
                                checked={row.selected}
                                onChange={() => {
                                  setExcelPreviewRows(prev => {
                                    const next = [...prev];
                                    next[origIndex] = { ...next[origIndex], selected: !next[origIndex].selected };
                                    return next;
                                  });
                                }}
                                className="w-3.5 h-3.5 rounded text-amber-600 focus:ring-amber-500"
                              />
                              <span className="truncate">{row.name} ({row.market || "无市场"})</span>
                            </label>
                            
                            <input
                              type="text"
                              value={row.phone}
                              onChange={(e) => handleUpdatePreviewPhone(origIndex, e.target.value)}
                              placeholder="修改号码"
                              className="w-28 px-2 py-0.5 border border-slate-300 rounded text-[11px] font-mono font-bold bg-white focus:border-blue-500 outline-none"
                              title="修改此号码可解开重复"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 设置控制选项 */}
            <div className="bg-slate-50 p-3.5 rounded-2xl border border-slate-200/80 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                <label className="flex items-center gap-2 font-black text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={excelAllowNoPhone}
                    onChange={(e) => setExcelAllowNoPhone(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                  />
                  允许导入无电话号码的数据记录 (默认跳过)
                </label>

                <div className="flex items-center gap-2">
                  <span className="font-black text-slate-600">重复号码处理策略:</span>
                  <select
                    value={excelDuplicateStrategy}
                    onChange={(e) => setExcelDuplicateStrategy(e.target.value as any)}
                    className="bg-white border border-slate-300 text-slate-800 font-black rounded-lg px-2.5 py-1 outline-none text-xs"
                  >
                    <option value="ALLOW">➕ 允许重复并存导入（完全保留）</option>
                    <option value="SKIP">🚫 自动跳过重复项</option>
                    <option value="OVERWRITE">🔄 覆盖更新旧数据</option>
                  </select>
                </div>
              </div>
              <div className="text-[11px] text-slate-500 font-bold flex items-center gap-1.5">
                <span>💡 提示：电话号码已自动擦除 `+` 符号保持纯数字。您可以在下方表格中点击勾选/取消勾选，或双击修改电话号码。</span>
              </div>
            </div>

            {/* 搜索框与表格 */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <input
                type="text"
                value={excelPreviewSearch}
                onChange={(e) => setExcelPreviewSearch(e.target.value)}
                placeholder="搜索姓名、电话或关系..."
                className="w-64 px-3 py-1.5 text-xs font-bold border border-slate-200 rounded-lg outline-none focus:border-blue-500"
              />
              <span className="text-xs text-slate-400 font-bold">显示 {excelPreviewRows.length} 条预览明细</span>
            </div>

            <div className="overflow-y-auto max-h-56 border border-slate-100 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-black border-b border-slate-100 sticky top-0">
                  <tr>
                    <th className="p-2.5 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={excelPreviewRows.length > 0 && excelPreviewRows.every(r => r.selected)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setExcelPreviewRows(prev => prev.map(r => ({ ...r, selected: checked })));
                        }}
                        className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500"
                      />
                    </th>
                    <th className="p-2.5 w-10 text-center">#</th>
                    <th className="p-2.5">姓名</th>
                    <th className="p-2.5">电话号码 (可在此直接修改)</th>
                    <th className="p-2.5">市场</th>
                    <th className="p-2.5">关系</th>
                    <th className="p-2.5 w-24 text-center">状态校验</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {excelPreviewRows
                    .filter(r => !excelPreviewSearch || r.name.includes(excelPreviewSearch) || r.phone.includes(excelPreviewSearch) || r.relation.includes(excelPreviewSearch))
                    .map((r, idx) => {
                      const hasPhone = !!r.phone;
                      return (
                        <tr key={r.id} className={`hover:bg-slate-50 ${!r.selected ? "opacity-40 bg-slate-50/50" : ""}`}>
                          <td className="p-2 text-center">
                            <input
                              type="checkbox"
                              checked={r.selected}
                              onChange={() => {
                                setExcelPreviewRows(prev => {
                                  const next = [...prev];
                                  next[idx] = { ...next[idx], selected: !next[idx].selected };
                                  return next;
                                });
                              }}
                              className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500"
                            />
                          </td>
                          <td className="p-2 text-center text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                          <td className="p-2 font-bold text-slate-800">{r.name}</td>
                          <td className="p-2">
                            <input
                              type="text"
                              value={r.phone}
                              onChange={(e) => handleUpdatePreviewPhone(idx, e.target.value)}
                              placeholder="无号码 (可在线修改)"
                              className={`w-full px-2 py-1 border rounded-lg text-xs font-mono font-bold outline-none ${!hasPhone ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 focus:border-blue-500 bg-white"}`}
                            />
                          </td>
                          <td className="p-2 text-slate-600">{r.market || "-"}</td>
                          <td className="p-2 text-slate-600">{r.relation || "-"}</td>
                          <td className="p-2 text-center">
                            {hasPhone ? (
                              <span className="inline-block px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-black">
                                有效号码
                              </span>
                            ) : (
                              <span className="inline-block px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-black">
                                无号码
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* 按钮底栏 */}
            <div className="pt-3 border-t border-slate-100 flex gap-3">
              <button
                type="button"
                onClick={() => setShowExcelPreviewModal(false)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
              >
                返回重新选择
              </button>
              <button
                type="button"
                onClick={handleConfirmExcelImport}
                disabled={importingExcel}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2 shadow-md shadow-blue-100"
              >
                {importingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : `确认完成导入 (${excelPreviewRows.filter(r => r.selected && (excelAllowNoPhone || !!r.phone)).length} 条数据)`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showWhatsappImportModal && (
        <Modal
          open={showWhatsappImportModal}
          onClose={() => setShowWhatsappImportModal(false)}
          title="🟢 从 WhatsApp 实例导入联系人"
          className={previewContacts.length > 0 ? "max-w-4xl w-full" : "max-w-2xl w-full"}
        >
          {fetchingPreview && (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <Loader2 className="w-12 h-12 animate-spin text-emerald-600" />
              <div className="text-center">
                <h3 className="text-sm font-black text-slate-800">正在抓取 WhatsApp 在线实例数据</h3>
                <p className="text-xs text-slate-400 font-bold mt-1">此过程需要从 WhatsApp API 读取联系人与聊天列表，不会直接存库，请稍候...</p>
              </div>
            </div>
          )}

          {!fetchingPreview && previewContacts.length === 0 && (
            <form onSubmit={fetchWhatsappPreview} className="space-y-6">
              {/* 第一部分：数据源及实例配置 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-black text-slate-500 uppercase">选择目标数据源 *</label>
                    <select
                      value={whatsappImportSourceId}
                      onChange={(e) => setWhatsappImportSourceId(e.target.value)}
                      className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2.5 text-sm font-black text-slate-800 focus:border-blue-500 outline-none cursor-pointer"
                    >
                      <option value="whatsapp_sync">(系统默认) WhatsApp 同步</option>
                      <optgroup label="合并进已有数据源">
                        {dataSources.map((ds: any) => (
                          <option key={ds.id} value={ds.id}>{ds.name} ({ds.type === 'WHATSAPP' ? 'WhatsApp' : ds.type})</option>
                        ))}
                      </optgroup>
                      <option value="new">🆕 [＋ 新建独立数据源...]</option>
                    </select>
                  </div>

                  {whatsappImportSourceId === "new" && (
                    <div>
                      <label className="text-xs font-black text-slate-500 uppercase">新数据源名称 *</label>
                      <input
                        type="text"
                        required
                        value={whatsappImportNewName}
                        onChange={(e) => setWhatsappImportNewName(e.target.value)}
                        placeholder="例如：WhatsApp同步_马来西亚"
                        className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-xs font-black text-slate-500 uppercase">描述备注说明</label>
                    <textarea
                      value={whatsappImportSourceId === "new" ? whatsappImportNewDesc : ""}
                      disabled={whatsappImportSourceId !== "new"}
                      onChange={(e) => setWhatsappImportNewDesc(e.target.value)}
                      placeholder={whatsappImportSourceId === "new" ? "可在此输入备注，便于后续在联系人中心中区分筛选此批次数据（选填）" : "使用已有数据源时，备注说明不可编辑"}
                      rows={2}
                      className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none resize-none disabled:opacity-60"
                    />
                  </div>

                  {/* 重复号码处理策略 */}
                  <div className="pt-2">
                    <label className="text-xs font-black text-slate-500 uppercase block mb-1">重复号码处理策略 *</label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setWhatsappDuplicateStrategy("ALLOW")}
                        className={`p-2.5 rounded-xl border-2 text-left flex flex-col gap-1 transition-all ${
                          whatsappDuplicateStrategy === "ALLOW"
                            ? "border-blue-600 bg-blue-50/60 text-blue-900 ring-2 ring-blue-100 font-bold"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <span className="text-xs font-black flex items-center gap-1">📁 独立批次 (如Excel)</span>
                        <span className="text-[10px] text-slate-500 font-semibold">独立保存，与其他批次隔离与分组</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setWhatsappDuplicateStrategy("MERGE")}
                        className={`p-2.5 rounded-xl border-2 text-left flex flex-col gap-1 transition-all ${
                          whatsappDuplicateStrategy === "MERGE"
                            ? "border-emerald-600 bg-emerald-50/60 text-emerald-900 ring-2 ring-emerald-100 font-bold"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <span className="text-xs font-black flex items-center gap-1">🟢 覆盖与合并</span>
                        <span className="text-[10px] text-slate-500 font-semibold">相同号码合并标签与属性，保持全局唯一</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setWhatsappDuplicateStrategy("SKIP")}
                        className={`p-2.5 rounded-xl border-2 text-left flex flex-col gap-1 transition-all ${
                          whatsappDuplicateStrategy === "SKIP"
                            ? "border-amber-600 bg-amber-50/60 text-amber-900 ring-2 ring-amber-100 font-bold"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        <span className="text-xs font-black flex items-center gap-1">🚫 忽略已有号码</span>
                        <span className="text-[10px] text-slate-500 font-semibold">数据库中已有的号码跳过不操作</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-black text-slate-500 uppercase block mb-1">选择同步账号 (可多选) *</label>
                  {loadingInstances ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400 py-3 font-semibold">
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-600" /> 正在抓取在线实例...
                    </div>
                  ) : whatsappInstances.length === 0 ? (
                    <p className="text-xs text-red-500 font-bold py-2">⚠️ 提示：当前无在线已连接的实例，请先在「系统设置」绑定并扫码连接！</p>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto border border-slate-100 p-2.5 rounded-xl bg-slate-50 mt-1">
                      <label className="flex items-center gap-2.5 p-1 cursor-pointer select-none font-bold text-xs text-slate-700 border-b border-slate-200 pb-2 mb-2">
                        <input
                          type="checkbox"
                          checked={selectedSyncInstances.length === whatsappInstances.length}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedSyncInstances(whatsappInstances.map(i => i.rawName || i.name));
                            } else {
                              setSelectedSyncInstances([]);
                            }
                          }}
                          className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
                        />
                        <span>全选所有账号</span>
                      </label>
                      {whatsappInstances.map((inst) => {
                        const instName = inst.rawName || inst.name;
                        const isChecked = selectedSyncInstances.includes(instName);
                        return (
                          <label key={instName} className="flex items-center gap-2.5 p-1 cursor-pointer select-none text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedSyncInstances([...selectedSyncInstances, instName]);
                                } else {
                                  setSelectedSyncInstances(selectedSyncInstances.filter(name => name !== instName));
                                }
                              }}
                              className="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300 cursor-pointer"
                            />
                            <span className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-green-500"></span>
                              {inst.displayName || inst.name} <span className="text-slate-400 font-normal">({instName})</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 第二部分：设置默认附加属性字段 */}
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="text-xs font-black text-slate-700 uppercase">
                      附加默认属性字段
                    </h4>
                    <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                      这批联系人导入后将自动绑定这些标签。若属性名称中含有「日期」，值框会自动转为日期选择器。
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveFieldsTemplate}
                      className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-lg text-[10px] font-black transition-all flex items-center gap-1"
                      title="将当前附加字段结构保存为以后导入的默认模板"
                    >
                      💾 保存为模板
                    </button>
                    <button
                      type="button"
                      onClick={handleRestoreDefaultFields}
                      className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-lg text-[10px] font-black transition-all flex items-center gap-1"
                      title="重置当前属性配置为系统内定默认值"
                    >
                      🔄 恢复默认
                    </button>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowAddFieldMenu(!showAddFieldMenu)}
                        className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 rounded-lg text-[10px] font-black transition-all flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" /> ＋ 新增属性
                      </button>
                      {showAddFieldMenu && (
                        <div className="absolute right-0 top-full mt-1.5 w-64 bg-white border-2 border-slate-200 rounded-2xl shadow-2xl z-50 p-2 text-xs animate-in fade-in zoom-in-95 duration-100">
                          <div className="text-[10px] font-black text-slate-400 px-2.5 py-1 uppercase tracking-wider">快捷新增或恢复属性</div>
                          <button
                            type="button"
                            onClick={() => {
                              handleAddFieldRow();
                              setShowAddFieldMenu(false);
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded-xl font-black text-blue-600 hover:bg-blue-50 flex items-center gap-1.5 transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" /> ＋ 新增空白属性
                          </button>
                          <div className="border-t border-slate-100 my-1"></div>
                          <div className="text-[10px] font-black text-slate-400 px-2.5 py-1 uppercase tracking-wider">预设变量与更多常用属性</div>
                          <div className="max-h-48 overflow-y-auto space-y-0.5 pr-0.5">
                            {PRESET_ADD_VARIABLES.map(preset => {
                              const isCurrentInFields = whatsappImportFields.some(f => f.key === preset.key);
                              return (
                                <button
                                  key={preset.key}
                                  type="button"
                                  onClick={() => handleAddPresetField(preset.key, preset.value)}
                                  className={`w-full text-left px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center justify-between transition-colors ${
                                    isCurrentInFields ? "bg-slate-50 text-slate-400 hover:bg-slate-100" : "text-slate-700 hover:bg-blue-50 hover:text-blue-600"
                                  }`}
                                >
                                  <div className="flex flex-col">
                                    <span className="font-black">{preset.key} <span className="text-[10px] text-blue-500 font-mono">{preset.value}</span></span>
                                    <span className="text-[9px] text-slate-400">{preset.desc}</span>
                                  </div>
                                  {isCurrentInFields ? (
                                    <span className="text-[9px] font-black bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">已存在</span>
                                  ) : (
                                    <span className="text-[9px] font-black bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">添加</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {whatsappImportFields.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 font-bold">
                    暂无附加默认标签，所有导入联系人只保留系统默认标签。
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {whatsappImportFields.map((field, index) => {
                      const isDateType = /日期|时间|date|time/i.test(field.key);
                      return (
                        <div key={index} className="flex gap-3 items-center">
                          <div className="flex-1">
                            <input
                              type="text"
                              required
                              value={field.key}
                              onChange={(e) => handleFieldChange(index, "key", e.target.value)}
                              placeholder="属性名称，如: relation 或 优惠日期"
                              className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:border-blue-500 outline-none"
                            />
                          </div>
                          <div className="flex-1">
                            {isDateType ? (
                              <input
                                type="date"
                                required
                                value={field.value}
                                onChange={(e) => handleFieldChange(index, "value", e.target.value)}
                                className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:border-blue-500 outline-none h-[34px]"
                              />
                            ) : (
                              <input
                                type="text"
                                required
                                value={field.value}
                                onChange={(e) => handleFieldChange(index, "value", e.target.value)}
                                placeholder="默认属性值，如: 代理 或 未有回应"
                                className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 focus:border-blue-500 outline-none"
                              />
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveFieldRow(index)}
                            className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors flex-shrink-0"
                            title="删除属性"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 底部操作栏 */}
              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowWhatsappImportModal(false)}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={fetchingPreview}
                  className="flex-1 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2"
                >
                  {fetchingPreview ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                  获取并预览数据
                </button>
              </div>
            </form>
          )}

          {/* 第二阶段：预览与勾选列表 */}
          {!fetchingPreview && previewContacts.length > 0 && (
            <div className="space-y-4">
              {/* 统计和搜索栏 */}
              <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center bg-slate-50 p-3.5 rounded-2xl border border-slate-100">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => { setPreviewFilterType("ALL"); setPreviewPage(1); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${previewFilterType === "ALL" ? "bg-slate-800 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"}`}
                  >
                    全部 ({previewContacts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPreviewFilterType("INDIVIDUAL"); setPreviewPage(1); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${previewFilterType === "INDIVIDUAL" ? "bg-blue-600 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"}`}
                  >
                    个人 ({previewContacts.filter(c => !c.isGroup).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => { setPreviewFilterType("GROUP"); setPreviewPage(1); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${previewFilterType === "GROUP" ? "bg-emerald-600 text-white" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"}`}
                  >
                    群聊 ({previewContacts.filter(c => c.isGroup).length})
                  </button>
                </div>
                
                <input
                  type="text"
                  value={previewSearch}
                  onChange={(e) => { setPreviewSearch(e.target.value); setPreviewPage(1); }}
                  placeholder="搜索姓名或号码..."
                  className="w-full sm:w-60 border border-slate-200 rounded-xl px-3.5 py-1.5 text-xs font-bold text-slate-800 bg-white focus:border-blue-500 outline-none"
                />
              </div>

              {/* 去重快捷选择控制与状态过滤 */}
              <div className="flex flex-wrap items-center gap-4 bg-slate-50/50 p-3 rounded-xl border border-slate-100 text-xs font-bold text-slate-700">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoIgnoreExisting}
                    onChange={(e) => handleToggleAutoIgnoreExisting(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                  />
                  <span>🚫 自动忽略已在库联系人</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showOnlyNewContacts}
                    onChange={(e) => {
                      setShowOnlyNewContacts(e.target.checked);
                      setPreviewPage(1);
                    }}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                  />
                  <span>🔍 仅显示全新联系人</span>
                </label>
              </div>

              {/* 快捷批量选择操作 */}
              <div className="flex flex-wrap gap-2 items-center text-xs">
                <span className="text-slate-400 font-bold mr-1">快捷选择:</span>
                <button
                  type="button"
                  onClick={() => {
                    const selectList = filteredPreviewContacts.map(c => c.phone);
                    setSelectedPreviewPhones(new Set(selectList));
                  }}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-black rounded-lg transition-all"
                >
                  全选
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPreviewPhones(new Set())}
                  className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-black rounded-lg transition-all"
                >
                  全不选
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(selectedPreviewPhones);
                    filteredPreviewContacts.forEach(c => {
                      if (!c.isGroup) next.add(c.phone);
                    });
                    setSelectedPreviewPhones(next);
                  }}
                  className="px-2.5 py-1 bg-white hover:bg-blue-50 border border-slate-200 text-blue-600 font-black rounded-lg transition-all"
                >
                  仅选个人
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(selectedPreviewPhones);
                    filteredPreviewContacts.forEach(c => {
                      if (c.isGroup) next.add(c.phone);
                    });
                    setSelectedPreviewPhones(next);
                  }}
                  className="px-2.5 py-1 bg-white hover:bg-emerald-50 border border-slate-200 text-emerald-600 font-black rounded-lg transition-all"
                >
                  仅选群聊
                </button>
              </div>

              {/* 联系人表格 */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white max-h-[350px] overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="p-3 w-12 text-center">
                        <input
                          type="checkbox"
                          checked={filteredPreviewContacts.length > 0 && filteredPreviewContacts.every(c => selectedPreviewPhones.has(c.phone))}
                          onChange={(e) => {
                            const next = new Set(selectedPreviewPhones);
                            filteredPreviewContacts.forEach(c => {
                              if (e.target.checked) {
                                next.add(c.phone);
                              } else {
                                next.delete(c.phone);
                              }
                            });
                            setSelectedPreviewPhones(next);
                          }}
                          className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                        />
                      </th>
                      <th className="p-3 text-xs font-black text-slate-500 uppercase">姓名</th>
                      <th className="p-3 text-xs font-black text-slate-500 uppercase">电话/JID</th>
                      <th className="p-3 text-xs font-black text-slate-500 uppercase">类型</th>
                      <th className="p-3 text-xs font-black text-slate-500 uppercase">状态</th>
                      <th className="p-3 text-xs font-black text-slate-500 uppercase">账号实例</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPreviewContacts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-xs font-bold text-slate-400">
                          未匹配到任何联系人
                        </td>
                      </tr>
                    ) : (
                      filteredPreviewContacts
                        .slice((previewPage - 1) * previewPageSize, previewPage * previewPageSize)
                        .map((c) => {
                          const isSelected = selectedPreviewPhones.has(c.phone);
                          return (
                            <tr key={c.phone} className={`hover:bg-slate-50 transition-colors ${isSelected ? "bg-blue-50/20" : ""}`}>
                              <td className="p-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    const next = new Set(selectedPreviewPhones);
                                    if (e.target.checked) {
                                      next.add(c.phone);
                                    } else {
                                      next.delete(c.phone);
                                    }
                                    setSelectedPreviewPhones(next);
                                  }}
                                  className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                                />
                              </td>
                              <td className="p-3 text-xs font-black text-slate-800 truncate max-w-[150px]" title={c.name}>
                                {c.name}
                              </td>
                              <td className="p-3 text-xs font-mono font-bold text-slate-600">
                                {c.phone}
                              </td>
                              <td className="p-3">
                                {c.isGroup ? (
                                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-md">群组</span>
                                ) : c.type === "lid" ? (
                                  <span className="px-2 py-0.5 bg-indigo-100 text-indigo-800 text-[10px] font-black rounded-md">LID</span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-800 text-[10px] font-black rounded-md">个人</span>
                                )}
                              </td>
                              <td className="p-3">
                                {c.exists ? (
                                  <span className="px-2 py-0.5 bg-slate-100 text-slate-400 text-[10px] font-bold rounded-md border border-slate-200 select-none">已在库中</span>
                                ) : (
                                  <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-md border border-green-200">全新联系人</span>
                                )}
                              </td>
                              <td className="p-3 text-xs font-semibold text-slate-400 truncate max-w-[120px]" title={c.instanceName}>
                                {c.instanceName}
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>

              {/* 分页控制 */}
              {Math.ceil(filteredPreviewContacts.length / previewPageSize) > 1 && (
                <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs font-bold text-slate-500">
                  <span>
                    共 {filteredPreviewContacts.length} 条过滤结果 (当前第 {previewPage} / {Math.ceil(filteredPreviewContacts.length / previewPageSize)} 页)
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={previewPage === 1}
                      onClick={() => setPreviewPage(prev => Math.max(1, prev - 1))}
                      className="px-3 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg disabled:opacity-50"
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      disabled={previewPage === Math.ceil(filteredPreviewContacts.length / previewPageSize)}
                      onClick={() => setPreviewPage(prev => Math.min(Math.ceil(filteredPreviewContacts.length / previewPageSize), prev + 1))}
                      className="px-3 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg disabled:opacity-50"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}

              {/* 底部操作栏 */}
              <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3">
                <div className="text-xs font-black text-slate-700">
                  已选择 <span className="text-blue-600 text-sm font-black">{selectedPreviewStats.total}</span> 位联系人 (个人 {selectedPreviewStats.individuals} 位，群组 {selectedPreviewStats.groups} 组)
                </div>
                <div className="flex gap-3.5 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setPreviewContacts([])}
                    className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 font-black rounded-xl text-xs flex-1 sm:flex-none text-center"
                  >
                    上一步 (修改配置)
                  </button>
                  <button
                    type="button"
                    disabled={selectedPreviewStats.total === 0 || syncingWhatsapp}
                    onClick={triggerWhatsappSync}
                    className="px-5 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white hover:opacity-90 disabled:opacity-50 font-black rounded-xl text-xs flex-1 sm:flex-none flex items-center justify-center gap-1.5"
                  >
                    {syncingWhatsapp ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    确认导入选中的 {selectedPreviewStats.total} 位联系人
                  </button>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}



      {showDataSourceConfigModal && (
        <Modal
          open={showDataSourceConfigModal}
          onClose={() => setShowDataSourceConfigModal(false)}
          title={dataSourceConfigForm.id ? (dataSourceConfigForm.type === "NOTION" ? "配置 Notion 数据源" : "配置 Excel 数据源") : "新建 Notion 数据源"}
          className="max-w-md w-full"
        >
          <form onSubmit={handleSaveDataSourceConfig} className="space-y-4">
            <div>
              <label className="text-xs font-black text-slate-500 uppercase">数据源名称 *</label>
              <input
                type="text"
                required
                value={dataSourceConfigForm.name}
                onChange={(e) => setDataSourceConfigForm({ ...dataSourceConfigForm, name: e.target.value })}
                placeholder="例如：主站 Notion 联系人"
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-black text-slate-500 uppercase">描述说明</label>
              <textarea
                value={dataSourceConfigForm.description}
                onChange={(e) => setDataSourceConfigForm({ ...dataSourceConfigForm, description: e.target.value })}
                placeholder="简要描述此来源用途（可选）"
                rows={2}
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none resize-none"
              />
            </div>
            {dataSourceConfigForm.type === "NOTION" && (
              <>
                <div>
                  <label className="text-xs font-black text-slate-500 uppercase">Notion Secret (仅在此数据源生效，留空则自动使用全局配置)</label>
                  <div className="relative">
                    <input
                      type={showSourceSecret ? "text" : "password"}
                      autoComplete="new-password"
                      value={dataSourceConfigForm.notionSecret}
                      onChange={(e) => setDataSourceConfigForm({ ...dataSourceConfigForm, notionSecret: e.target.value })}
                      placeholder="secret_..."
                      className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl pl-4 pr-10 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSourceSecret(!showSourceSecret)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 mt-0.5 text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      {showSourceSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-black text-slate-500 uppercase">Notion Database ID (仅在此数据源生效，留空则自动使用全局配置)</label>
                  <input
                    type="text"
                    autoComplete="off"
                    value={dataSourceConfigForm.notionDatabaseId}
                    onChange={(e) => setDataSourceConfigForm({ ...dataSourceConfigForm, notionDatabaseId: e.target.value })}
                    placeholder="32位字母数字"
                    className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
                  />
                </div>
              </>
            )}
            {dataSourceConfigForm.id && dataSourceConfigForm.type === "NOTION" && (
              <div className="bg-slate-50 border border-slate-200/50 p-4 rounded-2xl flex flex-wrap gap-2 justify-center items-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowDataSourceConfigModal(false);
                    setTimeout(() => setShowForwardMappingModal(true), 300);
                  }}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-blue-100"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> 从 Notion 拉取
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDataSourceConfigModal(false);
                    setTimeout(() => setShowMappingModal(true), 300);
                  }}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl transition-colors flex items-center gap-1.5 shadow-md shadow-emerald-100"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" /> 反向同步到 Notion
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowLogsModal(true);
                    fetchSyncLogs();
                  }}
                  className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-black rounded-xl transition-colors flex items-center gap-1.5"
                >
                  <ClipboardList className="w-3.5 h-3.5" /> 同步日志
                </button>
              </div>
            )}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => setShowDataSourceConfigModal(false)}
                className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
              >
                取消
              </button>
              
              <div className="flex-1 flex gap-2">
                <button
                  type="submit"
                  onClick={() => setImportOnSave(false)}
                  disabled={savingDataSource}
                  className="flex-1 py-3 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2"
                >
                  {savingDataSource && !importOnSave ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存并关闭"}
                </button>

                {dataSourceConfigForm.type === "NOTION" && (
                  <button
                    type="submit"
                    onClick={() => setImportOnSave(true)}
                    disabled={savingDataSource}
                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-50"
                  >
                    {savingDataSource && importOnSave ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存并导入"}
                  </button>
                )}
              </div>
            </div>
          </form>
        </Modal>
      )}

      {showBulkEditModal && (
        <Modal
          open={showBulkEditModal}
          onClose={() => setShowBulkEditModal(false)}
          title={`批量修改当前名单 (${total} 位联系人)`}
          className="max-w-md w-full"
        >
          <form onSubmit={handleBulkEditSubmit} className="space-y-4">
            <div>
              <p className="text-xs text-slate-500 font-bold leading-relaxed bg-amber-50 border border-amber-100 p-3 rounded-xl">
                ⚠️ 注意：此操作会将当前筛选出的 <strong>{total}</strong> 位联系人对应的某个属性列统一修改为新值，保存后不可撤销，请谨慎操作！
              </p>
            </div>
            <div>
              <label className="text-xs font-black text-slate-500 uppercase">选择要修改的属性列 *</label>
              <select
                required
                value={bulkEditCol}
                onChange={(e) => setBulkEditCol(e.target.value)}
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2.5 text-sm font-black text-slate-800 focus:border-blue-500 outline-none cursor-pointer"
              >
                <option value="">-- 请选择要批量修改的列 --</option>
                <optgroup label="基础属性">
                  <option value="name">姓名</option>
                  <option value="phone">电话号码</option>
                  <option value="market">市场区域</option>
                  <option value="relation">业务关系标签</option>
                </optgroup>
                <optgroup label="自定义扩展属性">
                  {availableFilters.availableColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div>
              <label className="text-xs font-black text-slate-500 uppercase">修改操作模式 *</label>
              <select
                value={bulkEditMode}
                onChange={(e) => setBulkEditMode(e.target.value as any)}
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2.5 text-sm font-black text-slate-800 focus:border-blue-500 outline-none cursor-pointer"
              >
                <option value="OVERWRITE">🔄 覆盖更新 (替换原值)</option>
                <option value="APPEND">➕ 追加内容 (追加新标签或多值)</option>
                <option value="ADD_PREFIX">➕ 批量添加前缀 (例如添加区号 60 或 +)</option>
                <option value="REMOVE_PREFIX">➖ 批量移除前缀 (去除指定开头字符)</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-black text-slate-500 uppercase">
                {bulkEditMode === "ADD_PREFIX" ? "要添加的前缀字符 (如 60 或 +)" : bulkEditMode === "REMOVE_PREFIX" ? "需要移除的前缀字符" : bulkEditMode === "APPEND" ? "要追加的内容" : "统一修改为的新值"}
              </label>
              <input
                type="text"
                value={bulkEditVal}
                onChange={(e) => setBulkEditVal(e.target.value)}
                placeholder={bulkEditMode === "ADD_PREFIX" ? "例如：60" : bulkEditMode === "REMOVE_PREFIX" ? "例如：+" : bulkEditMode === "APPEND" ? "例如：新标签" : "例如：daveang98"}
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
              />
            </div>

            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <button
                type="button"
                onClick={() => setShowBulkEditModal(false)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isBulkEditing}
                className="flex-1 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2 shadow-md shadow-amber-100"
              >
                {isBulkEditing ? <Loader2 className="w-4 h-4 animate-spin" /> : "确认批量修改"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {colEditModalOpen && (
        <Modal
          open={colEditModalOpen}
          onClose={() => setColEditModalOpen(false)}
          title={`编辑列属性「${colEditOldName}」`}
          className="max-w-md w-full"
        >
          <form onSubmit={handleColEditSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-black text-slate-500 uppercase">列名称 *</label>
              <input
                type="text"
                required
                value={colEditNewName}
                onChange={(e) => setColEditNewName(e.target.value)}
                placeholder="请输入新列名..."
                className="w-full mt-1 border-2 border-slate-100 bg-slate-50 hover:border-slate-200 focus:border-blue-500 rounded-xl px-4 py-2.5 text-sm font-black text-slate-800 outline-none transition-all"
              />
            </div>

            <div className="mt-4 pt-4 border-t border-slate-100">
              <label className="flex items-center gap-2 cursor-pointer font-black text-slate-700 text-sm">
                <input
                  type="checkbox"
                  checked={colEditEnableBulk}
                  onChange={(e) => setColEditEnableBulk(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-350 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                同时批量修改该列的数据
              </label>

              {colEditEnableBulk && (
                <div className="mt-4 p-4 bg-slate-50 border border-slate-100 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div>
                    <label className="text-xs font-black text-slate-500 uppercase flex items-center justify-between">
                      <span>选择要修改的数值范围 (可多选) *</span>
                      {isLoadingColValues && <span className="text-[10px] text-blue-500 font-bold animate-pulse">正在读取已有值...</span>}
                    </label>
                    
                    {colEditUniqueValues.length === 0 && !isLoadingColValues ? (
                      <p className="text-xs text-slate-400 font-bold py-2 text-center">暂无可用数据值</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 mt-2 max-h-48 overflow-y-auto p-1.5 border border-slate-100 bg-white rounded-xl">
                        {colEditUniqueValues.map((item) => {
                          const isSelected = colEditSelectedValues.includes(item.value);
                          const isBtnEmpty = item.value === "__EMPTY__";
                          return (
                            <button
                              key={item.value}
                              type="button"
                              onClick={() => {
                                setColEditSelectedValues(prev => 
                                  isSelected 
                                    ? prev.filter(v => v !== item.value) 
                                    : [...prev, item.value]
                                );
                              }}
                              className={`flex items-center justify-between py-2 px-3 text-xs font-bold rounded-xl border-2 transition-all ${
                                isSelected
                                  ? "border-blue-600 bg-blue-50 text-blue-600 shadow-sm"
                                  : "border-slate-100 bg-slate-50 text-slate-700 hover:border-slate-200"
                              }`}
                            >
                              <span className="truncate pr-1">
                                {isBtnEmpty ? <span className="text-slate-400 italic">空数值</span> : item.value}
                              </span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-black ${
                                isSelected ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"
                              }`}>
                                {item.count}人
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-xs font-black text-slate-500 uppercase">
                      统一修改为新数值 *
                    </label>
                    <input
                      type="text"
                      required
                      value={colEditBulkNewVal}
                      onChange={(e) => setColEditBulkNewVal(e.target.value)}
                      placeholder="统一修改后的新值，如：3"
                      className="w-full mt-1 border-2 border-slate-200 bg-white rounded-xl px-3 py-2 text-sm font-bold text-slate-800 focus:border-blue-500 outline-none"
                    />
                  </div>

                  <p className="text-[11px] text-amber-600 font-bold leading-relaxed bg-amber-50/80 p-2.5 rounded-xl border border-amber-105">
                    ⚠️ 批量修改将作用于当前名单（共 {total} 位联系人）中的 <strong>{colEditSelectedCountSum}</strong> 位联系人。<br />
                    所有选中数值的数据都会被替换为「{colEditBulkNewVal || "(未填)"}」。
                  </p>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 flex gap-3">
              <button
                type="button"
                onClick={() => setColEditModalOpen(false)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isColEditing}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2 shadow-md shadow-blue-100"
              >
                {isColEditing ? <Loader2 className="w-4 h-4 animate-spin" /> : "保存并更新"}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showMergeModal && (
        <Modal
          open={showMergeModal}
          onClose={() => setShowMergeModal(false)}
          title="智能去重合并"
          className="max-w-lg w-full"
        >
          <div className="space-y-5 max-h-[80vh] overflow-y-auto pr-1">
            {/* Step 1: Data Sources Selection & Priority */}
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider block">
                1. 选择合并数据源并指定优先级 (勾选先后定优先级)
              </label>
              <div className="space-y-2 max-h-48 overflow-y-auto border border-slate-100 p-2 rounded-xl bg-slate-50">
                {dataSources.length === 0 ? (
                  <p className="text-xs text-slate-400 p-3 text-center">暂无可用的数据源</p>
                ) : (
                  dataSources.map(ds => {
                    const idx = mergeSelectedSources.indexOf(ds.id);
                    const isChecked = idx !== -1;
                    return (
                      <div
                        key={ds.id}
                        onClick={() => {
                          if (isChecked) {
                            setMergeSelectedSources(mergeSelectedSources.filter(id => id !== ds.id));
                          } else {
                            setMergeSelectedSources([...mergeSelectedSources, ds.id]);
                          }
                        }}
                        className={`flex items-center justify-between p-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                          isChecked 
                            ? "bg-blue-50/70 border-blue-200 hover:border-blue-300" 
                            : "bg-white border-transparent hover:border-slate-100"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                            isChecked ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300 text-transparent"
                          }`}>
                            <Check className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
                              {ds.type === "NOTION" ? "🇸🇬" : "📁"}
                              {ds.name}
                            </span>
                            {ds.description && (
                              <span className="text-xs text-slate-400 truncate max-w-xs">{ds.description}</span>
                            )}
                          </div>
                        </div>

                        {isChecked && (
                          <span className={`text-[10px] font-black px-2 py-1 rounded-lg shadow-sm border ${
                            idx === 0 
                              ? "bg-amber-100 text-amber-800 border-amber-200" 
                              : "bg-slate-100 text-slate-600 border-slate-200"
                          }`}>
                            {idx === 0 ? "① 主保留源" : `优先级 ${idx + 1}`}
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Step 2: Column Selection & Merge Setting */}
            {mergeSelectedSources.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-500 uppercase tracking-wider block">
                  2. 配置各个字段合并方式
                </label>
                <div className="space-y-3 max-h-48 overflow-y-auto border border-slate-100 p-2 rounded-xl bg-slate-50">
                  {mergeAllColumns.map(col => {
                    const setting = mergeColumnSettings[col] || "MERGE";
                    return (
                      <div key={col} className="flex items-center justify-between gap-3 p-2 bg-white rounded-xl border border-slate-100 shadow-sm">
                        <span className="text-xs font-bold text-slate-700 truncate max-w-[150px]">
                          {col === "relation" ? "关系标签" : col === "market" ? "市场" : col === "name" ? "姓名" : col}
                        </span>
                        <select
                          value={setting}
                          onChange={(e) => {
                            setMergeColumnSettings({
                              ...mergeColumnSettings,
                              [col]: e.target.value as "MERGE" | "PRIMARY_ONLY"
                            });
                          }}
                          className="text-xs font-black text-slate-700 bg-slate-50 border border-slate-150 rounded-lg px-2.5 py-1.5 focus:border-blue-400 outline-none cursor-pointer"
                        >
                          <option value="MERGE">合并所有数据 (并集)</option>
                          <option value="PRIMARY_ONLY">仅保留主数据源值</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 3: Save Target */}
            <div className="space-y-3">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider block">
                3. 选择合并结果保存目标
              </label>
              
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMergeSaveMode("NEW")}
                  className={`py-3 px-4 rounded-xl text-xs font-black border-2 transition-all flex flex-col items-center gap-1 ${
                    mergeSaveMode === "NEW" 
                      ? "border-blue-600 bg-blue-50/50 text-blue-700" 
                      : "border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-200"
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  <span>新建为新数据源</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMergeSaveMode("EXISTING")}
                  className={`py-3 px-4 rounded-xl text-xs font-black border-2 transition-all flex flex-col items-center gap-1 ${
                    mergeSaveMode === "EXISTING" 
                      ? "border-blue-600 bg-blue-50/50 text-blue-700" 
                      : "border-slate-100 bg-slate-50 text-slate-600 hover:border-slate-200"
                  }`}
                >
                  <Save className="w-4 h-4" />
                  <span>覆盖到现有数据源</span>
                </button>
              </div>

              {mergeSaveMode === "NEW" ? (
                <div className="space-y-1">
                  <input
                    type="text"
                    required
                    value={mergeTargetName}
                    onChange={(e) => setMergeTargetName(e.target.value)}
                    placeholder="请输入新数据源名称"
                    className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2.5 text-sm font-black text-slate-800 focus:border-blue-500 outline-none"
                  />
                  <p className="text-xs text-slate-400">
                    系统将生成一个全新的 EXCEL 数据源，现有数据源的数据不会被修改。
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <select
                    value={mergeTargetSourceId}
                    onChange={(e) => setMergeTargetSourceId(e.target.value)}
                    className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-2.5 text-sm font-black text-slate-800 focus:border-blue-500 outline-none cursor-pointer"
                  >
                    <option value="">-- 请选择要覆盖的现有数据源 --</option>
                    {dataSources.map(ds => (
                      <option key={ds.id} value={ds.id}>
                        {ds.type === "NOTION" ? "🇸🇬 Notion | " : "📁 Excel | "} {ds.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-amber-600 font-bold">
                    ⚠️ 警告：该现有数据源下所有的联系人数据将被此次合并后的去重结果完全覆盖！此操作不可逆！
                  </p>
                </div>
              )}
            </div>

            {/* Notion Auto Archive Switch */}
            {mergeSelectedSources.some(id => {
              const ds = dataSources.find(d => d.id === id);
              return ds && ds.type === "NOTION";
            }) && (
              <label className="flex items-start gap-3 p-3 rounded-2xl border border-amber-100 bg-amber-50/50 cursor-pointer hover:bg-amber-50 transition-colors">
                <input
                  type="checkbox"
                  checked={mergeAutoSyncNotion}
                  onChange={(e) => setMergeAutoSyncNotion(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-black text-amber-800">去重后，自动在 Notion 中归档（放入回收站）被删除的重复页面</span>
                  <span className="text-[10px] text-amber-600 mt-0.5 font-bold">建议勾选。此操作会将优先级较低的重复 Notion 页面状态标记为归档，避免 Notion 端数据冗余。</span>
                </div>
              </label>
            )}

            {/* Footer buttons */}
            <div className="flex gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowMergeModal(false)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                disabled={
                  isMerging || 
                  mergeSelectedSources.length === 0 || 
                  (mergeSaveMode === "NEW" && !mergeTargetName.trim()) ||
                  (mergeSaveMode === "EXISTING" && !mergeTargetSourceId)
                }
                onClick={handleMergeDuplicates}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-md shadow-blue-100"
              >
                {isMerging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isMerging ? "正在去重合并..." : "智能去重合并"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {/* 底部悬浮保存/取消栏 */}
      {hasChanges && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/95 backdrop-blur-md text-white px-6 py-4 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex items-center gap-6 border border-slate-800 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs font-black tracking-wide uppercase text-slate-300">
              有未保存的修改
            </span>
            <span className="text-xs text-slate-400 font-bold hidden sm:inline">
              (已暂存 {Object.keys(draftEdits).reduce((acc, cur) => acc + Object.keys(draftEdits[cur]).length, 0)} 项变更)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscardEdits}
              className="px-4 py-2 hover:bg-white/10 text-white rounded-xl text-xs font-black border border-white/20 transition-all"
            >
              取消修改
            </button>
            <button
              onClick={handleSaveEdits}
              className="px-5 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white rounded-xl text-xs font-black shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" /> 保存更改
            </button>
          </div>
        </div>
      )}

      {showDirtyDialog && (
        <Modal
          open={!!showDirtyDialog}
          onClose={() => handleDirtyLeave("cancel")}
          title="系统提示"
          className="max-w-md w-full"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-amber-500">
              <span className="text-3xl">⚠️</span>
              <div>
                <h4 className="text-sm font-black text-slate-900">您有未保存的修改！</h4>
                <p className="text-xs text-slate-500 font-bold mt-0.5">如果现在离开，您的修改将会丢失。</p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
              <button 
                onClick={() => handleDirtyLeave("cancel")}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
              >
                留在当前页
              </button>
              <button 
                onClick={() => handleDirtyLeave("discard")}
                className="flex-1 py-2.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 rounded-xl text-xs font-black transition-colors"
              >
                放弃修改并离开
              </button>
              <button 
                onClick={() => handleDirtyLeave("save")}
                disabled={loading}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-1.5"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                保存并离开
              </button>
            </div>
          </div>
        </Modal>
      )}
      {showExcludedModal && (
        <Modal
          open={showExcludedModal}
          onClose={() => setShowExcludedModal(false)}
          title={`🚫 手动排除人员清单 (${excludedIds.size} 人)`}
          className="max-w-2xl w-full"
        >
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center bg-red-50/80 p-3.5 rounded-2xl border border-red-200">
              <div className="text-xs text-red-800 font-bold">
                以下联系人已在当前人群包筛选中被剔除，不会包含在最终名单中。
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm("确定要恢复并加回所有被排除的联系人吗？")) {
                    setExcludedIds(new Set());
                    setShowExcludedModal(false);
                  }
                }}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black transition-all shadow-sm flex items-center gap-1.5 flex-shrink-0 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>全部恢复加回 ({excludedIds.size})</span>
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                value={excludedContactsSearch}
                onChange={(e) => setExcludedContactsSearch(e.target.value)}
                placeholder="搜索已排除的人员姓名或电话..."
                className="w-full sm:w-72 px-3.5 py-2 text-xs font-bold border border-slate-200 rounded-xl outline-none focus:border-blue-500 bg-slate-50"
              />
              <span className="text-xs text-slate-400 font-bold whitespace-nowrap">
                共 {excludedIds.size} 项排除
              </span>
            </div>

            <div className="max-h-72 overflow-y-auto border border-slate-200 rounded-2xl divide-y divide-slate-100 bg-white">
              {excludedIds.size === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 font-bold">
                  暂无手动排除的联系人
                </div>
              ) : (
                Array.from(excludedIds)
                  .map(id => {
                    const found = contacts.find(c => c.id === id);
                    return found || ({ id, name: "暂未载入信息 (位于其他页)", phone: id, sent: false, responded: false } as Contact);
                  })
                  .filter(c => !excludedContactsSearch || c.name?.includes(excludedContactsSearch) || c.phone?.includes(excludedContactsSearch))
                  .map((c) => (
                    <div key={c.id} className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50 transition-colors">
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-900 text-xs truncate">{c.name || "未命名"}</span>
                          {c.market && (
                            <span className="text-[10px] font-black bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100 flex-shrink-0">
                              {c.market}
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-[11px] text-slate-500">{c.phone}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(excludedIds);
                          next.delete(c.id);
                          setExcludedIds(next);
                        }}
                        className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl text-xs font-black transition-all flex items-center gap-1 flex-shrink-0 cursor-pointer"
                        title="把此联系人重新加回人群包"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
                        <span>加回人群包</span>
                      </button>
                    </div>
                  ))
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowExcludedModal(false)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors cursor-pointer"
              >
                完成并关闭
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
