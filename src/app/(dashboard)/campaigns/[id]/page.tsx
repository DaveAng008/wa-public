"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Play, Pause, Loader2, Settings, Send, CheckCircle2, XCircle, MessageSquare, Globe, Database, Users, Save, BookImage, Clock, RefreshCcw, ShieldCheck, ChevronRight, ChevronDown, Folder, AlertTriangle, Lock, Smartphone, ClipboardList } from "lucide-react";
import { campaignsApi, Campaign as BaseCampaign, groupsApi, materialsApi, Material as BaseMaterial, materialFoldersApi, MaterialFolder } from "@/lib/api";

interface Campaign extends BaseCampaign {
  useAi?: boolean | number;
  useRandom?: boolean | number;
  aiPrompt?: string;
  aiModel?: string;
}

interface Material extends BaseMaterial {
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "RANDOM_GROUP";
}
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SendProgress } from "@/components/campaign/SendProgress";
import { PageLoading } from "@/components/ui/LoadingSpinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";

interface LogEntry {
  id: string;
  type: "info" | "success" | "error" | "reply" | string;
  message: string;
  timestamp: string;
}

// Robust Date Parser supporting YYYY-MM-DD, YYYY/MM/DD, and Chinese date strings (e.g. 2027年5月31日, 5月31日)
function parseDateRobust(val: any): Date | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (!str) return null;

  // 1. Standard parsers
  const standardDate = new Date(str);
  if (!isNaN(standardDate.getTime())) {
    return standardDate;
  }

  // 2. Chinese format: YYYY年MM月DD日 (e.g., "2027年5月31日")
  const cnDateMatch = str.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (cnDateMatch) {
    const y = parseInt(cnDateMatch[1]);
    const m = parseInt(cnDateMatch[2]) - 1; // 0-indexed month
    const dd = parseInt(cnDateMatch[3]);
    const parsed = new Date(y, m, dd);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  // 3. Chinese format without year: MM月DD日 (e.g., "5月31日")
  const cnMonthDayMatch = str.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (cnMonthDayMatch) {
    const y = new Date().getFullYear();
    const m = parseInt(cnMonthDayMatch[1]) - 1;
    const dd = parseInt(cnMonthDayMatch[2]);
    const parsed = new Date(y, m, dd);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

export default function CampaignDetailPage() {
  const { user } = useAuth();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [groups, setGroups] = useState<any[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [folders, setFolders] = useState<MaterialFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState({ total: 0, sent: 0, failed: 0, responded: 0, remaining: 0, isRunning: false });
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [stats, setStats] = useState({ total: 0, success: 0, failed: 0, respondedRate: 0 });
  const logsEndRef = useRef<HTMLDivElement>(null);

  // 编辑态
  const [editWebhook, setEditWebhook] = useState("");
  const [editNotion, setEditNotion] = useState("");
  const [editGroupId, setEditGroupId] = useState("");
  const [editSourceId, setEditSourceId] = useState("");
  const [editInstanceName, setEditInstanceName] = useState("");
  const [availableInstances, setAvailableInstances] = useState<any[]>([]);
  const [dataSources, setDataSources] = useState<any[]>([]);
  const [editFolderId, setEditFolderId] = useState<string | "ALL">("ALL");
  const [editMaterialIds, setEditMaterialIds] = useState<string[]>([]);
  const [materialDelays, setMaterialDelays] = useState<Record<string, { min: number | ""; max: number | "" }>>({});
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // 自动化调度配置
  const [editScheduledTime, setEditScheduledTime] = useState("09:00");
  const [editBatchSize, setEditBatchSize] = useState<number | "">(10);
  const [editFrequencyValue, setEditFrequencyValue] = useState<number | "">(24);
  const [editFrequencyUnit, setEditFrequencyUnit] = useState<"hours" | "days">("hours");
  const [editTotalRuns, setEditTotalRuns] = useState<number | "">(12);
  const [editIsRepeating, setEditIsRepeating] = useState(false);
  const [editSafeWindowStart, setEditSafeWindowStart] = useState("09:00");
  const [editSafeWindowEnd, setEditSafeWindowEnd] = useState("21:00");
  const [isAutoSync, setIsAutoSync] = useState(true); // 是否开启自动同步计算
  const [editSelectedRounds, setEditSelectedRounds] = useState<number[]>([]);
  const [editExcludedIds, setEditExcludedIds] = useState<string[]>([]);
  const [previewRound, setPreviewRound] = useState<number | null>(null);
  const lastGroupIdRef = useRef<string | null>(null);

  // 当开启自动同步时，或者总轮次改变时，自动维护已选轮次
  useEffect(() => {
    if (isAutoSync && editTotalRuns !== "" && Number(editTotalRuns) > 0) {
      // 自动模式：保持全选
      const allRounds = Array.from({ length: Number(editTotalRuns) }, (_, i) => i + 1);
      if (JSON.stringify(editSelectedRounds) !== JSON.stringify(allRounds)) {
        setEditSelectedRounds(allRounds);
      }
    } else if (editTotalRuns !== "") {
      // 手动模式：过滤掉超出当前总轮次的轮次，防止越界
      const validSelected = editSelectedRounds.filter(r => r <= Number(editTotalRuns));
      if (validSelected.length !== editSelectedRounds.length) {
        setEditSelectedRounds(validSelected);
      }
    }
  }, [editTotalRuns, isAutoSync]);

  // 当群组/人群包改变时，同步加载排除名单
  useEffect(() => {
    if (editGroupId !== lastGroupIdRef.current) {
      lastGroupIdRef.current = editGroupId;
      const activeGroup = groups.find(g => g.id === editGroupId);
      if (activeGroup) {
        const cfg = typeof activeGroup.filterConfig === 'string' ? JSON.parse(activeGroup.filterConfig) : (activeGroup.filterConfig || {});
        setEditExcludedIds(cfg.excludedIds || []);
      } else {
        setEditExcludedIds([]);
      }
    }
  }, [editGroupId, groups]);

  // 扩展的自动化配置字段
  const [editTriggerType, setEditTriggerType] = useState<"SCHEDULED" | "BIRTHDAY" | "DATE_ATTRIBUTE" | "COLUMN_ENTER" | "COLUMN_TIMEOUT">("SCHEDULED");
  const [editBirthdayField, setEditBirthdayField] = useState("birthday");
  const [editBirthdayHour, setEditBirthdayHour] = useState("09:00");
  const [editDateAttrField, setEditDateAttrField] = useState("expire_date");
  const [editDateAttrOffsetDays, setEditDateAttrOffsetDays] = useState<number | "">(-10);
  const [editDateAttrHour, setEditDateAttrHour] = useState("10:00");
  const [editEnterStepId, setEditEnterStepId] = useState("");
  const [editTimeoutStepId, setEditTimeoutStepId] = useState("");
  const [editTimeoutHours, setEditTimeoutHours] = useState<number | "">(48);
  const [editScheduledDate, setEditScheduledDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");
  const [editWeekdays, setEditWeekdays] = useState<number[]>([1, 2, 3, 4, 5, 6, 0]);
  const [editDurationDays, setEditDurationDays] = useState("");
  const [editRepeatLimit, setEditRepeatLimit] = useState("");
  const [editLoopDelayDays, setEditLoopDelayDays] = useState("");
  const [editReportSenderInstance, setEditReportSenderInstance] = useState("");
  const [editReportReceiverPhone, setEditReportReceiverPhone] = useState("");

  // ── 手动临时内容录入（Adhoc）状态 ──────────────────────────────
  const [adhocExpanded, setAdhocExpanded] = useState(false);
  const [adhocType, setAdhocType] = useState<"TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT">("TEXT");
  const [adhocContent, setAdhocContent] = useState("");
  const [adhocLinks, setAdhocLinks] = useState<string[]>([""]);  // 每条一个 URL
  const [adhocName, setAdhocName] = useState("");
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [adhocSaving, setAdhocSaving] = useState(false);

  const calculateEndDate = (startDate: string, daysStr: string) => {
    const days = parseInt(daysStr, 10);
    if (!startDate || isNaN(days) || days <= 0) return "";
    const [y, m, d] = startDate.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days - 1);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const calculateDurationDays = (startDate: string, endDate: string) => {
    if (!startDate || !endDate) return "";
    const [sy, sm, sd] = startDate.split("-").map(Number);
    const [ey, em, ed] = endDate.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    const diffTime = end.getTime() - start.getTime();
    if (diffTime < 0) return "";
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays > 0 ? diffDays.toString() : "";
  };
  const [steps, setSteps] = useState<any[]>([]);

  // custom date properties states
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [dateColumns, setDateColumns] = useState<string[]>([]);
  const [isCustomBirthday, setIsCustomBirthday] = useState(false);
  const [isCustomDateAttr, setIsCustomDateAttr] = useState(false);

  // AI 赋能配置
  const [editUseAi, setEditUseAi] = useState(false);
  const [editUseRandom, setEditUseRandom] = useState(false);
  const [editAiPrompt, setEditAiPrompt] = useState("");
  const [editAiModel, setEditAiModel] = useState("gpt-4o-mini");
  const [useCustomConfig, setUseCustomConfig] = useState(false);

  const getScheduledForecast = () => {
    if (!editScheduledDate) return [];
    const forecast: { round: number; cycleNum: number; dateStr: string }[] = [];
    const [y, m, d] = editScheduledDate.split("-").map(Number);
    let currentDate = new Date(y, m - 1, d);
    
    const timeStr = editScheduledTime || "09:00";
    const [hour, minute] = timeStr.split(":").map(Number);
    currentDate.setHours(hour, minute, 0, 0);

    const freqValue = editFrequencyValue || 24;
    const freqUnit = editFrequencyUnit || "hours";
    const stepMs = freqUnit === "hours" ? freqValue * 60 * 60 * 1000 : freqValue * 24 * 60 * 60 * 1000;

    const rounds = [...editSelectedRounds].sort((a, b) => a - b);
    if (rounds.length === 0) return [];
    
    const maxCycles = editIsRepeating 
      ? Math.min(3, parseInt(editRepeatLimit, 10) || 2) 
      : 1;

    const loopDelayDaysVal = editIsRepeating ? (parseInt(editLoopDelayDays, 10) || 0) : 0;
    const loopDelayMs = loopDelayDaysVal * 24 * 60 * 60 * 1000;

    let lastRunMs = currentDate.getTime();
    let isFirstStepTotal = true;

    for (let c = 1; c <= maxCycles; c++) {
      for (let i = 0; i < rounds.length; i++) {
        const roundNum = rounds[i];
        let runDate: Date;
        
        if (isFirstStepTotal) {
          runDate = new Date(lastRunMs);
          isFirstStepTotal = false;
        } else {
          if (i === 0 && loopDelayMs > 0) {
            runDate = new Date(lastRunMs + loopDelayMs);
          } else {
            runDate = new Date(lastRunMs + stepMs);
          }
        }

        if (editWeekdays.length > 0) {
          let safetyCounter = 0;
          while (!editWeekdays.includes(runDate.getDay()) && safetyCounter < 365) {
            runDate.setDate(runDate.getDate() + 1);
            safetyCounter++;
          }
        }

        if (editEndDate) {
          const [ey, em, ed] = editEndDate.split("-").map(Number);
          const endLim = new Date(ey, em - 1, ed, 23, 59, 59, 999);
          if (runDate > endLim) {
            forecast.push({ round: roundNum, cycleNum: c, dateStr: "超过结束日期 (不执行)" });
            continue;
          }
        }

        lastRunMs = runDate.getTime();
        
        const mm = String(runDate.getMonth() + 1).padStart(2, '0');
        const dd = String(runDate.getDate()).padStart(2, '0');
        const hh = String(runDate.getHours()).padStart(2, '0');
        const minStr = String(runDate.getMinutes()).padStart(2, '0');
        
        const weekNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
        const wkName = weekNames[runDate.getDay()];
        
        forecast.push({
          round: roundNum,
          cycleNum: c,
          dateStr: `${mm}-${dd} (${wkName}) ${hh}:${minStr}`
        });
      }
    }
    return forecast;
  };

  // 脏检测与提示弹窗
  const [showDirtyDialog, setShowDirtyDialog] = useState<{ action: "start" | "send" | "leave", targetUrl?: string } | null>(null);

  // 移动端 Tab 状态
  const [activeTab, setActiveTab] = useState<"config" | "logs">("config");

  // 日期属性触发预览状态
  const [campaignContacts, setCampaignContacts] = useState<any[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [previewRange, setPreviewRange] = useState<"7" | "30" | "90" | "all" | "failed">("30");

  const isReadOnly = campaign?.status === "ACTIVE";

  const isDirty = (() => {
    if (!campaign) return false;
    const sc = typeof campaign.scheduleConfig === 'string' ? JSON.parse(campaign.scheduleConfig) : (campaign.scheduleConfig || {});
    
    let originalMatIds: string[] = [];
    try {
      const parsed = JSON.parse(campaign.materialId || "[]");
      if (Array.isArray(parsed)) originalMatIds = parsed;
      else if (campaign.materialId) originalMatIds = [campaign.materialId];
    } catch {
      if (campaign.materialId) originalMatIds = [campaign.materialId];
    }

    const defaultRuns = sc.totalRuns ?? 12;
    const originalSelectedRounds = sc.selectedRounds && Array.isArray(sc.selectedRounds) 
      ? sc.selectedRounds 
      : Array.from({ length: defaultRuns }, (_, i) => i + 1);

    const activeGroup = groups.find(g => g.id === editGroupId);
    const originalCfg = activeGroup ? (typeof activeGroup.filterConfig === 'string' ? JSON.parse(activeGroup.filterConfig) : (activeGroup.filterConfig || {})) : {};
    const originalExcluded = originalCfg.excludedIds || [];
    const excludedChanged = JSON.stringify([...editExcludedIds].sort()) !== JSON.stringify([...originalExcluded].sort());

    const delaysChanged = (() => {
      const dbDelays = sc.materialDelays || {};
      for (const mId of editMaterialIds) {
        const stateDelay = materialDelays[mId];
        const dbDelay = dbDelays[mId];
        
        const m = materials.find(x => x.id === mId);
        const typeUpper = m?.type?.toUpperCase() || "";
        const isImage = typeUpper === "IMAGE";
        const isMedia = ["VIDEO", "AUDIO", "DOCUMENT"].includes(typeUpper);
        const defaultMin = isImage ? 13 : (isMedia ? 24 : 10);
        const defaultMax = isImage ? 20 : (isMedia ? 50 : 20);

        const stateMin = stateDelay?.min !== undefined && stateDelay?.min !== "" && stateDelay?.min !== null ? Number(stateDelay.min) : defaultMin;
        const stateMax = stateDelay?.max !== undefined && stateDelay?.max !== "" && stateDelay?.max !== null ? Number(stateDelay.max) : defaultMax;

        const dbMin = dbDelay?.min !== undefined && dbDelay?.min !== "" && dbDelay?.min !== null ? Number(dbDelay.min) : defaultMin;
        const dbMax = dbDelay?.max !== undefined && dbDelay?.max !== "" && dbDelay?.max !== null ? Number(dbDelay.max) : defaultMax;

        if (stateMin !== dbMin || stateMax !== dbMax) {
          return true;
        }
      }
      
      const dbKeys = Object.keys(dbDelays).filter(k => editMaterialIds.includes(k));
      if (dbKeys.length !== editMaterialIds.length) {
        return true;
      }
      
      return false;
    })();

    return (
      editGroupId !== (campaign.groupId || "") ||
      editSourceId !== ((campaign as any).sourceId || "") ||
      editInstanceName !== ((campaign as any).instanceName || "") ||
      editUseAi !== (campaign.useAi === 1 || campaign.useAi === true) ||
      editUseRandom !== (campaign.useRandom === 1 || campaign.useRandom === true) ||
      editAiPrompt !== (campaign.aiPrompt || "") ||
      editAiModel !== (campaign.aiModel || "gpt-4o-mini") ||
      JSON.stringify(editMaterialIds) !== JSON.stringify(originalMatIds) ||
      editTriggerType !== (sc.triggerType === "MANUAL" ? "SCHEDULED" : (sc.triggerType || "SCHEDULED")) ||
      editBirthdayField !== (sc.birthdayField || "birthday") ||
      editBirthdayHour !== (sc.birthdayHour || "09:00") ||
      editDateAttrField !== (sc.dateAttrField || "expire_date") ||
      (editDateAttrOffsetDays === "" ? -10 : Number(editDateAttrOffsetDays)) !== (sc.dateAttrOffsetDays !== undefined ? sc.dateAttrOffsetDays : -10) ||
      editDateAttrHour !== (sc.dateAttrHour || "10:00") ||
      editEnterStepId !== (sc.enterStepId || "") ||
      editTimeoutStepId !== (sc.timeoutStepId || "") ||
      (editTimeoutHours === "" ? 48 : Number(editTimeoutHours)) !== (sc.timeoutHours ?? 48) ||
      editScheduledDate !== (sc.scheduledDate || "") ||
      editEndDate !== (sc.endDate || "") ||
      editDurationDays !== (sc.durationDays || "") ||
      JSON.stringify(editWeekdays) !== JSON.stringify(sc.weekdays || [1, 2, 3, 4, 5, 6, 0]) ||
      editScheduledTime !== (sc.scheduledTime ?? "09:00") ||
      (editBatchSize === "" ? 10 : Number(editBatchSize)) !== (sc.batchSize ?? 10) ||
      (editFrequencyValue === "" ? 24 : Number(editFrequencyValue)) !== (sc.frequencyValue ?? 24) ||
      editFrequencyUnit !== (sc.frequencyUnit ?? "hours") ||
      (editTotalRuns === "" ? 12 : Number(editTotalRuns)) !== (sc.totalRuns ?? 12) ||
      isAutoSync !== (sc.isAutoSync !== false) ||
      editIsRepeating !== (sc.isRepeating ?? false) ||
      (parseInt(editRepeatLimit, 10) || 0) !== (sc.repeatLimit || 0) ||
      (parseInt(editLoopDelayDays, 10) || 0) !== (sc.loopDelayDays || 0) ||
      editSafeWindowStart !== (sc.safeWindowStart ?? "09:00") ||
      editSafeWindowEnd !== (sc.safeWindowEnd ?? "21:00") ||
      editReportSenderInstance !== (sc.reportSenderInstance || "") ||
      editReportReceiverPhone !== (sc.reportReceiverPhone || "") ||
      delaysChanged ||
      JSON.stringify(editSelectedRounds) !== JSON.stringify(originalSelectedRounds) ||
      excludedChanged
    );
  })();

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = ''; 
      }
    };
    
    const handleAnchorClick = (e: MouseEvent) => {
      if (!isDirty) return;
      
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

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener("click", handleAnchorClick, true);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener("click", handleAnchorClick, true);
    };
  }, [isDirty, router]);


  const moveMaterialUp = (index: number) => {
    if (index === 0) return;
    const next = [...editMaterialIds];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setEditMaterialIds(next);
  };

  const moveMaterialDown = (index: number) => {
    if (index === editMaterialIds.length - 1) return;
    const next = [...editMaterialIds];
    [next[index + 1], next[index]] = [next[index], next[index + 1]];
    setEditMaterialIds(next);
  };

  // ── 手动临时内容：加入发送队列 ──────────────────────────────────
  const handleAddAdhoc = async () => {
    if (adhocSaving) return;

    // 校验
    if (adhocType === "TEXT") {
      if (!adhocContent.trim()) {
        alert("请输入文字内容");
        return;
      }
    } else {
      const validLinks = adhocLinks.filter(l => l.trim());
      if (validLinks.length === 0) {
        alert("请至少输入一条有效链接");
        return;
      }
    }

    setAdhocSaving(true);
    try {
      const typeLabel: Record<string, string> = {
        TEXT: "文案", IMAGE: "图片", AUDIO: "语音", VIDEO: "视频", DOCUMENT: "文件"
      };
      const defaultDelays: Record<string, { min: number; max: number }> = {
        TEXT:     { min: 10, max: 20 },
        IMAGE:    { min: 13, max: 20 },
        AUDIO:    { min: 24, max: 50 },
        VIDEO:    { min: 24, max: 50 },
        DOCUMENT: { min: 24, max: 50 },
      };

      const namePrefix = saveToLibrary ? "" : "[临时] ";

      if (adhocType === "TEXT") {
        const matName = namePrefix + (adhocName.trim() || `${typeLabel[adhocType]} ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
        const result = await materialsApi.create({
          name: matName,
          type: adhocType,
          content: adhocContent.trim(),
          url: null,
        });
        const newId = result.id;
        // 注入本地 materials 列表（使预览能立刻显示）
        const newMat: Material = { id: newId, name: matName, type: adhocType, content: adhocContent.trim(), url: null, createdAt: new Date().toISOString() };
        setMaterials(prev => [newMat, ...prev]);
        setEditMaterialIds(prev => [...prev, newId]);
        setMaterialDelays(prev => ({ ...prev, [newId]: defaultDelays[adhocType] }));
      } else {
        // 媒体类型：支持多链接
        const validLinks = adhocLinks.filter(l => l.trim());
        for (let i = 0; i < validLinks.length; i++) {
          const link = validLinks[i].trim();
          const suffix = validLinks.length > 1 ? ` (${i + 1}/${validLinks.length})` : "";
          const matName = namePrefix + (adhocName.trim() ? adhocName.trim() + suffix : `${typeLabel[adhocType]} ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}${suffix}`);
          const result = await materialsApi.create({
            name: matName,
            type: adhocType,
            content: null,
            url: link,
          });
          const newId = result.id;
          const newMat: Material = { id: newId, name: matName, type: adhocType, content: null, url: link, createdAt: new Date().toISOString() };
          setMaterials(prev => [newMat, ...prev]);
          setEditMaterialIds(prev => [...prev, newId]);
          setMaterialDelays(prev => ({ ...prev, [newId]: defaultDelays[adhocType] }));
        }
      }

      // 重置输入
      setAdhocContent("");
      setAdhocLinks([""]);
      setAdhocName("");
      setAdhocExpanded(false);
    } catch (e: any) {
      alert("添加失败: " + e.message);
    } finally {
      setAdhocSaving(false);
    }
  };

  const toggleFolder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(expandedFolders);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedFolders(next);
  };

  const getSubFolderIds = (id: string | null): string[] => {
    if (id === null) return folders.map(f => f.id);
    const children = folders.filter(f => f.parentId === id).map(f => f.id);
    let all = [id, ...children];
    children.forEach(c => {
      all = [...all, ...getSubFolderIds(c)];
    });
    return Array.from(new Set(all));
  };

  const renderFolderTree = (parentId: string | null = null, depth = 0) => {
    const children = folders.filter(f => (f.parentId || null) === parentId);
    if (children.length === 0) return null;

    return (
      <div className={`space-y-1 ${depth > 0 ? "ml-4 border-l border-slate-200 pl-2 mt-1" : ""}`}>
        {children.map(folder => {
          const hasChildren = folders.some(f => f.parentId === folder.id);
          const isExpanded = expandedFolders.has(folder.id);
          const isSelected = editFolderId === folder.id;

          return (
            <div key={folder.id} className="flex flex-col">
              <button
                disabled={isReadOnly}
                onClick={(e) => {
                  e.preventDefault();
                  if (isReadOnly) return;
                  setEditFolderId(folder.id);
                }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all text-sm font-bold ${isSelected ? "bg-blue-100 text-blue-700" : "text-slate-600 hover:bg-slate-100"} ${isReadOnly ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <div 
                  className="w-4 h-4 flex items-center justify-center shrink-0 cursor-pointer" 
                  onClick={(e) => hasChildren ? toggleFolder(folder.id, e) : undefined}
                >
                  {hasChildren ? (isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />) : <span className="w-3 h-3" />}
                </div>
                <Folder className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{folder.name}</span>
              </button>
              {isExpanded && renderFolderTree(folder.id, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };



  const scrollToLogs = () => logsEndRef.current?.scrollIntoView({ behavior: "smooth" });

  const fetchStats = useCallback(async () => {
    try {
      const statsData = await campaignsApi.stats(id);
      
      setStats({
        total: statsData.total,
        success: statsData.sent,
        failed: statsData.failed,
        respondedRate: statsData.successRate
      });

      setProgress({
        total: statsData.total,
        sent: statsData.sent + statsData.failed,
        failed: statsData.failed,
        responded: 0,
        remaining: statsData.total - (statsData.sent + statsData.failed),
        isRunning: campaign?.status === "ACTIVE"
      });

      if (statsData.recentLogs) {
        const mappedLogs = statsData.recentLogs.map((log: any) => ({
          id: log.id,
          type: log.status === 'SENT' ? 'success' : (log.status === 'FAILED' ? 'error' : 'info'),
          message: `向 ${log.phone} 发送: ${log.message}${log.error ? ` (错误: ${log.error})` : ''}`,
          timestamp: new Date(log.createdAt).toLocaleTimeString()
        }));
        setLogs(mappedLogs);
      }
    } catch (e) {
      console.error("Fetch stats failed:", e);
    }
  }, [id, campaign?.status]);

  const fetchCampaign = useCallback(async () => {
    try {
      const [data, groupsList, materialsList, foldersList, dataSourcesList, kanbanData] = await Promise.all([
        campaignsApi.get(id),
        groupsApi.list(),
        materialsApi.list().catch(() => []),
        materialFoldersApi.list().catch(() => []),
        fetch("/api/data-sources").then(res => res.json()).catch(() => []),
        fetch("/api/kanban/data").then(res => res.json()).catch(() => [])
      ]);
      setCampaign(data);
      setGroups(groupsList);
      setMaterials(materialsList);
      setFolders(foldersList);
      setDataSources(dataSourcesList);
      setSteps(kanbanData[0]?.steps || []);
      setEditWebhook(data.n8nWebhookUrl || "");
      setEditNotion(data.notionDatabaseId || "");
      setEditGroupId(data.groupId || "");
      setEditSourceId((data as any).sourceId || "");
      setEditInstanceName((data as any).instanceName || "");
      setUseCustomConfig(!!data.n8nWebhookUrl || !!data.notionDatabaseId);
      
      // 加载用户绑定的实例列表
      try {
        const instRes = await fetch("/api/instances");
        const instData = await instRes.json();
        if (Array.isArray(instData)) {
          setAvailableInstances(instData);
        }
      } catch (e) {
        console.error("Failed to load instances", e);
      }
      
      await fetchStats();
      
      let parsedMatIds: string[] = [];
      try {
        const matIds = JSON.parse(data.materialId || "[]");
        parsedMatIds = Array.isArray(matIds) ? matIds : (data.materialId ? [data.materialId] : []);
      } catch {
        parsedMatIds = data.materialId ? [data.materialId] : [];
      }
      setEditMaterialIds(parsedMatIds);

      let rawDelays: Record<string, { min: number | ""; max: number | "" }> = {};

      if (data.scheduleConfig) {
        const sc = typeof data.scheduleConfig === 'string' ? JSON.parse(data.scheduleConfig) : data.scheduleConfig;
        setEditTriggerType(sc.triggerType === "MANUAL" ? "SCHEDULED" : (sc.triggerType || "SCHEDULED"));
        setEditBirthdayField(sc.birthdayField || "birthday");
        setEditBirthdayHour(sc.birthdayHour || "09:00");
        setEditDateAttrField(sc.dateAttrField || "expire_date");
        setEditDateAttrOffsetDays(sc.dateAttrOffsetDays !== undefined ? sc.dateAttrOffsetDays : -10);
        setEditDateAttrHour(sc.dateAttrHour || "10:00");
        setEditEnterStepId(sc.enterStepId || "");
        setEditTimeoutStepId(sc.timeoutStepId || "");
        setEditTimeoutHours(sc.timeoutHours || 48);
        setEditScheduledDate(sc.scheduledDate || "");
        setEditEndDate(sc.endDate || "");
        setEditWeekdays(sc.weekdays || [1, 2, 3, 4, 5, 6, 0]);
        setEditDurationDays(sc.durationDays || (sc.endDate && sc.scheduledDate ? calculateDurationDays(sc.scheduledDate, sc.endDate) : ""));
        setEditScheduledTime(sc.scheduledTime ?? "09:00");
        setEditBatchSize(sc.batchSize ?? 10);
        setEditFrequencyValue(sc.frequencyValue ?? 24);
        setEditFrequencyUnit(sc.frequencyUnit ?? "hours");
        setEditTotalRuns(sc.totalRuns ?? 12);
        setIsAutoSync(sc.isAutoSync !== false);
        setEditIsRepeating(sc.isRepeating ?? false);
        setEditRepeatLimit(sc.repeatLimit !== undefined ? sc.repeatLimit.toString() : "");
        setEditLoopDelayDays(sc.loopDelayDays !== undefined ? sc.loopDelayDays.toString() : "");
        setEditSafeWindowStart(sc.safeWindowStart ?? "09:00");
        setEditSafeWindowEnd(sc.safeWindowEnd ?? "21:00");
        setEditReportSenderInstance(sc.reportSenderInstance || "");
        setEditReportReceiverPhone(sc.reportReceiverPhone || "");
        rawDelays = sc.materialDelays ?? {};
        
        // 如果后端有 selectedRounds，则读取；如果没有，默认根据 totalRuns 全选
        if (sc.selectedRounds && Array.isArray(sc.selectedRounds)) {
          setEditSelectedRounds(sc.selectedRounds);
        } else {
          // 初始化全选
          const defaultRuns = sc.totalRuns ?? 12;
          setEditSelectedRounds(Array.from({ length: defaultRuns }, (_, i) => i + 1));
        }
      }

      // 自动为没有任何延迟配置的选中素材填充默认延迟间隔
      const delaysWithDefaults = { ...rawDelays };
      parsedMatIds.forEach((id: string) => {
        if (delaysWithDefaults[id] === undefined || (delaysWithDefaults[id]?.min === undefined && delaysWithDefaults[id]?.max === undefined)) {
          const m = materialsList.find((x: any) => x.id.toString() === id.toString());
          if (m) {
            const typeUpper = m.type?.toUpperCase() || "";
            const isImage = typeUpper === "IMAGE";
            const isMedia = ["VIDEO", "AUDIO", "DOCUMENT"].includes(typeUpper);
            const defaultMin = isImage ? 13 : (isMedia ? 24 : "");
            const defaultMax = isImage ? 20 : (isMedia ? 50 : "");
            if (defaultMin !== "" || defaultMax !== "") {
              delaysWithDefaults[id] = {
                min: defaultMin,
                max: defaultMax
              };
            }
          }
        }
      });
      setMaterialDelays(delaysWithDefaults);

      setEditUseAi(data.useAi === 1 || data.useAi === true);
      setEditUseRandom(data.useRandom === 1 || data.useRandom === true);
      setEditAiPrompt(data.aiPrompt || "");
      setEditAiModel(data.aiModel || "gpt-4o-mini");

    } catch {
      router.push("/campaigns");
    } finally {
      setLoading(false);
    }
  }, [id, router, fetchStats]);

  const fetchCampaignContacts = useCallback(async (groupId: string, sourceId: string, signal?: AbortSignal) => {
    if (!id) return;
    setLoadingContacts(true);
    try {
      const res = await fetch(`/api/campaigns/${id}/trigger?groupId=${encodeURIComponent(groupId)}&sourceId=${encodeURIComponent(sourceId)}`, { signal });
      if (res.ok) {
        const data = await res.json();
        setCampaignContacts(data.contacts || []);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error("Failed to fetch campaign contacts:", e);
      }
    } finally {
      setLoadingContacts(false);
    }
  }, [id]);

  useEffect(() => {
    if (loading) return; // Do not fetch campaign contacts while campaign data is still loading
    
    const controller = new AbortController();
    fetchCampaignContacts(editGroupId, editSourceId, controller.signal);
    
    return () => {
      controller.abort();
    };
  }, [editGroupId, editSourceId, fetchCampaignContacts, loading]);

  useEffect(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (campaign?.status === "ACTIVE") {
      interval = setInterval(fetchStats, 15000); // 每 15 秒轮询一次状态，而不是全部数据
    }
    return () => clearInterval(interval);
  }, [fetchStats, campaign?.status]);

  // 加载并智能检测日期格式属性列
  useEffect(() => {
    const fetchColumnsAndDetectDates = async () => {
      try {
        const filterUrl = editSourceId ? `/api/contacts/filters?sourceId=${editSourceId}` : "/api/contacts/filters";
        const fRes = await fetch(filterUrl);
        let columns: string[] = [];
        if (fRes.ok) {
          const filterData = await fRes.json();
          columns = filterData.availableColumns || [];
          setAvailableColumns(columns);
        }

        const contactsUrl = editSourceId ? `/api/contacts?limit=100&sourceId=${editSourceId}` : "/api/contacts?limit=100";
        const cRes = await fetch(contactsUrl);
        if (cRes.ok) {
          const contactsData = await cRes.json();
          const contacts = contactsData.contacts || [];
          
          const detectedDates = new Set<string>();
          
          const isDateLike = (val: any): boolean => {
            if (val === null || val === undefined) return false;
            const str = String(val).trim();
            if (!str) return false;
            if (/^\d+$/.test(str)) return false; 
            
            if (/^\d{1,2}[-/]\d{1,2}$/.test(str)) return true;
            if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) return true;
            
            const timestamp = Date.parse(str);
            if (!isNaN(timestamp)) {
              if (str.length > 5 && (str.includes("-") || str.includes("/") || str.includes("T") || str.includes(":"))) {
                return true;
              }
            }
            return false;
          };

          contacts.forEach((contact: any) => {
            const props = contact.properties || {};
            Object.keys(props).forEach(key => {
              if (isDateLike(props[key])) {
                detectedDates.add(key);
              }
            });
          });
          
          columns.forEach(col => {
            const lower = col.toLowerCase();
            if (lower.includes("date") || lower.includes("day") || lower.includes("birth") || lower.includes("expire") || lower.includes("time")) {
              detectedDates.add(col);
            }
          });

          setDateColumns(Array.from(detectedDates));
        }
      } catch (e) {
        console.error("Failed to load/detect property columns:", e);
      }
    };

    fetchColumnsAndDetectDates();
  }, [editSourceId]);

  // 根据当前选择的数据源 editSourceId 级联筛选对应的人群包
  const filteredGroupsForCampaign = useMemo(() => {
    if (!editSourceId) return groups;
    return groups.filter((g: any) => {
      try {
        const cfg = typeof g.filterConfig === 'string' ? JSON.parse(g.filterConfig) : g.filterConfig;
        const gSourceId = cfg?.sourceId || "";
        return !gSourceId || gSourceId === "all" || gSourceId === editSourceId;
      } catch {
        return true;
      }
    });
  }, [groups, editSourceId]);

  // 纯净的有效目标联系人数组（过滤掉人群包中被剔除/排除的成员）
  const validTargetContacts = useMemo(() => {
    return campaignContacts.filter((c: any) => !editExcludedIds.includes(c.id));
  }, [campaignContacts, editExcludedIds]);

  // 当前显示的覆盖人数（使用计算排除后的实际有效联系人数量）
  const currentContactCount = validTargetContacts.length > 0
    ? validTargetContacts.length
    : (() => {
        if (editGroupId && groups.length > 0) {
          const g = groups.find((g: any) => g.id === editGroupId);
          return g?.contactCount ?? campaign?.contactCount ?? 0;
        }
        return campaign?.contactCount ?? 0;
      })();

  // 自动同步：当有效目标人数或每轮发送人数变化时，自动刷新轮数与全选列表
  useEffect(() => {
    if (isAutoSync && currentContactCount > 0 && Number(editBatchSize) > 0) {
      const calcRuns = Math.ceil(currentContactCount / Number(editBatchSize));
      setEditTotalRuns(calcRuns);
      setEditSelectedRounds(Array.from({ length: calcRuns }, (_, i) => i + 1));
    }
  }, [isAutoSync, currentContactCount, editBatchSize]);

  // 日期属性触发预览数据计算
  const processedContacts = campaignContacts.map(c => {
    const props = c.properties || {};
    let rawValue = "";
    let parsedDate: Date | null = null;
    let triggerDate: Date | null = null;
    let daysRemaining: number | null = null;
    let status: "success" | "warning" | "info" | "normal" = "normal";
    let statusText = "";

    // 获取上海时间
    const tzNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
    tzNow.setHours(0, 0, 0, 0);

    if (editTriggerType === "DATE_ATTRIBUTE") {
      rawValue = props[editDateAttrField] ? String(props[editDateAttrField]) : "";
      if (rawValue) {
        parsedDate = parseDateRobust(rawValue);
        if (parsedDate) {
          triggerDate = new Date(parsedDate.getTime() + Number(editDateAttrOffsetDays) * 24 * 60 * 60 * 1000);
          triggerDate.setHours(0, 0, 0, 0);
        }
      }
    } else if (editTriggerType === "BIRTHDAY") {
      rawValue = props[editBirthdayField] ? String(props[editBirthdayField]) : "";
      if (rawValue) {
        parsedDate = parseDateRobust(rawValue);
        if (parsedDate) {
          let bdayThisYear = new Date(tzNow.getFullYear(), parsedDate.getMonth(), parsedDate.getDate());
          bdayThisYear.setHours(0, 0, 0, 0);
          if (bdayThisYear < tzNow) {
            bdayThisYear.setFullYear(tzNow.getFullYear() + 1);
          }
          triggerDate = bdayThisYear;
        }
      }
    }

    if (rawValue && !parsedDate) {
      status = "warning";
      statusText = "格式解析失败";
    } else if (triggerDate) {
      const diffTime = triggerDate.getTime() - tzNow.getTime();
      daysRemaining = Math.ceil(diffTime / (24 * 60 * 60 * 1000));
      
      if (daysRemaining < 0) {
        status = "normal";
        statusText = `已过期 ${Math.abs(daysRemaining)} 天`;
      } else if (daysRemaining === 0) {
        status = "success";
        statusText = "今天触发";
      } else {
        status = "info";
        statusText = `${daysRemaining} 天后触发`;
      }
    } else {
      statusText = "无有效日期";
    }

    return {
      id: c.id,
      name: c.name,
      phone: c.phone,
      rawValue,
      parsedDate,
      triggerDate,
      triggerDateStr: triggerDate ? triggerDate.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) : "-",
      status,
      statusText,
      daysRemaining
    };
  });

  const nonExcludedProcessed = processedContacts.filter(c => !editExcludedIds.includes(c.id));

  const count7 = nonExcludedProcessed.filter(c => c.daysRemaining !== null && c.daysRemaining >= 0 && c.daysRemaining <= 7).length;
  const count30 = nonExcludedProcessed.filter(c => c.daysRemaining !== null && c.daysRemaining >= 0 && c.daysRemaining <= 30).length;
  const count90 = nonExcludedProcessed.filter(c => c.daysRemaining !== null && c.daysRemaining >= 0 && c.daysRemaining <= 90).length;
  const countAll = nonExcludedProcessed.filter(c => c.triggerDate !== null).length;
  const countFailed = nonExcludedProcessed.filter(c => c.status === "warning").length;
  const countToday = nonExcludedProcessed.filter(c => c.daysRemaining === 0).length;

  const filteredList = nonExcludedProcessed.filter(c => {
    if (previewRange === "7") {
      return c.daysRemaining !== null && c.daysRemaining >= 0 && c.daysRemaining <= 7;
    }
    if (previewRange === "30") {
      return c.daysRemaining !== null && c.daysRemaining >= 0 && c.daysRemaining <= 30;
    }
    if (previewRange === "90") {
      return c.daysRemaining !== null && c.daysRemaining >= 0 && c.daysRemaining <= 90;
    }
    if (previewRange === "all") {
      return c.triggerDate !== null;
    }
    if (previewRange === "failed") {
      return c.status === "warning";
    }
    return true;
  }).sort((a, b) => {
    if (a.triggerDate && b.triggerDate) return a.triggerDate.getTime() - b.triggerDate.getTime();
    if (a.triggerDate) return -1;
    if (b.triggerDate) return 1;
    return 0;
  });

  // 智能计算轮次逻辑
  useEffect(() => {
    if (isAutoSync && currentContactCount && Number(editBatchSize) > 0) {
      const suggested = Math.ceil(currentContactCount / Number(editBatchSize));
      if (suggested !== Number(editTotalRuns)) {
        setEditTotalRuns(suggested);
      }
    }
  }, [editBatchSize, currentContactCount, isAutoSync]);

  // 当开关变化时，清理不符合条件的已选素材
  useEffect(() => {
    if (!materials.length) return;
    
    setEditMaterialIds(prev => {
      return prev.filter(id => {
        const m = materials.find(mat => mat.id === id);
        if (!m) return false;
        
        if (!editUseRandom && m.type === 'RANDOM_GROUP') {
          return false;
        }
        return true;
      });
    });
  }, [editUseRandom, editUseAi, materials]);

  const saveGroupExclusionsIfNeeded = async (targetGroupId: string, targetExclusions: string[]) => {
    if (!targetGroupId) return;
    const activeGroup = groups.find(g => g.id === targetGroupId);
    if (!activeGroup) return;
    const cfg = typeof activeGroup.filterConfig === 'string' ? JSON.parse(activeGroup.filterConfig) : (activeGroup.filterConfig || {});
    
    const originalExcluded = cfg.excludedIds || [];
    const excludedChanged = JSON.stringify([...targetExclusions].sort()) !== JSON.stringify([...originalExcluded].sort());
    
    if (excludedChanged) {
      cfg.excludedIds = targetExclusions;
      await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: targetGroupId,
          name: activeGroup.name,
          description: activeGroup.description,
          filterConfig: cfg,
          isUpdate: true
        })
      });
      
      // Update local groups array
      setGroups(prev => prev.map(g => {
        if (g.id === targetGroupId) {
          return { ...g, filterConfig: JSON.stringify(cfg) };
        }
        return g;
      }));
    }
  };

  const handleUpdateSettings = async () => {
    if (!campaign) return;
    const oldSc = typeof campaign.scheduleConfig === 'string' ? JSON.parse(campaign.scheduleConfig) : (campaign.scheduleConfig || {});
    setSaving(true);
    try {
      await saveGroupExclusionsIfNeeded(editGroupId, editExcludedIds);
      const updated = await campaignsApi.update(id, {
        groupId: editGroupId,
        sourceId: editSourceId || "",
        materialId: JSON.stringify(editMaterialIds),
        useAi: editUseAi,
        useRandom: editUseRandom,
        aiPrompt: editAiPrompt,
        aiModel: editAiModel,
        instanceName: editInstanceName || "",
        n8nWebhookUrl: useCustomConfig ? editWebhook.trim() : "",
        notionDatabaseId: useCustomConfig ? editNotion.trim() : "",
        scheduleConfig: {
          triggerType: editTriggerType,
          birthdayField: editBirthdayField,
          birthdayHour: editBirthdayHour,
          dateAttrField: editDateAttrField,
          dateAttrOffsetDays: editDateAttrOffsetDays === "" ? -10 : Number(editDateAttrOffsetDays),
          dateAttrHour: editDateAttrHour,
          enterStepId: editEnterStepId,
          timeoutStepId: editTimeoutStepId,
          timeoutHours: editTimeoutHours === "" ? 48 : Number(editTimeoutHours),
          scheduledDate: editScheduledDate,
          endDate: editEndDate,
          durationDays: editDurationDays,
          weekdays: editWeekdays,
          scheduledTime: editScheduledTime,
          batchSize: editBatchSize === "" ? 10 : Number(editBatchSize),
          frequencyValue: editFrequencyValue === "" ? 24 : Number(editFrequencyValue),
          frequencyUnit: editFrequencyUnit,
          totalRuns: editTotalRuns === "" ? 12 : Number(editTotalRuns),
          isAutoSync: isAutoSync,
          isRepeating: editIsRepeating,
          repeatLimit: editRepeatLimit ? parseInt(editRepeatLimit, 10) : 0,
          loopDelayDays: editLoopDelayDays ? parseInt(editLoopDelayDays, 10) : 0,
          safeWindowStart: editSafeWindowStart,
          safeWindowEnd: editSafeWindowEnd,
          reportSenderInstance: editReportSenderInstance,
          reportReceiverPhone: editReportReceiverPhone,
          materialDelays: editMaterialIds.reduce((acc, mId) => {
            const delay = materialDelays[mId];
            const m = materials.find(x => x.id === mId);
            const typeUpper = m?.type?.toUpperCase() || "";
            const isImage = typeUpper === "IMAGE";
            const isMedia = ["VIDEO", "AUDIO", "DOCUMENT"].includes(typeUpper);
            const defaultMin = isImage ? 13 : (isMedia ? 24 : 10);
            const defaultMax = isImage ? 20 : (isMedia ? 50 : 20);

            acc[mId] = {
              min: delay?.min !== undefined && delay?.min !== "" && delay?.min !== null ? Number(delay.min) : defaultMin,
              max: delay?.max !== undefined && delay?.max !== "" && delay?.max !== null ? Number(delay.max) : defaultMax
            };
            return acc;
          }, {} as Record<string, { min: number, max: number }>),
          selectedRounds: editSelectedRounds,
          state: {
            ...(oldSc.state || {}),
            // 当用户修改了定时时间时，清除旧时间槽防重锁，允许新时间立即正常触发测试
            ...(editScheduledTime !== (oldSc.scheduledTime ?? "09:00") ? { lastRunSlot: "", lastRunDate: "", lastRunTimeMs: 0 } : {})
          },
        }
      });
      setCampaign(updated);
      alert("配置已更新！");
    } catch (e: any) {
      alert("更新失败: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!campaign) return;
    setToggleLoading(true);
    const newStatus = campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      const updated = await campaignsApi.update(id, { status: newStatus });
      setCampaign(updated);
    } catch {} finally { setToggleLoading(false); }
  };

  const handleResetScheduleState = async () => {
    if (!campaign) return;
    if (!confirm("确定要重置该活动的自动触发状态吗？这会清除已发送的历史记录，允许今天重新检查和触发发送。")) return;
    
    setSaving(true);
    try {
      const sc = typeof campaign.scheduleConfig === 'string' ? JSON.parse(campaign.scheduleConfig) : (campaign.scheduleConfig || {});
      const updated = await campaignsApi.update(id, {
        scheduleConfig: {
          ...sc,
          state: {} // 清空所有历史状态，包括 notifiedDateAttrs 和 lastDailyRunDate
        }
      });
      setCampaign(updated);
      alert("触发状态已重置！");
    } catch (e: any) {
      alert("重置失败: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!campaign) return;
    setShowSendDialog(false);
    setSending(true);
    setLogs([{ id: "start", type: "info", message: "正在保存最新配置并联系发送服务器...", timestamp: new Date().toLocaleTimeString() }]);
    try {
      await saveGroupExclusionsIfNeeded(editGroupId, editExcludedIds);
      const roundToRun = editSelectedRounds.length > 0 ? editSelectedRounds[0] : 1;
      
      // 1. 先保存当前界面的所有最新配置到数据库，确保触发时能读取到最新的变量和延迟设置
      await campaignsApi.update(id, {
        groupId: editGroupId,
        sourceId: editSourceId || "",
        materialId: JSON.stringify(editMaterialIds),
        useAi: editUseAi,
        useRandom: editUseRandom,
        aiPrompt: editAiPrompt,
        aiModel: editAiModel,
        instanceName: editInstanceName || "",
        n8nWebhookUrl: useCustomConfig ? editWebhook.trim() : "",
        notionDatabaseId: useCustomConfig ? editNotion.trim() : "",
        scheduleConfig: {
          triggerType: editTriggerType,
          birthdayField: editBirthdayField,
          birthdayHour: editBirthdayHour,
          dateAttrField: editDateAttrField,
          dateAttrOffsetDays: editDateAttrOffsetDays,
          dateAttrHour: editDateAttrHour,
          enterStepId: editEnterStepId,
          timeoutStepId: editTimeoutStepId,
          timeoutHours: editTimeoutHours,
           scheduledDate: editScheduledDate,
          endDate: editEndDate,
          durationDays: editDurationDays,
          weekdays: editWeekdays,
          scheduledTime: editScheduledTime,
          batchSize: editBatchSize,
          frequencyValue: editFrequencyValue,
          frequencyUnit: editFrequencyUnit,
          totalRuns: editTotalRuns,
          isAutoSync: isAutoSync,
          isRepeating: editIsRepeating,
          repeatLimit: editRepeatLimit ? parseInt(editRepeatLimit, 10) : 0,
          loopDelayDays: editLoopDelayDays ? parseInt(editLoopDelayDays, 10) : 0,
          safeWindowStart: editSafeWindowStart,
          safeWindowEnd: editSafeWindowEnd,
          reportSenderInstance: editReportSenderInstance,
          reportReceiverPhone: editReportReceiverPhone,
          materialDelays: materialDelays,
          selectedRounds: editSelectedRounds,
          instanceName: editInstanceName || "",
          state: (campaign.scheduleConfig as any)?.state || {},
        }
      });

      // 2. 然后触发任务，此时后端会读取到最新的配置
      const result = await campaignsApi.trigger(id, undefined, roundToRun, editBatchSize === "" ? undefined : editBatchSize);
      if (result.success) {
        const isZeroContacts = (result as any).contactsCount === 0;
        setLogs((prev) => [
          ...prev, 
          { 
            id: "success", 
            type: isZeroContacts ? "info" : "success", 
            message: result.message || `指令已成功送达 n8n 工作流 (第 ${roundToRun} 轮)，后台正在发送...`, 
            timestamp: new Date().toLocaleTimeString() 
          }
        ]);
        setProgress((p) => ({ ...p, isRunning: !isZeroContacts }));
        
        // 自动取消勾选已发送的轮次
        let newSelectedRounds = editSelectedRounds.filter(r => r !== roundToRun);
        if (newSelectedRounds.length === 0 && editIsRepeating) {
          newSelectedRounds = Array.from({ length: Number(editTotalRuns) }, (_, i) => i + 1);
        }
        setEditSelectedRounds(newSelectedRounds);
        
        // 保存最新的轮次选择到后端，以防刷新后丢失，同时隐式保存当前界面的配置
        const updated = await campaignsApi.update(id, {
          groupId: editGroupId,
          sourceId: editSourceId || "",
          materialId: JSON.stringify(editMaterialIds),
          useAi: editUseAi,
          useRandom: editUseRandom,
          aiPrompt: editAiPrompt,
          aiModel: editAiModel,
          instanceName: editInstanceName || "",
          n8nWebhookUrl: useCustomConfig ? editWebhook.trim() : "",
          notionDatabaseId: useCustomConfig ? editNotion.trim() : "",
          scheduleConfig: {
            triggerType: editTriggerType,
            birthdayField: editBirthdayField,
            birthdayHour: editBirthdayHour,
            dateAttrField: editDateAttrField,
            dateAttrOffsetDays: editDateAttrOffsetDays,
            dateAttrHour: editDateAttrHour,
            enterStepId: editEnterStepId,
            timeoutStepId: editTimeoutStepId,
            timeoutHours: editTimeoutHours,
             scheduledDate: editScheduledDate,
            endDate: editEndDate,
            durationDays: editDurationDays,
            weekdays: editWeekdays,
            scheduledTime: editScheduledTime,
            batchSize: editBatchSize,
            frequencyValue: editFrequencyValue,
            frequencyUnit: editFrequencyUnit,
            totalRuns: editTotalRuns,
            isAutoSync: isAutoSync,
             isRepeating: editIsRepeating,
            repeatLimit: editRepeatLimit ? parseInt(editRepeatLimit, 10) : 0,
            loopDelayDays: editLoopDelayDays ? parseInt(editLoopDelayDays, 10) : 0,
            safeWindowStart: editSafeWindowStart,
            safeWindowEnd: editSafeWindowEnd,
            reportSenderInstance: editReportSenderInstance,
            reportReceiverPhone: editReportReceiverPhone,
            materialDelays: materialDelays,
            selectedRounds: newSelectedRounds,
            instanceName: editInstanceName || "",
            state: (campaign.scheduleConfig as any)?.state || {},
          }
        });
        // 强制保持 ACTIVE 状态——后台发送可能已改 DB 状态，但活动本身还是 ACTIVE 的
        setCampaign({ ...updated, status: "ACTIVE" });
        setSending(false);
      } else { 
        const errMsg = (result as any).error || result.message || "服务端未返回成功状态";
        throw new Error(errMsg);
      }
    } catch (e: any) {
      const displayMsg = e.message || String(e);
      setLogs((prev) => [...prev, { id: "error", type: "error", message: `发送失败: ${displayMsg}`, timestamp: new Date().toLocaleTimeString() }]);
      setSending(false);
    }
  };

  if (loading) return <PageLoading />;
  if (!campaign) return null;

  // 根据开关过滤素材
  const filteredMaterials = materials.filter(m => {
    // 目录过滤
    let folderMatch = true;
    if (editFolderId !== "ALL") {
      if (editFolderId === "UNCATEGORIZED") {
        folderMatch = !m.folderId;
      } else {
        const folderIds = getSubFolderIds(editFolderId);
        folderMatch = folderIds.includes(m.folderId || "");
      }
    }
    if (!folderMatch) return false;

    // 类型过滤
    if (!editUseRandom && m.type === 'RANDOM_GROUP') {
      return false; // 没打开随机选词时不能选 RANDOM_GROUP
    }
    // 开启 AI 或 随机选词 时，显示所有类型的素材（包括图片、视频等）
    
    return true;
  });

  return (
    <div className="space-y-6 pb-24 relative">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button 
            onClick={() => {
              if (isDirty) setShowDirtyDialog({ action: 'leave', targetUrl: '/campaigns' });
              else router.push('/campaigns');
            }} 
            className="inline-flex items-center gap-1.5 text-sm font-black text-slate-500 md:hover:text-blue-600 mb-3 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> 返回活动列表
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-4xl font-black tracking-tight text-slate-900">{campaign.name}</h1>
            <StatusBadge status={campaign.status} />
          </div>
          {campaign.description && <p className="text-slate-600 font-bold mt-1 text-lg">{campaign.description}</p>}
        </div>
      </div>

      {/* 移动端 Tab 切换器 */}
      <div className="flex p-1 bg-slate-200/80 rounded-2xl lg:hidden border-2 border-slate-200 shadow-inner max-w-md mx-auto mb-4">
        <button
          onClick={() => setActiveTab("config")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-black transition-all duration-200 ${
            activeTab === "config"
              ? "bg-white text-blue-600 shadow-md border border-slate-100"
              : "text-slate-500 md:hover:text-slate-800"
          }`}
        >
          <Settings className="w-4 h-4" />
          配置参数
        </button>
        <button
          onClick={() => setActiveTab("logs")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-black transition-all duration-200 ${
            activeTab === "logs"
              ? "bg-white text-blue-600 shadow-md border border-slate-100"
              : "text-slate-500 md:hover:text-slate-800"
          }`}
        >
          <Globe className="w-4 h-4" />
          运行日志
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className={`lg:col-span-2 space-y-6 md:space-y-8 ${activeTab === "logs" ? "block" : "hidden lg:block"}`}>
          {/* Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "覆盖人数", value: stats.total || currentContactCount, icon: Users, color: "text-blue-700", bg: "bg-blue-50 border-blue-100" },
              { label: "成功送达", value: stats.success, icon: CheckCircle2, color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-100" },
              { label: "发送失败", value: stats.failed, icon: XCircle, color: "text-rose-700", bg: "bg-rose-50 border-rose-100" },
              { label: "意向回复", value: `${stats.respondedRate}%`, icon: MessageSquare, color: "text-indigo-700", bg: "bg-indigo-50 border-indigo-100" },
            ].map((s) => (
              <div key={s.label} className={`${s.bg} rounded-2xl p-4 md:p-5 border-2 shadow-sm`}>
                <div className={`${s.color} font-black text-2xl tracking-tighter`}>{s.value}</div>
                <div className="text-xs md:text-[10px] text-slate-500 mt-1 flex items-center gap-1 font-black uppercase tracking-widest">
                  <s.icon className="w-3 h-3" /> {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Progress Section */}
          {progress.sent > 0 && (
            <div className="bg-white p-4 md:p-6 rounded-3xl border-2 border-slate-200 shadow-sm">
               <SendProgress total={progress.total} sent={progress.sent} failed={progress.failed} responded={progress.responded} remaining={progress.remaining} isRunning={progress.isRunning} />
            </div>
          )}

          {/* Date Trigger Preview Panel */}
          {(editTriggerType === "BIRTHDAY" || editTriggerType === "DATE_ATTRIBUTE") && (
            <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-md p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 gap-2">
                <div>
                  <h3 className="font-black text-slate-900 text-lg flex items-center gap-2">
                    <Clock className="w-5 h-5 text-blue-600" />
                    {editTriggerType === "BIRTHDAY" ? "生日提醒发送预览" : "日期属性触发发送预览"}
                  </h3>
                  <p className="text-xs text-slate-500 font-bold mt-1">
                    实时解析属性【{editTriggerType === "BIRTHDAY" ? editBirthdayField : editDateAttrField}】的配置，预览即将触发消息的名单
                  </p>
                </div>
                <div className="text-xs text-slate-400 font-bold bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 self-start sm:self-center shrink-0">
                  符合条件总人数: <span className="font-black text-blue-600">{campaignContacts.length}</span> 人
                </div>
              </div>

              {/* Tabs for filtering */}
              <div className="flex flex-wrap gap-1 p-1 bg-slate-100/80 rounded-2xl border border-slate-200/50">
                {[
                  { key: "7", label: "最近 7 天", count: count7 },
                  { key: "30", label: "最近 30 天", count: count30 },
                  { key: "90", label: "最近 90 天", count: count90 },
                  { key: "all", label: "全部有效日期", count: countAll },
                  { key: "failed", label: "解析失败", count: countFailed, isWarning: true },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={(e) => { e.preventDefault(); setPreviewRange(tab.key as any); }}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-black transition-all ${
                      previewRange === tab.key
                        ? tab.isWarning
                          ? "bg-rose-600 text-white shadow-sm"
                          : "bg-white text-blue-600 shadow-sm border border-slate-200"
                        : tab.isWarning && tab.count > 0
                        ? "text-rose-600 hover:bg-rose-50"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      previewRange === tab.key
                        ? tab.isWarning
                          ? "bg-rose-100 text-rose-800"
                          : "bg-blue-100 text-blue-800"
                        : tab.isWarning && tab.count > 0
                        ? "bg-rose-100 text-rose-800 animate-pulse"
                        : "bg-slate-200/80 text-slate-600"
                    }`}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* Loading or List */}
              {loadingContacts ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                  <p className="text-xs font-bold uppercase tracking-widest">加载联系人列表中...</p>
                </div>
              ) : filteredList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl bg-slate-50/50">
                  <AlertTriangle className="w-8 h-8 text-slate-300" />
                  <p className="text-xs font-bold mt-2 text-slate-500">此时间段内暂无符合触发条件的联系人</p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {previewRange === "failed" 
                      ? "太棒了！所有导入的日期格式都成功解析了。" 
                      : `请检查【${editTriggerType === "BIRTHDAY" ? editBirthdayField : editDateAttrField}】属性列的数值和偏置天数设置。`}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-2xl shadow-inner max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-400 font-black tracking-widest uppercase sticky top-0 z-10">
                        <th className="p-3 pl-4 bg-slate-50">联系人姓名</th>
                        <th className="p-3 bg-slate-50">电话号码</th>
                        <th className="p-3 bg-slate-50">原始日期属性</th>
                        <th className="p-3 bg-slate-50">计算触发日期</th>
                        <th className="p-3 pr-4 text-right bg-slate-50">触发倒计时</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                      {filteredList.map(item => (
                        <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-3 pl-4 font-black text-slate-900">{item.name}</td>
                          <td className="p-3 text-slate-500 font-mono">{item.phone}</td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded font-mono text-[11px] ${
                              item.status === "warning" ? "bg-rose-50 text-rose-600 border border-rose-100" : "bg-slate-50 text-slate-600 border border-slate-100"
                            }`}>
                              {item.rawValue || "(未设置)"}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-slate-800">{item.triggerDateStr}</td>
                          <td className="p-3 pr-4 text-right">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                              item.status === "warning"
                                ? "bg-rose-100 text-rose-800 border border-rose-200"
                                : item.status === "success"
                                ? "bg-emerald-100 text-emerald-800 animate-pulse border border-emerald-200"
                                : item.status === "info"
                                ? "bg-blue-100 text-blue-800 border border-blue-200"
                                : "bg-slate-100 text-slate-600 border border-slate-200"
                            }`}>
                              {item.statusText}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Logs */}
          <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-md overflow-hidden">
            <div className="px-4 md:px-6 py-4 bg-slate-900 flex items-center justify-between">
              <h2 className="font-black text-white text-sm flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-400" /> 实时执行日志
              </h2>
              {progress.isRunning && <span className="px-2 py-0.5 bg-green-500 text-xs md:text-[10px] font-black text-white rounded-full animate-pulse uppercase">Live</span>}
            </div>
            <div className="h-80 overflow-y-auto p-4 space-y-2 bg-slate-50 font-mono">
              {logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-2 opacity-50">
                  <Loader2 className="w-8 h-8" />
                  <p className="text-xs font-bold uppercase tracking-widest">等待发送任务启动...</p>
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-4 text-xs border-b border-slate-100 pb-1 last:border-0">
                    <span className="text-slate-400 font-bold">{log.timestamp}</span>
                    <span className={`font-black ${log.type === "success" ? "text-emerald-600" : log.type === "error" ? "text-rose-600" : log.type === "reply" ? "text-blue-600" : "text-slate-700"}`}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>

        {/* Right: Inline Editable Settings */}
        <div className={`space-y-6 relative ${activeTab === "config" ? "block" : "hidden lg:block"}`}>
          
          <div className="relative">
            <div className="bg-white rounded-3xl border-2 border-slate-200 shadow-md md:shadow-xl p-4 md:p-8 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-2 h-full bg-blue-600" />
              
              {isReadOnly && (
                <div className="mb-6 p-4 bg-amber-50 border-2 border-amber-200 rounded-2xl flex items-start gap-3 animate-in fade-in slide-in-from-top-1 duration-300">
                  <Lock className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-black text-amber-800 text-sm">只读查看模式 (配置已锁定)</h5>
                    <p className="text-xs text-amber-600 font-bold mt-1">当前活动正在运行中，已开启安全保护。所有配置参数已进入只读状态，不可更改。若需调整配置，请先暂停活动。</p>
                  </div>
                </div>
              )}

              <h3 className="font-black text-slate-900 text-xl flex items-center gap-2 mb-8">
                <Settings className="w-5 h-5 text-blue-600" /> {isReadOnly ? "活动配置中心 (只读)" : "活动配置中心"}
              </h3>
              
              <div className="space-y-6">
                {/* 1. 绑定数据源 (Data Source) - 置顶显示 */}
                <div className="group">
                  <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                    <Database className="w-3.5 h-3.5 text-blue-600" /> 绑定数据源 (Data Source)
                  </label>

                  <select 
                    value={editSourceId} 
                    disabled={isReadOnly}
                    onChange={(e) => {
                      const newSourceId = e.target.value;
                      setEditSourceId(newSourceId);
                      if (editGroupId) {
                        const currentG = groups.find(g => g.id === editGroupId);
                        if (currentG) {
                          try {
                            const cfg = typeof currentG.filterConfig === 'string' ? JSON.parse(currentG.filterConfig) : currentG.filterConfig;
                            const gSourceId = cfg?.sourceId || "";
                            if (gSourceId && gSourceId !== "all" && gSourceId !== newSourceId) {
                              setEditGroupId("");
                            }
                          } catch {}
                        }
                      }
                    }}
                    className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-3 text-sm font-black text-slate-800 focus:border-blue-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="">🌐 所有数据源 (合并视图)</option>
                    {dataSources.map(ds => (
                      <option key={ds.id} value={ds.id}>
                        {ds.type === 'NOTION' ? '🇸🇬 ' : '📁 '} {ds.name} ({ds.type})
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400 font-bold mt-1.5">
                    💡 切换数据源后，下方「目标人群包」将仅展示属于该数据源的专属人群包。
                  </p>
                </div>

                {/* 2. 目标人群包 (Target Audience) - 级联过滤显示 */}
                <div className="group">
                  <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                    <Users className="w-3.5 h-3.5 text-emerald-600" /> 目标人群包
                  </label>

                  <select 
                    value={editGroupId} 
                    disabled={isReadOnly}
                    onChange={(e) => setEditGroupId(e.target.value)}
                    className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-3 text-sm font-black text-slate-800 focus:border-blue-500 outline-none transition-all"
                  >
                    <option value="">-- 未指定人群包 (使用全量联系人) --</option>
                    {filteredGroupsForCampaign.map((g: any) => (
                      <option key={g.id} value={g.id}>{g.name} ({g.contactCount || 0}人)</option>
                    ))}
                  </select>

                  {/* 人群包即时预览 */}
                  {editGroupId && groups.find((g: any) => g.id === editGroupId) && (() => {
                    const g = groups.find((g: any) => g.id === editGroupId);
                    const cfg = typeof g.filterConfig === 'string' ? JSON.parse(g.filterConfig) : g.filterConfig;
                    return (
                      <div className="mt-3 p-4 bg-emerald-50 border-2 border-dashed border-emerald-200 rounded-2xl animate-in fade-in slide-in-from-top-1 duration-300">
                        <div className="flex justify-between items-start mb-3">
                          <div className="text-xs md:text-[10px] font-black text-emerald-600 uppercase tracking-widest">选中人群预览</div>
                          <div className="text-xl font-black text-emerald-700">{g.contactCount || 0} <span className="text-xs">人</span></div>
                        </div>
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1">
                            {cfg.markets?.length > 0 ? cfg.markets.map((m: string) => (
                              <span key={m} className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-xs md:text-[10px] font-black rounded-md">{m}</span>
                            )) : <span className="text-xs md:text-[10px] text-slate-400 font-bold">全部市场</span>}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {cfg.relations?.length > 0 ? cfg.relations.map((r: string) => (
                              <span key={r} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs md:text-[10px] font-black rounded-md">{r}</span>
                            )) : <span className="text-xs md:text-[10px] text-slate-400 font-bold">无特定关系</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

              {/* 发送实例选择器 */}
              <div className="group">
                <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                  <Smartphone className="w-3 h-3" /> 指定发送实例 (WhatsApp 账号)
                </label>
                <select
                  value={editInstanceName}
                  disabled={isReadOnly}
                  onChange={(e) => setEditInstanceName(e.target.value)}
                  className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-3 text-sm font-black text-slate-800 focus:border-blue-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="">-- 自动选取在线实例 --</option>
                  {availableInstances.map((inst: any) => {
                    const rawName = inst.rawName || inst.instanceName || inst.name || "";
                    const displayName = inst.displayName || rawName;
                    const isConnected = inst.connectionStatus === "open" || inst.state === "open" || inst.status === "open";
                    return (
                      <option key={rawName} value={rawName}>
                        {isConnected ? "🟢" : "🔴"} {displayName} ({rawName})
                      </option>
                    );
                  })}
                </select>
                <p className="text-[10px] text-slate-400 font-bold mt-1.5">
                  💡 指定后，该活动的所有消息将通过此账号发送。留空则自动使用第一个在线实例。
                </p>
                {editInstanceName && (() => {
                  const inst = availableInstances.find((i: any) => (i.rawName || i.instanceName || i.name) === editInstanceName);
                  const isConnected = inst && (inst.connectionStatus === "open" || inst.state === "open" || inst.status === "open");
                  return (
                    <div className={`mt-2 px-3 py-2 rounded-xl text-xs font-black flex items-center gap-2 ${isConnected ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-rose-50 text-rose-600 border border-rose-100"}`}>
                      {isConnected ? "✅ 当前实例在线，可正常发送" : "⚠️ 当前实例可能离线，请检查后再启动"}
                    </div>
                  );
                })()}
              </div>

              {/* 任务报告推送配置 */}
              <div className="group border-t border-slate-100 pt-4 mt-4 space-y-3">
                <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5 mb-1">
                  <ClipboardList className="w-3 h-3 text-blue-500" /> 任务报告推送配置
                </label>

                <div>
                  <span className="text-[10px] text-slate-500 font-bold mb-1 block">报告发送账号（实例）</span>
                  <select
                    value={editReportSenderInstance}
                    disabled={isReadOnly}
                    onChange={(e) => setEditReportSenderInstance(e.target.value)}
                    className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-2 text-xs font-black text-slate-800 focus:border-blue-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="">-- 同群发账号 (默认) --</option>
                    {availableInstances.map((inst: any) => {
                      const rawName = inst.rawName || inst.instanceName || inst.name || "";
                      const displayName = inst.displayName || rawName;
                      return (
                        <option key={rawName} value={rawName}>
                          {displayName} ({rawName})
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <span className="text-[10px] text-slate-500 font-bold mb-1 block">报告接收号码 (WhatsApp)</span>
                  <input
                    type="text"
                    placeholder="e.g. 60127654321 (留空则默认发送给发信实例自己)"
                    value={editReportReceiverPhone}
                    disabled={isReadOnly}
                    onChange={(e) => setEditReportReceiverPhone(e.target.value.replace(/[^0-9]/g, ""))}
                    className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-2 text-xs font-black text-slate-800 focus:border-blue-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              <div className="group">
                <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                  <BookImage className="w-3 h-3" /> 随附发送素材 (可多选)
                </label>

                
                <div className="mb-2">
                  <div className="border-2 border-slate-100 bg-slate-50 rounded-xl p-3 max-h-40 overflow-y-auto">
                    <button
                      disabled={isReadOnly}
                      onClick={(e) => { e.preventDefault(); if (isReadOnly) return; setEditFolderId("ALL"); }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all text-sm font-bold mb-1 ${editFolderId === "ALL" ? "bg-blue-100 text-blue-700" : "text-slate-600 hover:bg-slate-100"} ${isReadOnly ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      <BookImage className="w-3.5 h-3.5" />
                      全部素材
                    </button>
                    <button
                      disabled={isReadOnly}
                      onClick={(e) => { e.preventDefault(); if (isReadOnly) return; setEditFolderId("UNCATEGORIZED"); }}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all text-sm font-bold mb-1 ${editFolderId === "UNCATEGORIZED" ? "bg-blue-100 text-blue-700" : "text-slate-600 hover:bg-slate-100"} ${isReadOnly ? "opacity-60 cursor-not-allowed" : ""}`}
                    >
                      <Folder className="w-3.5 h-3.5" />
                      未分类素材
                    </button>
                    {renderFolderTree(null, 0)}
                  </div>
                </div>

                <div className="space-y-1 max-h-48 overflow-y-auto border-2 border-slate-100 bg-slate-50 rounded-xl p-2">
                  {filteredMaterials.length === 0 && <div className="text-xs text-slate-400 text-center py-2">该目录下暂无素材</div>}
                  
                  {filteredMaterials.map(m => (
                    <label key={m.id} className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${isReadOnly ? "cursor-not-allowed opacity-80" : "md:hover:bg-slate-100 cursor-pointer"}`}>
                      <input 
                        type="checkbox" 
                        checked={editMaterialIds.includes(m.id)}
                        disabled={isReadOnly}
                        onChange={(e) => {
                           if (e.target.checked) {
                             setEditMaterialIds([...editMaterialIds, m.id]);
                             // 自动为新选择的素材填充默认时间间隔（图片 13-20秒，视频/语音/文件 24-50秒）
                             if (materialDelays[m.id] === undefined || (materialDelays[m.id]?.min === undefined && materialDelays[m.id]?.max === undefined)) {
                               const typeUpper = m.type?.toUpperCase() || "";
                               const isImage = typeUpper === "IMAGE";
                               const isMedia = ["VIDEO", "AUDIO", "DOCUMENT"].includes(typeUpper);
                               const defaultMin = isImage ? 13 : (isMedia ? 24 : "");
                               const defaultMax = isImage ? 20 : (isMedia ? 50 : "");
                               if (defaultMin !== "" || defaultMax !== "") {
                                 setMaterialDelays(prev => ({
                                   ...prev,
                                   [m.id]: { min: defaultMin, max: defaultMax }
                                 }));
                               }
                             }
                           } else {
                             setEditMaterialIds(editMaterialIds.filter(id => id !== m.id));
                           }
                        }}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 shrink-0"
                      />
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-sm font-bold text-slate-800 truncate">
                          [{m.type?.toUpperCase() === "TEXT" ? "文案" : m.type?.toUpperCase() === "IMAGE" ? "图片" : m.type?.toUpperCase() === "AUDIO" ? "语音" : m.type?.toUpperCase() === "DOCUMENT" ? "文件" : m.type?.toUpperCase() === "RANDOM_GROUP" ? "随机词组" : "视频"}] {m.name}
                        </span>
                        {editFolderId === "ALL" && m.folderId && folders.find(f => f.id === m.folderId) && (
                           <span className="text-xs md:text-[10px] text-blue-400 font-medium truncate">📁 {folders.find(f => f.id === m.folderId)?.name}</span>
                        )}
                      </div>
                    </label>
                  ))}
                </div>

                {/* ── 手动临时内容录入面板 ── */}
                {!isReadOnly && (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setAdhocExpanded(p => !p)}
                      className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50 text-blue-600 text-xs font-black md:hover:bg-blue-100 transition-colors"
                    >
                      <span className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                        手动添加临时内容（文字 / 图片 / 语音 / 视频）
                      </span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${adhocExpanded ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6"/></svg>
                    </button>

                    {adhocExpanded && (
                      <div className="mt-2 p-3 bg-white border-2 border-blue-200 rounded-xl space-y-3 shadow-sm">
                        {/* 类型选择 */}
                        <div className="flex gap-1.5 flex-wrap">
                          {(["TEXT", "IMAGE", "AUDIO", "VIDEO", "DOCUMENT"] as const).map(t => {
                            const labels: Record<string, string> = { TEXT: "📝 文字", IMAGE: "🖼️ 图片", AUDIO: "🎙️ 语音", VIDEO: "🎬 视频", DOCUMENT: "📄 文件" };
                            return (
                              <button
                                key={t}
                                type="button"
                                onClick={() => { setAdhocType(t); setAdhocLinks([""]); setAdhocContent(""); }}
                                className={`px-2.5 py-1 rounded-lg text-xs font-black transition-colors border ${
                                  adhocType === t
                                    ? "bg-blue-600 text-white border-blue-600"
                                    : "bg-white text-slate-600 border-slate-200 md:hover:border-blue-400"
                                }`}
                              >
                                {labels[t]}
                              </button>
                            );
                          })}
                        </div>

                        {/* 内容输入区 */}
                        {adhocType === "TEXT" ? (
                          <textarea
                            value={adhocContent}
                            onChange={e => setAdhocContent(e.target.value)}
                            placeholder="请输入文字内容，支持 Emoji 和换行..."
                            rows={4}
                            className="w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none resize-none"
                          />
                        ) : (
                          <div className="space-y-2">
                            {adhocLinks.map((link, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <input
                                  type="url"
                                  value={link}
                                  onChange={e => {
                                    const next = [...adhocLinks];
                                    next[idx] = e.target.value;
                                    setAdhocLinks(next);
                                  }}
                                  placeholder={`粘贴${{ IMAGE: "图片", AUDIO: "语音", VIDEO: "视频", DOCUMENT: "文件" }[adhocType]}链接（支持 Google Drive 分享链接）`}
                                  className="flex-1 border-2 border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
                                />
                                {adhocLinks.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setAdhocLinks(adhocLinks.filter((_, i) => i !== idx))}
                                    className="shrink-0 p-1.5 text-red-400 md:hover:text-red-600 md:hover:bg-red-50 rounded-lg transition-colors"
                                    title="移除此链接"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                                  </button>
                                )}
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => setAdhocLinks([...adhocLinks, ""])}
                              className="flex items-center gap-1.5 text-xs text-blue-500 font-black md:hover:text-blue-700 transition-colors py-1"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                              增加更多链接
                            </button>
                          </div>
                        )}

                        {/* 备注名称 */}
                        <input
                          type="text"
                          value={adhocName}
                          onChange={e => setAdhocName(e.target.value)}
                          placeholder="备注名称（可选，留空将自动生成）"
                          className="w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
                        />

                        {/* 保存到素材库选项 */}
                        <label className="flex items-center gap-2.5 cursor-pointer group">
                          <div
                            onClick={() => setSaveToLibrary(p => !p)}
                            className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${
                              saveToLibrary ? "bg-green-500" : "bg-slate-200"
                            }`}
                          >
                            <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                              saveToLibrary ? "translate-x-4" : "translate-x-0"
                            }`} />
                          </div>
                          <div>
                            <span className="text-xs font-black text-slate-700">同时保存到素材库</span>
                            <p className="text-[10px] text-slate-400 font-medium">
                              {saveToLibrary ? "✅ 将正式收录到素材库，以后可复用" : "⏳ 仅本次使用，素材库不显示（名称带 [临时] 标记）"}
                            </p>
                          </div>
                        </label>

                        {/* 操作按钮 */}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleAddAdhoc}
                            disabled={adhocSaving}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-xs font-black rounded-xl md:hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {adhocSaving ? (
                              <>
                                <svg className="animate-spin w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                                添加中...
                              </>
                            ) : (
                              <>
                                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                                加入发送队列
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => { setAdhocExpanded(false); setAdhocContent(""); setAdhocLinks([""]); setAdhocName(""); }}
                            className="px-4 py-2.5 bg-slate-100 text-slate-600 text-xs font-black rounded-xl md:hover:bg-slate-200 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {editMaterialIds.length > 0 && (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-100 rounded-xl space-y-2">
                    <div className="text-xs md:text-[10px] text-blue-400 font-bold mb-1 uppercase tracking-wider flex justify-between items-center">
                      <span>已选素材预览 (按顺序发送) ({editMaterialIds.length})</span>
                      <span className="text-slate-400 font-normal">点击右侧箭头调整顺序</span>
                    </div>
                    {editMaterialIds.map((id, idx) => {
                      const m = materials.find(m => m.id === id);
                      if (!m) return null;
                      const isAdhoc = m.name?.startsWith("[临时]");
                      return (
                        <div key={id} className="flex flex-col gap-1.5 border-b border-blue-100/50 pb-1.5 last:border-0 last:pb-0">
                          <div className="flex items-center gap-2 text-xs text-slate-700 font-medium">
                            <div className="flex-1 min-w-0 flex items-center gap-1.5">
                              <span className="font-bold text-blue-600 shrink-0">[{m.type}]</span>
                              {isAdhoc && (
                                <span className="shrink-0 px-1 py-0.5 bg-orange-100 text-orange-600 text-[9px] font-black rounded uppercase">临时</span>
                              )}
                              <span className="truncate">{m.type === "TEXT" ? m.content : m.url}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <div className="flex items-center bg-white rounded-md shadow-sm border border-blue-100">
                                <button 
                                  onClick={() => moveMaterialUp(idx)} 
                                  disabled={idx === 0 || isReadOnly}
                                  className="p-1 md:hover:bg-blue-50 text-blue-600 disabled:opacity-30 rounded-l-md transition-colors"
                                  title="上移"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                                </button>
                                <div className="w-px h-3 bg-blue-100"></div>
                                <button 
                                  onClick={() => moveMaterialDown(idx)} 
                                  disabled={idx === editMaterialIds.length - 1 || isReadOnly}
                                  className="p-1 md:hover:bg-blue-50 text-blue-600 disabled:opacity-30 rounded-r-md transition-colors"
                                  title="下移"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                                </button>
                              </div>
                              {!isReadOnly && (
                                <button
                                  onClick={() => setEditMaterialIds(prev => prev.filter(mid => mid !== id))}
                                  className="p-1 text-slate-300 md:hover:text-red-500 md:hover:bg-red-50 rounded-md transition-colors"
                                  title="从队列移除"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-xs md:text-[10px]">
                            <span className="text-slate-500 font-bold">消息间隔:</span>
                            <input 
                              type="number" 
                              placeholder="秒" 
                              value={materialDelays[id]?.min !== undefined && materialDelays[id]?.min !== null ? materialDelays[id].min : ""}
                              disabled={isReadOnly}
                              onChange={(e) => {
                                const val = e.target.value;
                                setMaterialDelays({
                                  ...materialDelays, 
                                  [id]: {
                                    ...(materialDelays[id] || {max: 40}), 
                                    min: val === "" ? "" : (parseInt(val) || 0)
                                  }
                                });
                              }}
                              className="border border-slate-200 rounded px-2 py-1.5 md:py-0.5 w-14 md:w-12 text-center font-bold text-slate-700 focus:border-blue-500 focus:outline-none bg-white disabled:opacity-60 disabled:cursor-not-allowed" 
                            />
                            <span className="text-slate-400 font-bold">到</span>
                            <input 
                              type="number" 
                              placeholder="秒" 
                              value={materialDelays[id]?.max !== undefined && materialDelays[id]?.max !== null ? materialDelays[id].max : ""}
                              disabled={isReadOnly}
                              onChange={(e) => {
                                const val = e.target.value;
                                setMaterialDelays({
                                  ...materialDelays, 
                                  [id]: {
                                    ...(materialDelays[id] || {min: 13}), 
                                    max: val === "" ? "" : (parseInt(val) || 0)
                                  }
                                });
                              }}
                              className="border border-slate-200 rounded px-2 py-1.5 md:py-0.5 w-14 md:w-12 text-center font-bold text-slate-700 focus:border-blue-500 focus:outline-none bg-white disabled:opacity-60 disabled:cursor-not-allowed" 
                            />
                            <span className="text-slate-500 font-bold">秒</span>
                          </div>
                        </div>

                      );
                    })}
                  </div>
                )}
              </div>

              {/* AI 赋能与随机选词 */}
              <div className="pt-6 border-t-2 border-dashed border-slate-100">
                <h4 className="text-xs md:text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-1.5 mb-4">
                  <ShieldCheck className="w-3.5 h-3.5" /> AI 赋能与随机选词
                </h4>

                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-700">启用随机选词</span>
                  </div>
                  <button 
                    disabled={isReadOnly}
                    onClick={() => { if (isReadOnly) return; setEditUseRandom(!editUseRandom); }}
                    className={`w-10 h-5 rounded-full transition-colors relative ${editUseRandom ? "bg-green-600" : "bg-slate-300"} ${isReadOnly ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${editUseRandom ? "right-1" : "left-1"}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-700">启用 AI 改写</span>
                  </div>
                  <button 
                    disabled={isReadOnly}
                    onClick={() => { if (isReadOnly) return; setEditUseAi(!editUseAi); }}
                    className={`w-10 h-5 rounded-full transition-colors relative ${editUseAi ? "bg-blue-600" : "bg-slate-300"} ${isReadOnly ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${editUseAi ? "right-1" : "left-1"}`} />
                  </button>
                </div>

                {editUseAi && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-300 mb-4">
                    <div>
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">AI 模型</label>
                      <select 
                        value={editAiModel} 
                        disabled={isReadOnly}
                        onChange={(e) => setEditAiModel(e.target.value)}
                        className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <option value="gpt-4o-mini">OpenAI - gpt-4o-mini</option>
                        <option value="gpt-4o">OpenAI - gpt-4o</option>
                        <option value="o1-mini">OpenAI - o1-mini (推理)</option>
                        <option value="deepseek-chat">DeepSeek - Chat</option>
                        <option value="deepseek-reasoner">DeepSeek - Reasoner (R1)</option>
                        <option value="gemini-2.5-flash">Gemini - 2.5 Flash</option>
                        <option value="gemini-2.5-pro">Gemini - 2.5 Pro</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">AI 提示词 (Prompt)</label>
                      <textarea 
                        rows={3}
                        value={editAiPrompt} 
                        disabled={isReadOnly}
                        onChange={(e) => setEditAiPrompt(e.target.value)}
                        placeholder="请输入提示词，指导 AI 如何改写文案..."
                        className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-xs font-bold text-slate-800 focus:border-blue-500 outline-none resize-none disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <p className="text-xs md:text-[10px] text-slate-400 mt-1">例如：请将文案改写得更热情，适合朋友圈发送。</p>
                    </div>
                  </div>
                )}
              </div>



              {/* 自定义 Webhook 和 Notion */}
              <div className="pt-6 border-t-2 border-dashed border-slate-100">
                <div className="flex items-center justify-between mb-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div>
                    <label className="block text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-wider">自定义 Webhook & Notion</label>
                    <p className="text-[10px] text-slate-500 font-bold mt-0.5">默认关闭。开启后可为该活动单独配置独立的接收地址</p>
                  </div>
                  <button 
                    disabled={isReadOnly}
                    onClick={() => setUseCustomConfig(!useCustomConfig)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${useCustomConfig ? "bg-purple-600" : "bg-slate-300"} ${isReadOnly ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${useCustomConfig ? "right-1" : "left-1"}`} />
                  </button>
                </div>

                {useCustomConfig && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-300">
                    <div className="group">
                      <label className="text-[10px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                        <Globe className="w-3 h-3" /> Webhook 接口
                      </label>
                      <input 
                        type="text" 
                        value={editWebhook} 
                        disabled={isReadOnly}
                        onChange={(e) => setEditWebhook(e.target.value)}
                        placeholder="可选。留空将默认使用全局系统设置"
                        className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-3 text-sm font-black text-slate-800 focus:border-blue-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div className="group">
                      <label className="text-[10px] font-black text-slate-700 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                        <Database className="w-3 h-3" /> Notion 数据库 ID
                      </label>
                      <input 
                        type="text" 
                        value={editNotion} 
                        disabled={isReadOnly}
                        onChange={(e) => setEditNotion(e.target.value)}
                        placeholder="请输入 Notion DB ID"
                        className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-4 py-3 text-sm font-black text-slate-800 focus:border-blue-500 outline-none transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 自动化调度方案 */}
              <div className="pt-6 border-t-2 border-dashed border-slate-100 space-y-4">
                <h4 className="text-xs md:text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-1.5 mb-4">
                  <Clock className="w-3.5 h-3.5" /> 自动化投递调度方案
                </h4>

                <div className="mb-4">
                  <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">触发模式 (Trigger Mode)</label>
                  <select 
                    value={editTriggerType} 
                    disabled={isReadOnly}
                    onChange={(e: any) => setEditTriggerType(e.target.value)}
                    className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="SCHEDULED">特定日期或周期定时触发</option>
                    <option value="BIRTHDAY">生日自动触发</option>
                    <option value="DATE_ATTRIBUTE">日期属性触发 (如到期提醒)</option>
                    {user?.kanbanEnabled && (
                      <optgroup label="看板流转触发">
                        <option value="COLUMN_ENTER">进入某看板列立刻触发</option>
                        <option value="COLUMN_TIMEOUT">停留超过多长时间触发</option>
                      </optgroup>
                    )}
                  </select>
                </div>

                {/* 1. SCHEDULED 定时调度额外配置 */}
                {(editTriggerType === "SCHEDULED") && (
                  <div className="space-y-4 border-l-2 border-blue-500 pl-3 py-1">
                    {editTriggerType === "SCHEDULED" && (
                      <>
                        <div className="grid grid-cols-3 gap-4 mb-4">
                          <div>
                            <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">指定开始日期</label>
                            <input 
                              type="date" 
                              value={editScheduledDate} 
                              disabled={isReadOnly}
                              onChange={(e) => {
                                const newStartDate = e.target.value;
                                setEditScheduledDate(newStartDate);
                                if (editDurationDays) {
                                  const newEndDate = calculateEndDate(newStartDate, editDurationDays);
                                  setEditEndDate(newEndDate);
                                } else if (editEndDate) {
                                  const newDuration = calculateDurationDays(newStartDate, editEndDate);
                                  setEditDurationDays(newDuration);
                                }
                              }}
                              className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </div>
                          <div>
                            <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">持续发送天数 (天)</label>
                            <input 
                              type="text" 
                              pattern="\d*"
                              placeholder="例如: 5"
                              value={editDurationDays} 
                              disabled={isReadOnly}
                              onChange={(e) => {
                                const val = e.target.value;
                                const sanitizedVal = val.replace(/[^\d]/g, '');
                                setEditDurationDays(sanitizedVal);
                                if (editScheduledDate && sanitizedVal) {
                                  const newEndDate = calculateEndDate(editScheduledDate, sanitizedVal);
                                  setEditEndDate(newEndDate);
                                } else if (!sanitizedVal) {
                                  setEditEndDate("");
                                }
                              }}
                              className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </div>
                          <div>
                            <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">结束日期 (可选)</label>
                            <input 
                              type="date" 
                              value={editEndDate} 
                              disabled={isReadOnly}
                              onChange={(e) => {
                                const newEndDate = e.target.value;
                                setEditEndDate(newEndDate);
                                if (editScheduledDate && newEndDate) {
                                  const newDuration = calculateDurationDays(editScheduledDate, newEndDate);
                                  setEditDurationDays(newDuration);
                                } else {
                                  setEditDurationDays("");
                                }
                              }}
                              className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                          </div>
                        </div>

                        <div className="mb-4">
                          <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1.5 block">允许执行的星期</label>
                          <div className="flex gap-1.5 justify-between bg-slate-50 border border-slate-200/60 p-2 rounded-xl">
                            {[
                              { label: "日", value: 0 },
                              { label: "一", value: 1 },
                              { label: "二", value: 2 },
                              { label: "三", value: 3 },
                              { label: "四", value: 4 },
                              { label: "五", value: 5 },
                              { label: "六", value: 6 }
                            ].map((day) => {
                              const isSelected = editWeekdays.includes(day.value);
                              return (
                                <button
                                  key={day.value}
                                  type="button"
                                  disabled={isReadOnly}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    if (isReadOnly) return;
                                    if (editWeekdays.includes(day.value)) {
                                      setEditWeekdays(editWeekdays.filter((d) => d !== day.value));
                                    } else {
                                      setEditWeekdays([...editWeekdays, day.value].sort());
                                    }
                                  }}
                                  className={`w-8 h-8 rounded-lg text-xs font-black transition-colors ${
                                    isSelected
                                      ? "bg-blue-600 text-white shadow-sm"
                                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100/50"
                                  }`}
                                >
                                  {day.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {editScheduledDate && editSelectedRounds.length > 0 && (
                          <div className="mb-4">
                            <label className="text-xs md:text-[10px] font-black text-blue-600 uppercase tracking-widest mb-2 block">📅 排程发送时间预测大盘</label>
                            <div className="bg-blue-50/30 border border-blue-100 rounded-xl p-3 max-h-48 overflow-y-auto space-y-1.5">
                              {getScheduledForecast().map((f, idx) => (
                                <div key={idx} className="flex justify-between items-center text-xs text-slate-600 font-bold border-b border-slate-100/50 pb-1 last:border-0 last:pb-0">
                                  <span>
                                    {editIsRepeating ? `循环 ${f.cycleNum} - 第 ${f.round} 轮` : `第 ${f.round} 轮`}
                                  </span>
                                  <span className={f.dateStr.includes("不执行") ? "text-red-500 font-bold" : "text-blue-700 font-black"}>
                                    {f.dateStr}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    <div className="mb-4">
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">每日定时执行时间</label>
                      <input 
                        type="time" 
                        value={editScheduledTime} 
                        disabled={isReadOnly}
                        onChange={(e) => setEditScheduledTime(e.target.value)}
                        className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">单次发几个 (人)</label>
                        <input 
                          type="number" 
                          value={editBatchSize !== undefined && editBatchSize !== null ? editBatchSize : ""} 
                          disabled={isReadOnly}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditBatchSize(val === "" ? "" : (parseInt(val) || 0));
                          }}
                          className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                      </div>
                      <div>
                        <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">
                          总计发几轮 (次)
                        </label>

                        <div className="relative">
                          <input 
                            type="number" 
                            value={editTotalRuns !== undefined && editTotalRuns !== null ? editTotalRuns : ""} 
                            disabled={isReadOnly}
                            onChange={(e) => {
                              const val = e.target.value;
                              setEditTotalRuns(val === "" ? "" : (parseInt(val) || 0));
                              setIsAutoSync(false); // 用户手动修改后停止自动同步
                            }}
                            className={`w-full border-2 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${isAutoSync ? "border-blue-100 bg-blue-50/30" : "border-slate-100 bg-slate-50"}`}
                          />
                          {!isAutoSync && campaign?.contactCount && (
                            <button 
                              disabled={isReadOnly}
                              onClick={(e) => { e.preventDefault(); if (isReadOnly) return; setIsAutoSync(true); }}
                              className={`absolute right-2 top-1/2 -translate-y-1/2 text-xs md:text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-1 md:py-0.5 rounded md:hover:bg-blue-100 ${isReadOnly ? "opacity-50 cursor-not-allowed" : ""}`}
                            >
                              恢复自动
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {campaign?.contactCount && Number(editBatchSize) > 0 && (
                      <div className="mb-4 px-3 py-2 bg-blue-50/50 rounded-xl border border-blue-100/50">
                        <p className="text-xs md:text-[10px] font-bold text-blue-700 flex items-center gap-1">
                          <Database className="w-3 h-3" />
                          智能测算：共 {currentContactCount} 人，每轮 {editBatchSize} 人
                        </p>
                        <p className="text-xs md:text-[9px] text-blue-500 mt-0.5">
                          前 {Math.floor(currentContactCount / Number(editBatchSize))} 轮满额发送
                          {currentContactCount % Number(editBatchSize) > 0 && (
                            <> ，最后一轮发送 <span className="font-black underline">{currentContactCount % Number(editBatchSize)}</span> 人以补足余数</>
                          )}
                        </p>
                      </div>
                    )}

                    {Number(editTotalRuns) > 0 && (
                      <div className="mb-4">
                        <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-2 flex items-center justify-between">
                          <span>指定执行轮次</span>
                          <button 
                            disabled={isReadOnly}
                            onClick={(e) => {
                              e.preventDefault();
                              if (isReadOnly) return;
                              setIsAutoSync(false);
                              if (editSelectedRounds.length === Number(editTotalRuns)) {
                                setEditSelectedRounds([]);
                              } else {
                                setEditSelectedRounds(Array.from({ length: Number(editTotalRuns) }, (_, i) => i + 1));
                              }
                            }}
                            className={`text-blue-500 hover:text-blue-700 underline ${isReadOnly ? "opacity-50 cursor-not-allowed no-underline" : ""}`}
                          >
                            {editSelectedRounds.length === Number(editTotalRuns) ? "全部取消" : "全选"}
                          </button>
                        </label>
                        <div className="bg-slate-50 border-2 border-slate-100 rounded-xl p-3 max-h-48 overflow-y-auto">
                           <div className="grid grid-cols-2 gap-2">
                            {Array.from({ length: Number(editTotalRuns) }).map((_, idx) => {
                              const roundNum = idx + 1;
                              const isSelected = editSelectedRounds.includes(roundNum);
                              const validList = validTargetContacts.length > 0 ? validTargetContacts : campaignContacts.filter((c: any) => !editExcludedIds.includes(c.id));
                              const validLength = validList.length || currentContactCount;
                              const batchSizeNum = Number(editBatchSize) || 1;
                              
                              const roundContacts = validList.slice(idx * batchSizeNum, (idx + 1) * batchSizeNum);
                              const startIdx = idx * batchSizeNum + 1;
                              const endIdx = Math.min((idx + 1) * batchSizeNum, validLength);
                              const isOverbound = startIdx > validLength;
                              
                              return (
                                <div 
                                  key={roundNum} 
                                  className={`flex items-start gap-2 p-2 rounded-lg border ${isSelected ? 'bg-blue-50/50 border-blue-200' : 'bg-white border-slate-100 md:hover:border-slate-200'} ${isReadOnly || isOverbound ? "opacity-75" : ""} transition-all`}
                                >
                                  <div className="mt-0.5">
                                    <input 
                                      type="checkbox" 
                                      className={`w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 border-slate-300 ${isReadOnly ? "cursor-not-allowed" : "cursor-pointer"}`}
                                      checked={isSelected}
                                      disabled={isReadOnly}
                                      onChange={(e) => {
                                        setIsAutoSync(false);
                                        if (e.target.checked) {
                                          setEditSelectedRounds([...editSelectedRounds, roundNum].sort((a, b) => a - b));
                                        } else {
                                          setEditSelectedRounds(editSelectedRounds.filter(r => r !== roundNum));
                                        }
                                      }}
                                    />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[11px] font-bold text-slate-800 flex items-center justify-between">
                                      <span>第 {roundNum} 轮</span>
                                      {campaign?.scheduleConfig?.state?.roundHistory?.[roundNum] ? (
                                        <span className="text-xs md:text-[9px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex items-center gap-1 border border-emerald-100/50">
                                          <CheckCircle2 className="w-2.5 h-2.5" />
                                          已发: {campaign.scheduleConfig.state.roundHistory[roundNum]}
                                        </span>
                                      ) : isOverbound ? (
                                        <span className="text-xs md:text-[9px] px-1.5 py-0.5 rounded font-black border bg-slate-100 text-slate-400 border-slate-200">
                                          无成员 (0人)
                                        </span>
                                      ) : (
                                        <span className="text-xs md:text-[9px] px-1.5 py-0.5 rounded font-black border bg-blue-50 text-blue-700 border-blue-200">
                                          应发 {roundContacts.length} 人
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-xs md:text-[9px] text-slate-500 flex items-center justify-between mt-1">
                                      <span>{isOverbound ? "超出目标名额" : `名单第 ${startIdx} - ${endIdx} 人`}</span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setPreviewRound(roundNum);
                                        }}
                                        className="text-xs md:text-[9px] text-blue-600 bg-blue-50 hover:bg-blue-100 px-1.5 py-0.5 rounded transition-all font-black flex items-center gap-0.5 shrink-0"
                                      >
                                        🔍 预览名单
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mb-4">
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">发送频率</label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          value={editFrequencyValue !== undefined && editFrequencyValue !== null ? editFrequencyValue : ""} 
                          disabled={isReadOnly}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditFrequencyValue(val === "" ? "" : (parseInt(val) || 0));
                          }}
                          className="flex-1 border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                        <select 
                          value={editFrequencyUnit} 
                          disabled={isReadOnly}
                          onChange={(e: any) => setEditFrequencyUnit(e.target.value)}
                          className="w-24 border-2 border-slate-100 bg-slate-50 rounded-xl px-2 py-3 md:py-2 text-xs font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <option value="hours">小时</option>
                          <option value="days">天</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <div className="flex items-center gap-2">
                        <RefreshCcw className={`w-4 h-4 ${editIsRepeating ? "text-blue-600 animate-spin" : "text-slate-400"}`} />
                        <span className="text-xs font-black text-slate-700">无限循环模式</span>
                      </div>
                      <button 
                        disabled={isReadOnly}
                        onClick={(e) => { e.preventDefault(); if (isReadOnly) return; setEditIsRepeating(!editIsRepeating); }}
                        className={`w-10 h-5 rounded-full transition-colors relative ${editIsRepeating ? "bg-blue-600" : "bg-slate-300"} ${isReadOnly ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${editIsRepeating ? "right-1" : "left-1"}`} />
                      </button>
                    </div>

                    {editIsRepeating && (
                      <div className="grid grid-cols-2 gap-4 p-3 bg-slate-50/50 border border-slate-100 rounded-xl animate-in fade-in slide-in-from-top-1 duration-200">
                        <div>
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">循环次数 (0为无限)</label>
                          <input 
                            type="text" 
                            pattern="\d*"
                            placeholder="例如: 3"
                            value={editRepeatLimit} 
                            disabled={isReadOnly}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^\d]/g, '');
                              setEditRepeatLimit(val);
                            }}
                            className="w-full border-2 border-slate-100 bg-white rounded-xl px-3 py-2 text-xs font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1 block">二次循环延迟天数 (天)</label>
                          <input 
                            type="text" 
                            pattern="\d*"
                            placeholder="例如: 3"
                            value={editLoopDelayDays} 
                            disabled={isReadOnly}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^\d]/g, '');
                              setEditLoopDelayDays(val);
                            }}
                            className="w-full border-2 border-slate-100 bg-white rounded-xl px-3 py-2 text-xs font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. BIRTHDAY 生日触发配置 */}
                {editTriggerType === "BIRTHDAY" && (
                  <div className="space-y-4 border-l-2 border-emerald-500 pl-3 py-1 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div>
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">自定义生日属性名</label>
                      <div className="space-y-2">
                        <select 
                          value={availableColumns.includes(editBirthdayField) ? editBirthdayField : (editBirthdayField ? "custom" : "")}
                          disabled={isReadOnly}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "custom") {
                              setIsCustomBirthday(true);
                              setEditBirthdayField("");
                            } else {
                              setIsCustomBirthday(false);
                              setEditBirthdayField(val);
                            }
                          }}
                          className="w-full border-2 border-slate-200 bg-white rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <option value="">-- 请选择或输入生日属性字段 --</option>
                          {dateColumns.length > 0 && (
                            <optgroup label="📅 检测到的日期/生日属性">
                              {dateColumns.map(col => (
                                <option key={col} value={col}>{col}</option>
                              ))}
                            </optgroup>
                          )}
                          {availableColumns.filter(c => !dateColumns.includes(c)).length > 0 && (
                            <optgroup label="📁 其他属性字段">
                              {availableColumns.filter(c => !dateColumns.includes(c)).map(col => (
                                <option key={col} value={col}>{col}</option>
                              ))}
                            </optgroup>
                          )}
                          <option value="custom">✏️ 手动输入自定义属性名...</option>
                        </select>
                        
                        {(!availableColumns.includes(editBirthdayField) || isCustomBirthday) && (
                          <input 
                            type="text" 
                            value={editBirthdayField} 
                            disabled={isReadOnly}
                            onChange={(e) => setEditBirthdayField(e.target.value)}
                            className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                            placeholder="请输入自定义属性名，例如: birthday"
                          />
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1.5 font-bold">系统将读取联系人的此属性匹配今日日期 (支持 MM-DD 或 YYYY-MM-DD 格式)</p>
                    </div>

                    <div>
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">每日触发时间点</label>
                      <input 
                        type="time" 
                        value={editBirthdayHour} 
                        disabled={isReadOnly}
                        onChange={(e) => setEditBirthdayHour(e.target.value)}
                        className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                )}

                {/* 3. DATE_ATTRIBUTE 日期属性触发 (如到期提醒) */}
                {editTriggerType === "DATE_ATTRIBUTE" && (
                  <div className="space-y-4 border-l-2 border-violet-500 pl-3 py-1 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div>
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">要读取的日期属性名</label>
                      <div className="space-y-2">
                        <select 
                          value={availableColumns.includes(editDateAttrField) ? editDateAttrField : (editDateAttrField ? "custom" : "")}
                          disabled={isReadOnly}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === "custom") {
                              setIsCustomDateAttr(true);
                              setEditDateAttrField("");
                            } else {
                              setIsCustomDateAttr(false);
                              setEditDateAttrField(val);
                            }
                          }}
                          className="w-full border-2 border-slate-200 bg-white rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          <option value="">-- 请选择或输入日期属性字段 --</option>
                          {dateColumns.length > 0 && (
                            <optgroup label="📅 检测到的日期属性">
                              {dateColumns.map(col => (
                                <option key={col} value={col}>{col}</option>
                              ))}
                            </optgroup>
                          )}
                          {availableColumns.filter(c => !dateColumns.includes(c)).length > 0 && (
                            <optgroup label="📁 其他属性字段">
                              {availableColumns.filter(c => !dateColumns.includes(c)).map(col => (
                                <option key={col} value={col}>{col}</option>
                              ))}
                            </optgroup>
                          )}
                          <option value="custom">✏️ 手动输入自定义属性名...</option>
                        </select>
                        
                        {(!availableColumns.includes(editDateAttrField) || isCustomDateAttr) && (
                          <input 
                            type="text" 
                            value={editDateAttrField} 
                            disabled={isReadOnly}
                            onChange={(e) => setEditDateAttrField(e.target.value)}
                            className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                            placeholder="请输入自定义属性名，例如: expire_date"
                          />
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">偏置触发天数 (天)</label>
                      <input 
                        type="number" 
                        value={editDateAttrOffsetDays !== undefined && editDateAttrOffsetDays !== null ? editDateAttrOffsetDays : ""} 
                        disabled={isReadOnly}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditDateAttrOffsetDays(val === "" ? "" : (parseInt(val) || 0));
                        }}
                        className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                      <p className="text-[10px] text-slate-400 mt-1 font-bold">
                        支持设定过去或未来的天数。如：设定 <span className="font-black text-red-500 underline">-10</span> 表示到期前 10 天触发；设定 <span className="font-black text-green-500 underline">3</span> 表示到期后 3 天触发。设定 <span className="font-black underline">0</span> 表示到期当天触发。
                      </p>
                    </div>

                    <div>
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">每日触发时间点</label>
                      <input 
                        type="time" 
                        value={editDateAttrHour} 
                        disabled={isReadOnly}
                        onChange={(e) => setEditDateAttrHour(e.target.value)}
                        className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>
                )}

                {/* 4. COLUMN_ENTER 进入看板列立刻触发 */}
                {editTriggerType === "COLUMN_ENTER" && (
                  <div className="space-y-4 border-l-2 border-amber-500 pl-3 py-1 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div>
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">目标进入列</label>
                      <select 
                        value={editEnterStepId} 
                        disabled={isReadOnly}
                        onChange={(e) => setEditEnterStepId(e.target.value)}
                        className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <option value="">-- 请选择看板列 --</option>
                        {steps.map(step => (
                          <option key={step.id} value={step.id}>{step.name}</option>
                        ))}
                      </select>
                      <p className="text-[10px] text-slate-400 mt-1 font-bold">当看板卡片被移动或拖入此阶段列时，会立刻异步发送消息给该客户</p>
                    </div>
                  </div>
                )}

                {/* 5. COLUMN_TIMEOUT 看板停留超时触发 */}
                {editTriggerType === "COLUMN_TIMEOUT" && (
                  <div className="space-y-4 border-l-2 border-rose-500 pl-3 py-1 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div>
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">目标停留列</label>
                      <select 
                        value={editTimeoutStepId} 
                        disabled={isReadOnly}
                        onChange={(e) => setEditTimeoutStepId(e.target.value)}
                        className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <option value="">-- 请选择看板列 --</option>
                        {steps.map(step => (
                          <option key={step.id} value={step.id}>{step.name}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs md:text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1 block">停留超时触发阈值 (小时)</label>
                      <input 
                        type="number" 
                        value={editTimeoutHours !== undefined && editTimeoutHours !== null ? editTimeoutHours : ""} 
                        disabled={isReadOnly}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditTimeoutHours(val === "" ? "" : (parseInt(val) || 0));
                        }}
                        className="w-full border-2 border-slate-100 bg-slate-50 rounded-xl px-3 py-3 md:py-2 text-sm font-black text-slate-800 focus:border-blue-500 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                        placeholder="48"
                      />
                      <p className="text-[10px] text-slate-400 mt-1 font-bold">客户停留超过指定小时无跟进，将触发消息提醒客户或跟进人员</p>
                    </div>
                  </div>
                )}

                {/* 安全时段配置 */}
                <div className="p-4 bg-slate-50 rounded-2xl border-2 border-slate-100 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-600">
                    <ShieldCheck className="w-4 h-4" />
                    <span className="text-xs md:text-[10px] font-black uppercase tracking-widest">安全发送时段</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input 
                      type="time" 
                      value={editSafeWindowStart} 
                      disabled={isReadOnly}
                      onChange={(e) => setEditSafeWindowStart(e.target.value)}
                      className="flex-1 border-2 border-slate-100 bg-white rounded-lg px-2 py-2 md:py-1 text-xs font-bold outline-none text-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                    <span className="text-slate-400 font-bold text-xs">至</span>
                    <input 
                      type="time" 
                      value={editSafeWindowEnd} 
                      disabled={isReadOnly}
                      onChange={(e) => setEditSafeWindowEnd(e.target.value)}
                      className="flex-1 border-2 border-slate-100 bg-white rounded-lg px-2 py-2 md:py-1 text-xs font-bold outline-none text-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                  </div>
                  <p className="text-[9px] text-slate-400 mt-1">自动防骚扰：非此时间段内符合触发条件的任务，将延期至进入时段后再发</p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold uppercase">建立时间</span>
                  <span className="text-slate-700 font-black">{new Date(campaign.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold uppercase">覆盖总人数</span>
                  <span className="text-slate-700 font-black">{currentContactCount} 人</span>
                </div>
                {(editTriggerType === "DATE_ATTRIBUTE" || editTriggerType === "BIRTHDAY") && (
                  <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-200/60">
                    <span className="text-slate-400 font-bold uppercase">预计今日触发</span>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-700 font-black bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">{countToday} 人</span>
                      <button
                        type="button"
                        onClick={handleResetScheduleState}
                        className="text-[10px] text-rose-600 bg-rose-50 hover:bg-rose-100 px-1.5 py-0.5 rounded transition-all font-black border border-rose-100"
                        title="清除该活动已发送的历史记录，允许今天重新触发"
                      >
                        重置状态
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          </div>

          {/* Sticky Action Bar */}
          <div className="sticky bottom-4 z-40 bg-white md:bg-white/95 md:backdrop-blur-md rounded-3xl p-4 md:p-5 border-2 border-slate-200 shadow-xl md:shadow-2xl flex flex-col gap-4 transition-all">
            {isDirty && campaign.status !== "ACTIVE" && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-amber-500 flex items-center gap-1.5 animate-in slide-in-from-left-2 fade-in">
                  <AlertTriangle className="w-4 h-4" /> 有未保存的修改
                </span>
              </div>
            )}
            
            <div className="flex flex-col gap-3">
              {campaign.status !== "ACTIVE" && (
                <button 
                  onClick={handleUpdateSettings} 
                  disabled={saving || !isDirty}
                  className={`w-full py-3.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-2 ${isDirty ? "bg-slate-900 text-white shadow-lg md:hover:bg-slate-800 md:hover:scale-[1.01] active:scale-[0.99]" : "bg-slate-100 text-slate-400 cursor-not-allowed"}`}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  保存设置
                </button>
              )}
              
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => {
                    if (isDirty) setShowDirtyDialog({ action: 'start' });
                    else handleToggleStatus();
                  }} 
                  disabled={toggleLoading} 
                  className={`py-3.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-2 shadow-sm ${campaign.status === "ACTIVE" ? "bg-amber-100 text-amber-700 md:hover:bg-amber-200 active:scale-95" : "bg-green-100 text-green-700 md:hover:bg-green-200 active:scale-95"}`}
                >
                  {toggleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : campaign.status === "ACTIVE" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  {campaign.status === "ACTIVE" ? "暂停活动" : "启动活动"}
                </button>

                <button 
                  onClick={() => {
                    if (isDirty) setShowDirtyDialog({ action: 'send' });
                    else setShowSendDialog(true);
                  }} 
                  disabled={campaign.status !== "ACTIVE"} 
                  className="py-3.5 bg-blue-600 text-white rounded-2xl text-sm font-black md:hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 disabled:opacity-30 flex items-center justify-center gap-2 active:scale-95"
                >
                  <Send className="w-4 h-4" /> 立即发送
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog 
        open={showSendDialog} 
        onClose={() => setShowSendDialog(false)} 
        onConfirm={handleSend} 
        title="确认启动发送任务？" 
        description={
          editTriggerType === "DATE_ATTRIBUTE" || editTriggerType === "BIRTHDAY"
            ? `该活动将扫描已绑定人群包（共 ${currentContactCount} 人），并向今天符合触发条件的 ${countToday} 位目标联系人发送消息。`
            : `该活动将基于所选人群包，向 ${currentContactCount} 位目标联系人发送消息。`
        } 
        confirmText="立即启动" 
        variant="default" 
      />

      {/* 轮次名单预览与手动排除 Modal */}
      <Modal 
        open={previewRound !== null} 
        onClose={() => setPreviewRound(null)} 
        title={`第 ${previewRound} 轮发送名单预览`}
        className="max-w-2xl"
      >
        {previewRound !== null && (() => {
          const validList = validTargetContacts.length > 0 ? validTargetContacts : campaignContacts.filter((c: any) => !editExcludedIds.includes(c.id));
          const roundContacts = validList.slice((previewRound - 1) * Number(editBatchSize), previewRound * Number(editBatchSize));
          const activeInRound = roundContacts;
          const excludedCount = 0;
          
          return (
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex justify-between items-center bg-slate-50 p-4 rounded-xl border border-slate-200/60">
                <div className="text-sm font-bold text-slate-700">
                  本轮分配：<span className="font-black text-slate-900">{roundContacts.length}</span> 人
                </div>
                <div className="text-sm font-bold text-slate-700">
                  当前应发：<span className="font-black text-blue-600">{activeInRound.length}</span> 人
                </div>
                <div className="text-sm font-bold text-slate-700">
                  已排除：<span className="font-black text-rose-600">{excludedCount}</span> 人
                </div>
              </div>
              
              {!isReadOnly && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700 font-bold leading-normal">
                    温馨提示：手动排除仅对本活动生效。更改后请记得在页面底部点击“保存设置”。
                  </p>
                </div>
              )}

              <div className="border border-slate-200 rounded-xl max-h-[350px] overflow-y-auto overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs min-w-[500px]">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] text-slate-400 font-black tracking-widest uppercase sticky top-0 z-10">
                      <th className="p-3 pl-4 bg-slate-50">姓名</th>
                      <th className="p-3 bg-slate-50">电话</th>
                      <th className="p-3 bg-slate-50">市场</th>
                      <th className="p-3 pr-4 text-right bg-slate-50 whitespace-nowrap">状态 / 操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-bold text-slate-700">
                    {roundContacts.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-8 text-center text-slate-400 font-bold space-y-1">
                          <div>本轮暂无分配联系人</div>
                          <div className="text-[11px] text-slate-400 font-normal">
                            💡 若您指定了 Excel 数据源，请检查是否叠加挂载了条件不匹配的人群包筛选规则
                          </div>
                        </td>
                      </tr>
                    ) : (
                      roundContacts.map(c => {
                        const isExcluded = editExcludedIds.includes(c.id);
                        return (
                          <tr key={c.id} className={`hover:bg-slate-50/50 transition-colors ${isExcluded ? 'bg-rose-50/20 text-slate-400' : ''}`}>
                            <td className={`p-3 pl-4 font-black ${isExcluded ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                              {c.name}
                            </td>
                            <td className="p-3 font-mono">{c.phone}</td>
                            <td className="p-3">{c.market || "-"}</td>
                            <td className="p-3 pr-4 text-right whitespace-nowrap">
                              <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-black whitespace-nowrap ${isExcluded ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'}`}>
                                  {isExcluded ? '已排除' : '应发送'}
                                </span>
                                
                                {!isReadOnly && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isExcluded) {
                                        setEditExcludedIds(prev => prev.filter(id => id !== c.id));
                                      } else {
                                        setEditExcludedIds(prev => [...prev, c.id]);
                                      }
                                    }}
                                    className={`px-2 py-1 rounded text-[10px] font-black transition-all whitespace-nowrap ${
                                      isExcluded 
                                        ? 'bg-blue-50 text-blue-600 hover:bg-blue-100' 
                                        : 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                                    }`}
                                  >
                                    {isExcluded ? '恢复' : '排除'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setPreviewRound(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* 自定义未保存拦截弹窗 */}
      <Modal open={!!showDirtyDialog} onClose={() => setShowDirtyDialog(null)} title="尚未保存更改">
        <div className="flex flex-col items-center text-center">
          <p className="text-slate-600 text-sm mb-6 font-bold">
            您修改了活动配置但尚未点击「保存设置」。
          </p>
          <div className="flex flex-col gap-3 w-full">
            <button
              onClick={async () => {
                await handleUpdateSettings();
                setShowDirtyDialog(null);
              }}
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black transition-colors"
            >
              保存当前更改继续留在当前页面
            </button>
            
            {showDirtyDialog?.action === "leave" ? (
              <button
                onClick={async () => {
                  await fetchCampaign(); // 丢弃修改
                  if (showDirtyDialog.targetUrl) {
                    router.push(showDirtyDialog.targetUrl);
                  }
                  setShowDirtyDialog(null);
                }}
                className="w-full px-4 py-3 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-100 rounded-xl font-black transition-colors"
              >
                不保存并离开当前页面
              </button>
            ) : (
              <button
                onClick={() => {
                  setShowDirtyDialog(null); // 关闭弹窗视窗，停在当前页面
                }}
                className="w-full px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-black transition-colors"
              >
                不保存
              </button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
