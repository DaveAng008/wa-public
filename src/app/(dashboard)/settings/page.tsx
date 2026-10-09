"use client";

import { useEffect, useState, useMemo } from "react";
import { Save, Loader2, Eye, EyeOff, Clock, Users, Link as LinkIcon, Smartphone, Trash2, Plus, RefreshCw, CheckCircle, AlertCircle, Copy, Check, Pencil, X } from "lucide-react";
import { settingsApi, SystemSettings } from "@/lib/api";
import { PageLoading } from "@/components/ui/LoadingSpinner";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role?.toUpperCase() === "ADMIN";

  const [settings, setSettings] = useState<SystemSettings>({
    scheduledTime: "09:00",
    maxSendLimit: 150,
    minDelay: 140,
    maxDelay: 190,
    n8nWebhookUrl: "",
    notionSecret: "",
    notionDatabaseId: "",
    notionSyncWebhookUrl: "",
    n8nAiRewriteWebhookUrl: "",
    n8nAiAnalyzeWebhookUrl: "",
    n8nBindInstanceWebhookUrl: "",
    evolutionApiUrl: "",
    evolutionApiKey: "",
    evolutionWebhookUrl: "",
    hubWebhookUrl: "",
    hubWebhookToken: "",
    whatsappSyncConfig: "[]",
    whatsappSyncTime: "03:00",
    whatsappSyncEnabled: 0,
    whatsappAutoSyncInstances: "[]",
    notificationPhone: "",
    groupMonitorEnabled: 0,
    groupTargetStepId: "",
    customHookUrl: "",
    maxInstances: 1,
    apiKeys: { openai: "", deepseek: "", gemini: "" }
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [saved, setSaved] = useState(false);

  // WhatsApp 实例管理状态
  const [instances, setInstances] = useState<any[]>([]);
  const [instanceConfigs, setInstanceConfigs] = useState<any[]>([]);

  const configsMap = useMemo(() => {
    const map: Record<string, any> = {};
    instanceConfigs.forEach((c: any) => {
      map[c.instanceName] = c;
    });
    return map;
  }, [instanceConfigs]);

  const handleToggleInstancePolicy = async (instanceName: string, field: "allowKanban" | "allowHub" | "allowSync", currentValue: boolean) => {
    const existingConfig = configsMap[instanceName] || {
      instanceName,
      allowKanban: 1,
      allowHub: 1,
      allowSync: 1
    };
    
    const updatedValue = !currentValue ? 1 : 0;
    const updatedConfig = {
      ...existingConfig,
      [field]: updatedValue
    };
    
    // 乐观更新
    setInstanceConfigs(prev => {
      const filtered = prev.filter(c => c.instanceName !== instanceName);
      return [...filtered, updatedConfig];
    });
    
    try {
      const res = await fetch("/api/settings/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfig)
      });
      if (!res.ok) {
        fetchInstances();
      }
    } catch (err) {
      console.error("Failed to save instance policy", err);
      fetchInstances();
    }
  };

  const handleSaveAliasInline = async (instanceName: string) => {
    const existingConfig = configsMap[instanceName] || {
      instanceName,
      allowKanban: 1,
      allowHub: 1,
      allowSync: 1
    };
    const updatedConfig = {
      ...existingConfig,
      alias: editingAliasValue.trim() || null
    };
    try {
      const res = await fetch("/api/settings/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedConfig)
      });
      if (res.ok) {
        setEditingAliasInstance(null);
        fetchInstances();
      } else {
        alert("保存别名失败");
      }
    } catch (err) {
      console.error("Failed to save instance alias", err);
      alert("保存别名出错");
    }
  };

  const [loadingInstances, setLoadingInstances] = useState(false);
  const [showBindModal, setShowBindModal] = useState(false);
  const [newInstanceName, setNewInstanceName] = useState("");
  const [newPhoneNumber, setNewPhoneNumber] = useState("");
  const [newInstanceAlias, setNewInstanceAlias] = useState("");
  const [editingAliasInstance, setEditingAliasInstance] = useState<string | null>(null);
  const [editingAliasValue, setEditingAliasValue] = useState("");
  const [bindingQr, setBindingQr] = useState<string | null>(null);
  const [bindingRawName, setBindingRawName] = useState<string | null>(null);
  const [bindError, setBindError] = useState("");
  const [bindingLoading, setBindingLoading] = useState(false);
  const [deleteInstanceName, setDeleteInstanceName] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 新的重连与验证码绑定状态
  const [bindMethod, setBindMethod] = useState<"qr" | "pairing">("qr");
  const [bindingPairingCode, setBindingPairingCode] = useState<string | null>(null);
  const [fetchingPairingCode, setFetchingPairingCode] = useState(false);

  const [showReconnectModal, setShowReconnectModal] = useState(false);
  const [reconnectTarget, setReconnectTarget] = useState<any>(null); // 保存正在重连的 instance 对象
  const [reconnectMethod, setReconnectMethod] = useState<"qr" | "pairing">("qr");
  const [reconnectQr, setReconnectQr] = useState<string | null>(null);
  const [reconnectPairingCode, setReconnectPairingCode] = useState<string | null>(null);
  const [reconnectError, setReconnectError] = useState("");
  const [reconnectLoading, setReconnectLoading] = useState(false);
  const [reconnectPhone, setReconnectPhone] = useState("");
  const [fetchingReconnectCode, setFetchingReconnectCode] = useState(false);

  interface SyncRule {
    prefix: string;
    market: string;
    notify: boolean;
    template: string;
  }
  const [rules, setRules] = useState<SyncRule[]>([]);
  const [autoSyncInstances, setAutoSyncInstances] = useState<string[]>([]);
  const [steps, setSteps] = useState<any[]>([]);
  const [aiRules, setAiRules] = useState<any[]>([]);

  // 新增：立即手动同步状态
  const [showManualSyncModal, setShowManualSyncModal] = useState(false);
  const [syncSelectedInstances, setSyncSelectedInstances] = useState<string[]>([]);
  const [syncTargetSourceId, setSyncTargetSourceId] = useState<string>("whatsapp_sync");
  const [syncingNow, setSyncingNow] = useState(false);
  const [dataSources, setDataSources] = useState<any[]>([]);

  const updateAiRules = (newRules: any[]) => {
    setAiRules(newRules);
    setSettings((prev) => ({ ...prev, aiRoutingConfig: JSON.stringify(newRules) }));
  };

  const updateRules = (newRules: SyncRule[]) => {
    setRules(newRules);
    setSettings((prev) => ({ ...prev, whatsappSyncConfig: JSON.stringify(newRules) }));
  };

  const handleToggleAutoSyncInstance = (rawName: string) => {
    let next: string[];
    if (autoSyncInstances.includes(rawName)) {
      next = autoSyncInstances.filter(x => x !== rawName);
    } else {
      next = [...autoSyncInstances, rawName];
    }
    setAutoSyncInstances(next);
    setSettings((prev) => ({ ...prev, whatsappAutoSyncInstances: JSON.stringify(next) }));
  };

  useEffect(() => {
    fetch("/api/data-sources")
      .then(res => res.json())
      .then(data => setDataSources(data || []))
      .catch(err => console.error("加载数据源失败", err));

    settingsApi.get()
      .then((data) => {
        setSettings((prev) => ({ ...prev, ...data }));
        if (data.whatsappSyncConfig) {
          try {
            setRules(JSON.parse(data.whatsappSyncConfig));
          } catch (e) {
            setRules([]);
          }
        } else {
          // 默认规则
          const defaultRules = [
            { prefix: "65", market: "新加坡", notify: true, template: "每天更新新名单:\n电话号码：{phone}\n市场：新加坡" },
            { prefix: "60", market: "马来西亚", notify: false, template: "" }
          ];
          setRules(defaultRules);
          setSettings((prev) => ({ ...prev, whatsappSyncConfig: JSON.stringify(defaultRules) }));
        }

        if (data.whatsappAutoSyncInstances) {
          try {
            setAutoSyncInstances(JSON.parse(data.whatsappAutoSyncInstances));
          } catch (e) {
            setAutoSyncInstances([]);
          }
        } else {
          setAutoSyncInstances([]);
        }

        if (data.aiRoutingConfig) {
          try {
            setAiRules(JSON.parse(data.aiRoutingConfig));
          } catch (e) {
            setAiRules([]);
          }
        } else {
          setAiRules([]);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    fetchInstances();

    // 加载看板阶段列表用于 AI 智能路由配置
    fetch("/api/kanban/data?sourceId=all&groupId=all&viewId=all&activeDays=15")
      .then(res => res.json())
      .then(data => {
        if (data && data[0] && data[0].steps) {
          setSteps(data[0].steps);
        }
      })
      .catch(err => console.error("Failed to load kanban steps for settings:", err));
  }, []);

  // 轮询绑定状态
  useEffect(() => {
    let interval: any;
    if (showBindModal && (bindingQr || bindingPairingCode) && bindingRawName) {
      interval = setInterval(async () => {
        try {
          const res = await fetch("/api/instances?t=" + Date.now(), { cache: "no-store" });
          if (res.ok) {
            const list = await res.json();
            const matched = list.find((inst: any) => {
              if (inst.rawName !== bindingRawName) return false;
              const connStatus = String(inst.connectionStatus || "").toLowerCase();
              const instStatus = String(inst.status || "").toLowerCase();
              return (
                connStatus === "connected" ||
                connStatus === "online" ||
                connStatus === "open" ||
                instStatus === "open" ||
                instStatus === "connected" ||
                instStatus === "online"
              );
            });
            if (matched) {
              clearInterval(interval);
              alert("✓ WhatsApp 实例绑定成功！");
              setShowBindModal(false);
              setBindingQr(null);
              setBindingPairingCode(null);
              setBindingRawName(null);
              setNewInstanceName("");
              setNewPhoneNumber("");
              setNewInstanceAlias("");
              fetchInstances();
            }
          }
        } catch (e) {
          console.error(e);
        }
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [showBindModal, bindingQr, bindingPairingCode, bindingRawName]);

  // 轮询重连状态
  useEffect(() => {
    let interval: any;
    if (showReconnectModal && reconnectTarget) {
      interval = setInterval(async () => {
        try {
          const res = await fetch("/api/instances?t=" + Date.now(), { cache: "no-store" });
          if (res.ok) {
            const list = await res.json();
            const matched = list.find((inst: any) => {
              if (inst.rawName !== reconnectTarget.rawName) return false;
              const connStatus = String(inst.connectionStatus || "").toLowerCase();
              const instStatus = String(inst.status || "").toLowerCase();
              return (
                connStatus === "connected" ||
                connStatus === "online" ||
                connStatus === "open" ||
                instStatus === "open" ||
                instStatus === "connected" ||
                instStatus === "online"
              );
            });
            if (matched) {
              clearInterval(interval);
              alert("✓ WhatsApp 实例重新连接成功！");
              setShowReconnectModal(false);
              setReconnectTarget(null);
              setReconnectQr(null);
              setReconnectPairingCode(null);
              fetchInstances();
            }
          }
        } catch (e) {
          console.error(e);
        }
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [showReconnectModal, reconnectTarget]);

  const fetchInstances = async () => {
    setLoadingInstances(true);
    try {
      const [res, configsRes] = await Promise.all([
        fetch("/api/instances?t=" + Date.now(), { cache: "no-store" }),
        fetch("/api/settings/instances?t=" + Date.now(), { cache: "no-store" })
      ]);
      if (res.ok) {
        const data = await res.json();
        setInstances(data);
      }
      if (configsRes.ok) {
        const configsData = await configsRes.json();
        setInstanceConfigs(configsData);
      }
    } catch (e) {
      console.error("Failed to fetch instances", e);
    } finally {
      setLoadingInstances(false);
    }
  };

  const openManualSyncModal = () => {
    const activeInsts = instances.filter((inst: any) => {
      const connStatus = String(inst.connectionStatus || inst.status || "").toLowerCase();
      return connStatus === "connected" || connStatus === "online" || connStatus === "open";
    }).map((inst: any) => inst.rawName || inst.name);
    setSyncSelectedInstances(activeInsts);
    setSyncTargetSourceId("whatsapp_sync");
    setShowManualSyncModal(true);
  };

  const handleStartManualSync = async (e: React.FormEvent) => {
    e.preventDefault();
    if (syncSelectedInstances.length === 0) {
      alert("请至少选择一个 WhatsApp 实例进行同步！");
      return;
    }

    setSyncingNow(true);
    try {
      const res = await fetch("/api/contacts/sync-whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceName: syncSelectedInstances,
          sourceId: syncTargetSourceId
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同步失败");

      alert(`✓ 同步成功！\n${data.summary}`);
      setShowManualSyncModal(false);
    } catch (err: any) {
      alert(`同步失败: ${err.message}`);
    } finally {
      setSyncingNow(false);
    }
  };

  const fetchBindingPairingCode = async (rawName: string, phoneNumber: string) => {
    setFetchingPairingCode(true);
    setBindError("");
    try {
      const cleanPhone = phoneNumber.replace(/[^0-9]/g, "");
      const res = await fetch(`/api/instances/connect?instanceName=${rawName}&method=pairing&phoneNumber=${cleanPhone}&t=${Date.now()}`);
      const data = await res.json();
      if (res.ok) {
        setBindingPairingCode(data.pairingCode);
      } else {
        setBindError(data.error || "生成连接验证码失败");
      }
    } catch (err: any) {
      setBindError(`请求错误: ${err.message}`);
    } finally {
      setFetchingPairingCode(false);
    }
  };

  const fetchBindingQr = async (rawName: string) => {
    setFetchingPairingCode(true);
    setBindError("");
    try {
      const res = await fetch(`/api/instances/connect?instanceName=${rawName}&method=qr&t=${Date.now()}`);
      const data = await res.json();
      if (res.ok) {
        setBindingQr(data.qrcode);
      } else {
        setBindError(data.error || "生成连接二维码失败");
      }
    } catch (err: any) {
      setBindError(`请求错误: ${err.message}`);
    } finally {
      setFetchingPairingCode(false);
    }
  };

  const handleCreateInstance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInstanceName.trim() || !newPhoneNumber.trim()) {
      setBindError("请完整输入实例名称与手机号码");
      return;
    }
    setBindingLoading(true);
    setBindError("");
    setBindingQr(null);
    setBindingRawName(null);
    setBindingPairingCode(null);
    try {
      const cleanPhone = newPhoneNumber.replace(/[^0-9]/g, "");
      if (!cleanPhone) {
        setBindError("请输入有效的手机号数字");
        setBindingLoading(false);
        return;
      }
      const res = await fetch("/api/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceName: newInstanceName.trim(),
          phoneNumber: cleanPhone
        })
      });
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const data = await res.json();
        if (!res.ok) {
          setBindError(data.message || data.error || "创建失败");
        } else {
          setBindingRawName(data.rawName);
          
          // Save the alias configuration to DB immediately
          try {
            await fetch("/api/settings/instances", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                instanceName: data.rawName,
                alias: newInstanceAlias.trim() || null,
                allowKanban: 1,
                allowHub: 1,
                allowSync: 1
              })
            });
          } catch (aliasErr) {
            console.error("Failed to save alias during instance creation", aliasErr);
          }
          
          if (bindMethod === "pairing") {
            await fetchBindingPairingCode(data.rawName, cleanPhone);
          } else {
            setBindingQr(data.qrcode || null);
          }
        }
      } else {
        const htmlErr = await res.text();
        setBindError(`服务器返回了非 JSON 错误 (HTTP ${res.status}): ${htmlErr.substring(0, 150)}`);
      }
    } catch (err: any) {
      setBindError(`网络连接错误: ${err.message || err}`);
    } finally {
      setBindingLoading(false);
    }
  };

  const handleOpenReconnect = async (inst: any) => {
    setReconnectTarget(inst);
    setReconnectMethod("qr");
    setReconnectQr(null);
    setReconnectPairingCode(null);
    setReconnectError("");
    setReconnectLoading(true);
    setShowReconnectModal(true);

    const defaultPhone = inst.ownerJid ? inst.ownerJid.split("@")[0] : "";
    setReconnectPhone(defaultPhone.replace(/[^0-9]/g, ""));

    try {
      const res = await fetch(`/api/instances/connect?instanceName=${inst.rawName}&method=qr&t=${Date.now()}`);
      const data = await res.json();
      if (res.ok) {
        setReconnectQr(data.qrcode);
      } else {
        setReconnectError(data.error || "获取二维码失败");
      }
    } catch (err: any) {
      setReconnectError(`网络错误: ${err.message}`);
    } finally {
      setReconnectLoading(false);
    }
  };

  const handleFetchReconnectPairing = async () => {
    if (!reconnectPhone.trim()) {
      setReconnectError("请输入用于绑定的手机号码");
      return;
    }
    setFetchingReconnectCode(true);
    setReconnectError("");
    try {
      const cleanPhone = reconnectPhone.replace(/[^0-9]/g, "");
      const res = await fetch(`/api/instances/connect?instanceName=${reconnectTarget.rawName}&method=pairing&phoneNumber=${cleanPhone}&t=${Date.now()}`);
      const data = await res.json();
      if (res.ok) {
        setReconnectPairingCode(data.pairingCode);
      } else {
        setReconnectError(data.error || "获取验证码失败");
      }
    } catch (err: any) {
      setReconnectError(`网络错误: ${err.message}`);
    } finally {
      setFetchingReconnectCode(false);
    }
  };

  const handleRefreshReconnectQr = async () => {
    setReconnectLoading(true);
    setReconnectError("");
    try {
      const res = await fetch(`/api/instances/connect?instanceName=${reconnectTarget.rawName}&method=qr&t=${Date.now()}`);
      const data = await res.json();
      if (res.ok) {
        setReconnectQr(data.qrcode);
      } else {
        setReconnectError(data.error || "获取新二维码失败");
      }
    } catch (err: any) {
      setReconnectError(`网络错误: ${err.message}`);
    } finally {
      setReconnectLoading(false);
    }
  };

  const handleDeleteInstance = async () => {
    if (!deleteInstanceName) return;
    try {
      const res = await fetch(`/api/instances?instanceName=${deleteInstanceName}`, {
        method: "DELETE"
      });
      if (res.ok) {
        fetchInstances();
      } else {
        const data = await res.json();
        alert(data.error || "解绑失败");
      }
    } catch (err) {
      alert("网络错误，解绑失败");
    } finally {
      setDeleteInstanceName(null);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.save(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {} finally { setSaving(false); }
  };

  if (loading) return <PageLoading />;

  return (
    <div className="max-w-3xl pb-16">
      <header className="mb-8">
        <h1 className="text-3xl font-black tracking-tight text-slate-950">系统设置</h1>
        <p className="text-slate-700 font-bold mt-1">配置发送策略与第三方集成</p>
      </header>

      {saved && (
        <div className="mb-6 p-3 bg-green-50 text-green-600 text-sm rounded-xl border border-green-100">✓ 设置已保存</div>
      )}

      {/* Flow control */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-6">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="p-2 bg-purple-50 text-purple-600 rounded-lg"><Users className="w-5 h-5" /></div>
          <div><h2 className="font-black text-slate-900">流量控制</h2><p className="text-sm text-slate-600 font-bold">防止账号异常</p></div>
        </div>
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-black text-slate-900 mb-1">实例 24 小时全局上限</label>
              <p className="text-xs text-slate-600 font-bold">按手机号（实例）控制每天最大发送量</p>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={settings.maxSendLimit}
                onChange={(e) => setSettings({ ...settings, maxSendLimit: parseInt(e.target.value) || 0 })}
                className="border-2 border-slate-300 rounded-xl px-4 py-3 w-32 font-black text-slate-900 focus:border-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-slate-50"
              />
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={true} readOnly />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-6">
            <div>
              <label className="block text-sm font-black text-slate-900 mb-1">全局默认随机发送延迟范围</label>
              <p className="text-xs text-slate-600 font-bold">当素材没有设置单独发送延迟时，系统默认使用的随机发送延迟间隔（秒）</p>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={settings.minDelay}
                onChange={(e) => setSettings({ ...settings, minDelay: parseInt(e.target.value) || 0 })}
                className="border-2 border-slate-300 rounded-xl px-3 py-2 w-20 text-center font-black text-slate-900 focus:border-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-slate-50"
                placeholder="最小"
              />
              <span className="text-sm font-bold text-slate-500">到</span>
              <input
                type="number"
                value={settings.maxDelay}
                onChange={(e) => setSettings({ ...settings, maxDelay: parseInt(e.target.value) || 0 })}
                className="border-2 border-slate-300 rounded-xl px-3 py-2 w-20 text-center font-black text-slate-900 focus:border-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-slate-50"
                placeholder="最大"
              />
              <span className="text-sm font-bold text-slate-500">秒</span>
            </div>
          </div>
        </div>
      </div>


      {/* AI API Keys */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-6">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><LinkIcon className="w-5 h-5" /></div>
          <div><h2 className="font-black text-slate-900">AI 模型 API Key</h2><p className="text-sm text-slate-600 font-bold">配置大模型密钥（仅保存在您的账户）</p></div>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-black text-slate-900 mb-2">OpenAI API Key</label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={settings.apiKeys?.openai || ""}
                onChange={(e) => setSettings({ ...settings, apiKeys: { ...(settings.apiKeys || {}), openai: e.target.value } })}
                placeholder="sk-..."
                className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 font-black text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 placeholder:text-slate-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-black text-slate-900 mb-2">DeepSeek API Key</label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={settings.apiKeys?.deepseek || ""}
                onChange={(e) => setSettings({ ...settings, apiKeys: { ...(settings.apiKeys || {}), deepseek: e.target.value } })}
                placeholder="sk-..."
                className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 font-black text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 placeholder:text-slate-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-black text-slate-900 mb-2">Google Gemini API Key</label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={settings.apiKeys?.gemini || ""}
                onChange={(e) => setSettings({ ...settings, apiKeys: { ...(settings.apiKeys || {}), gemini: e.target.value } })}
                placeholder="AIzaSy..."
                className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 font-black text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 placeholder:text-slate-400"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Evolution API */}
      {isAdmin && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-6">
          <div className="p-6 border-b border-slate-100 flex items-center gap-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><LinkIcon className="w-5 h-5" /></div>
            <div><h2 className="font-black text-slate-900">Evolution API 配置</h2><p className="text-sm text-slate-600 font-bold">全局 WhatsApp 消息通道服务器</p></div>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-black text-slate-900 mb-2">Evolution API 地址 (Base URL)</label>
              <input
                type="text"
                value={settings.evolutionApiUrl || ""}
                onChange={(e) => setSettings({ ...settings, evolutionApiUrl: e.target.value })}
                placeholder="https://your-evolution-url.com"
                className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 font-black text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="block text-sm font-black text-slate-900 mb-2">Evolution 全局 API Key (Global API Key)</label>
              <input
                type={showSecret ? "text" : "password"}
                value={settings.evolutionApiKey || ""}
                onChange={(e) => setSettings({ ...settings, evolutionApiKey: e.target.value })}
                placeholder="请输入 Coolify 环境变量中的 API_KEY"
                className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 font-black text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="block text-sm font-black text-slate-900 mb-2">Evolution 接收 WhatsApp 消息 Webhook 地址 (n8n Webhook 链接，留空不自动绑定)</label>
              <input
                type="text"
                value={settings.evolutionWebhookUrl || ""}
                onChange={(e) => setSettings({ ...settings, evolutionWebhookUrl: e.target.value })}
                placeholder="https://your-n8n.com/webhook/..."
                className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 font-black text-slate-900 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 placeholder:text-slate-400"
              />
            </div>
          </div>
        </div>
      )}


      {/* Hub Webhook (Option B Direct Push) */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-6">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><LinkIcon className="w-5 h-5" /></div>
          <div>
            <h2 className="font-black text-slate-900">外部 Hub Webhook 出口</h2>
            <p className="text-sm text-slate-600 font-bold">新消息直接直连推送（不经过 n8n）</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-black text-slate-900 mb-2">Hub Webhook URL</label>
            <input
              type="text"
              value={settings.hubWebhookUrl || ""}
              onChange={(e) => setSettings({ ...settings, hubWebhookUrl: e.target.value })}
              placeholder="https://your-hub-webhook.com/..."
              className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 font-black text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 placeholder:text-slate-400"
            />
            <p className="text-xs text-slate-600 font-bold mt-1 text-slate-500">
              配置后，当 Evolution API 监听到 WhatsApp 新消息并自动写入看板时，系统会自动将清洗好的数据直接推送给此 URL。
            </p>
          </div>
          <div>
            <label className="block text-sm font-black text-slate-900 mb-2">Hub Webhook 安全令牌 (Token)</label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={settings.hubWebhookToken || ""}
                onChange={(e) => setSettings({ ...settings, hubWebhookToken: e.target.value })}
                placeholder="请输入与 Hub 约定的安全 Token（可选）"
                className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 pr-10 font-black text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50 placeholder:text-slate-400"
              />
            </div>
            <p className="text-xs text-slate-600 font-bold mt-1 text-slate-500">
              该令牌将作为 Header 参数 `X-Hub-Token` 和 Body 参数 `token` 进行传递，供您的 Hub 接收方进行来源验证鉴权。
            </p>
          </div>
        </div>
      </div>

      {/* Group Chat Monitor & Custom Hook */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-6">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="p-2 bg-rose-50 text-rose-600 rounded-lg"><Users className="w-5 h-5" /></div>
          <div>
            <h2 className="font-black text-slate-900">群聊监控与自定义 Hook 配置</h2>
            <p className="text-sm text-slate-600 font-bold">群聊消息的接收、流向与自定义 Webhook 转发</p>
          </div>
        </div>
        <div className="p-6 space-y-6">
          {/* Group Monitor Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-black text-slate-900 mb-1">启用群聊消息监控</label>
              <p className="text-xs text-slate-600 font-bold">开启后，系统将监控并同步来自群聊（@g.us）的进粉消息，否则会自动忽略群聊消息。</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={settings.groupMonitorEnabled === 1}
                onChange={(e) => setSettings({ ...settings, groupMonitorEnabled: e.target.checked ? 1 : 0 })}
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-rose-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-rose-600"></div>
            </label>
          </div>

          {/* Group Chat Target Kanban Step (Enabled only when group monitor is enabled) */}
          {settings.groupMonitorEnabled === 1 && (
            <div className="border-t border-slate-100 pt-6 animate-in fade-in duration-200">
              <label className="block text-sm font-black text-slate-900 mb-2">群聊进粉默认流向看板列</label>
              <select
                value={settings.groupTargetStepId || ""}
                onChange={(e) => setSettings({ ...settings, groupTargetStepId: e.target.value })}
                className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 font-black text-slate-900 focus:border-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-500 bg-slate-50 cursor-pointer"
              >
                <option value="">跟随系统默认 (看板最左侧「社群跟进」列)</option>
                {steps.map((step) => (
                  <option key={step.id} value={step.id}>
                    {step.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-600 font-bold mt-2">
                新检测到的群聊会自动在看板上创建客户卡片，并将其投递到您选择的指定看板列。
              </p>
            </div>
          )}

          {/* Custom Webhook URL */}
          <div className="border-t border-slate-100 pt-6">
            <label className="block text-sm font-black text-slate-900 mb-2">自定义 Webhook 出口 (HTTP POST)</label>
            <input
              type="text"
              value={settings.customHookUrl || ""}
              onChange={(e) => setSettings({ ...settings, customHookUrl: e.target.value })}
              placeholder="https://your-server.com/webhook/..."
              className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 font-black text-slate-900 focus:border-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-500 bg-slate-50 placeholder:text-slate-400"
            />
            <p className="text-xs text-slate-600 font-bold mt-2">
              如果配置了此 Webhook，系统在接收并清洗新消息时，会将清洗后的 JSON 报文（含 instance、phone、name、message、isGroup 等字段）以 POST 方式同步推送到该 URL。
            </p>
          </div>
        </div>
      </div>

      {/* Notion */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-8">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="p-2 bg-stone-50 text-stone-600 rounded-lg"><LinkIcon className="w-5 h-5" /></div>
          <div><h2 className="font-black text-slate-900">Notion 数据库</h2><p className="text-sm text-slate-600 font-bold">联系人数据源</p></div>
        </div>
        <div className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-black text-slate-900 mb-2">Integration Secret</label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={settings.notionSecret}
                onChange={(e) => setSettings({ ...settings, notionSecret: e.target.value })}
                placeholder="secret_..."
                className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 pr-10 font-black text-slate-900 focus:border-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-500 bg-slate-50 placeholder:text-slate-400"
              />
              <button type="button" onClick={() => setShowSecret((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-900">
                {showSecret ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-black text-slate-900 mb-2">Database ID</label>
            <input
              type="text"
              value={settings.notionDatabaseId}
              onChange={(e) => setSettings({ ...settings, notionDatabaseId: e.target.value })}
              placeholder="2f478443-..."
              className="w-full border-2 border-slate-300 rounded-xl px-4 py-3 font-black text-slate-900 focus:border-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-500 bg-slate-50 placeholder:text-slate-400"
            />
          </div>
          <div>
            <label className="block text-sm font-black text-slate-900 mb-2">定时反向同步时间</label>
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-slate-600" />
              <input
                type="time"
                value={settings.scheduledTime}
                onChange={(e) => setSettings({ ...settings, scheduledTime: e.target.value })}
                className="border-2 border-slate-300 rounded-xl px-4 py-3 w-40 font-black text-slate-900 focus:border-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-500 bg-slate-50"
              />
            </div>
            <p className="text-xs text-slate-800 font-bold mt-2">💡 每天在这个时间点，系统会自动在后台触发本地数据反向同步</p>
          </div>
        </div>
      </div>

      {/* WhatsApp Instances Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-8">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg"><Smartphone className="w-5 h-5" /></div>
            <div>
              <h2 className="font-black text-slate-900">WhatsApp 实例管理</h2>
              <p className="text-sm text-slate-600 font-bold">自助绑定与多实例状态监控</p>
              {!isAdmin && (
                <p className="text-xs text-purple-600 font-bold mt-1">
                  配额限制：已绑定 {instances.length} / {settings.maxInstances ?? 1} 个实例
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchInstances}
              disabled={loadingInstances}
              className="p-2 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors text-slate-600"
              title="刷新状态"
            >
              <RefreshCw className={`w-4 h-4 ${loadingInstances ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={() => {
                setBindError("");
                setBindingQr(null);
                setNewInstanceAlias("");
                setShowBindModal(true);
              }}
              disabled={!isAdmin && instances.length >= (settings.maxInstances ?? 1)}
              className={`flex items-center gap-1.5 px-4 py-2 font-bold rounded-xl text-xs transition-colors shadow-md ${
                (!isAdmin && instances.length >= (settings.maxInstances ?? 1))
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none border border-slate-200"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white"
              }`}
            >
              <Plus className="w-4 h-4" /> 绑定新实例
            </button>
          </div>
        </div>

        <div className="p-6">
          {loadingInstances && instances.length === 0 ? (
            <div className="flex items-center justify-center py-12 gap-2 text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" /> 加载实例中...
            </div>
          ) : instances.length === 0 ? (
            <div className="text-center py-12 text-slate-400 font-bold text-sm bg-slate-50 rounded-xl border border-dashed border-slate-200">
              📭 暂无绑定的 WhatsApp 实例。请点击右上角「绑定新实例」进行配置。
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {instances.map((inst: any) => {
                const connStatus = String(inst.connectionStatus || "").toLowerCase();
                const instStatus = String(inst.status || "").toLowerCase();
                
                const isConnected = 
                  connStatus === "connected" || 
                  connStatus === "online" || 
                  connStatus === "open" || 
                  instStatus === "open" || 
                  instStatus === "connected" || 
                  instStatus === "online";
                const isConnecting = connStatus === "connecting" || instStatus === "connecting";
                
                return (
                  <div 
                    key={inst.rawName} 
                    className={`p-4 border rounded-xl flex flex-col justify-between transition-all ${
                      inst.isOverQuota 
                        ? "bg-slate-100/70 border-slate-200 opacity-70" 
                        : "bg-slate-50 border-slate-200 hover:shadow-sm"
                    }`}
                  >
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex flex-col gap-0.5">
                          {editingAliasInstance === inst.rawName ? (
                            <div className="flex items-center gap-1 mt-1">
                              <input
                                type="text"
                                value={editingAliasValue}
                                onChange={(e) => setEditingAliasValue(e.target.value)}
                                className="border border-slate-300 rounded-lg px-2 py-0.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-28"
                                autoFocus
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveAliasInline(inst.rawName)}
                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                                title="保存"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingAliasInstance(null)}
                                className="p-1 text-red-600 hover:bg-red-50 rounded"
                                title="取消"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 group">
                              <span className="font-black text-slate-900 text-base">{inst.displayName}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAliasInstance(inst.rawName);
                                  setEditingAliasValue(configsMap[inst.rawName]?.alias || inst.displayName || "");
                                }}
                                className="p-0.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                                title="修改备注别名"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                          <span className="text-[10px] font-mono text-slate-400 select-all" title="完整实例名">
                            {inst.rawName}
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          {inst.isOverQuota ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black border bg-red-100 text-red-700 border-red-200 animate-pulse">
                              ⚠️ 超配额已暂停
                            </span>
                          ) : (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                              isConnected 
                                ? "bg-green-50 text-green-600 border-green-200" 
                                : isConnecting 
                                ? "bg-amber-50 text-amber-600 border-amber-200" 
                                : "bg-red-50 text-red-600 border-red-200"
                            }`}>
                              {isConnected ? "● 已连接" : isConnecting ? "● 连接中..." : "● 未连接"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 font-bold space-y-2 mt-3">
                        <div>📞 号码：{inst.ownerJid ? inst.ownerJid.split("@")[0] : "未绑定"}</div>
                        
                        {inst.tokenMask && (
                          <div className="text-[10px] text-slate-600">
                            🔑 凭证：<span className="font-mono">{inst.tokenMask}</span>（由服务器保管，不在此显示）
                          </div>
                        )}

                        {inst.ownerName && inst.ownerName !== "系统全局" && (
                          <div className="text-[10px] text-purple-600">归属用户：{inst.ownerName} ({inst.ownerEmail})</div>
                        )}

                        {/* 实例流入政策控制 */}
                        {!inst.isOverQuota && (
                          <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
                            <div className="text-[11px] font-black text-slate-700 mb-2">流向控制策略：</div>
                            <div className="grid grid-cols-3 gap-2">
                              <label className="flex items-center gap-1.5 cursor-pointer bg-white px-2 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300">
                                <input 
                                  type="checkbox" 
                                  checked={configsMap[inst.rawName]?.allowSync !== 0}
                                  onChange={() => handleToggleInstancePolicy(inst.rawName, 'allowSync', configsMap[inst.rawName]?.allowSync !== 0)}
                                  className="w-3.5 h-3.5 accent-emerald-600 rounded cursor-pointer"
                                />
                                <span className="text-[10px] font-bold text-slate-600 select-none">自动同步</span>
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer bg-white px-2 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300">
                                <input 
                                  type="checkbox" 
                                  checked={configsMap[inst.rawName]?.allowKanban !== 0}
                                  onChange={() => handleToggleInstancePolicy(inst.rawName, 'allowKanban', configsMap[inst.rawName]?.allowKanban !== 0)}
                                  className="w-3.5 h-3.5 accent-emerald-600 rounded cursor-pointer"
                                />
                                <span className="text-[10px] font-bold text-slate-600 select-none">流入看板</span>
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer bg-white px-2 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300">
                                <input 
                                  type="checkbox" 
                                  checked={configsMap[inst.rawName]?.allowHub !== 0}
                                  onChange={() => handleToggleInstancePolicy(inst.rawName, 'allowHub', configsMap[inst.rawName]?.allowHub !== 0)}
                                  className="w-3.5 h-3.5 accent-emerald-600 rounded cursor-pointer"
                                />
                                <span className="text-[10px] font-bold text-slate-600 select-none">推送 Hub</span>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-200 flex justify-between items-center">
                      <div className="text-[10px] text-slate-400 font-medium">Evolution API v2</div>
                      <div className="flex gap-3">
                        {!isConnected && !inst.isOverQuota && (
                          <button
                            onClick={() => handleOpenReconnect(inst)}
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs font-black transition-colors"
                          >
                            <RefreshCw className="w-3.5 h-3.5 animate-none" /> 重新连接
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteInstanceName(inst.rawName)}
                          className="flex items-center gap-1 text-red-600 hover:text-red-800 text-xs font-bold transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> 解绑
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* WhatsApp 自动同步与通知规则 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-8">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-50 text-teal-600 rounded-lg"><Clock className="w-5 h-5" /></div>
            <div>
              <h2 className="font-black text-slate-900">WhatsApp 联系人自动同步与规则</h2>
              <p className="text-sm text-slate-600 font-bold">配置每日定时同步与国家前缀映射通知规则</p>
            </div>
          </div>
          <button
            type="button"
            onClick={openManualSyncModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white hover:bg-teal-700 transition-colors text-xs font-black rounded-xl shadow-md shadow-teal-50 whitespace-nowrap self-stretch sm:self-auto justify-center"
          >
            <RefreshCw className="w-4 h-4 animate-none" />
            🔄 立即手动同步
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* 开关与定时 */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
            <div>
              <label className="block text-sm font-black text-slate-900 mb-1">启用每日定时同步</label>
              <p className="text-xs text-slate-600 font-bold">每天在指定时间自动拉取选定实例的联系人</p>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="time"
                value={settings.whatsappSyncTime || "03:00"}
                onChange={(e) => setSettings({ ...settings, whatsappSyncTime: e.target.value })}
                className="border-2 border-slate-300 rounded-xl px-4 py-2 font-black text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50"
              />
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={settings.whatsappSyncEnabled === 1}
                  onChange={(e) => setSettings({ ...settings, whatsappSyncEnabled: e.target.checked ? 1 : 0 })}
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-teal-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
              </label>
            </div>
          </div>

          {/* 管理员通知接收手机号 */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-100">
            <div>
              <label className="block text-sm font-black text-slate-900 mb-1">管理员新粉通知接收手机号</label>
              <p className="text-xs text-slate-600 font-bold">当有新线索来信时，系统会发送 WhatsApp 通知到此号码（需带国际前缀如 60127654321）</p>
            </div>
            <div className="flex items-center gap-4">
              <input
                type="text"
                value={settings.notificationPhone || ""}
                onChange={(e) => setSettings({ ...settings, notificationPhone: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="例如: 60127654321"
                className="border-2 border-slate-300 rounded-xl px-4 py-2 font-black text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-500 bg-slate-50 w-64 placeholder:text-slate-400"
              />
            </div>
          </div>

          {/* 自动同步的实例选择 */}
          <div className="pb-6 border-b border-slate-100">
            <label className="block text-sm font-black text-slate-900 mb-2">选择要自动同步的实例</label>
            <p className="text-xs text-slate-600 font-bold mb-4">定时同步触发时，仅从选中的实例同步联系人列表</p>
            {instances.length === 0 ? (
              <p className="text-xs text-slate-400 font-bold">暂无绑定的实例，请先在上方绑定实例</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {instances.map((inst) => {
                  const isChecked = autoSyncInstances.includes(inst.rawName);
                  return (
                    <label
                      key={inst.rawName}
                      className={`flex items-center gap-2 p-3 border rounded-xl cursor-pointer transition-all ${
                        isChecked
                          ? "bg-teal-50/50 border-teal-200 text-teal-900"
                          : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleAutoSyncInstance(inst.rawName)}
                        className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 w-4 h-4"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="font-bold text-xs truncate">{inst.displayName}</span>
                        <span className="text-[10px] text-slate-400 truncate font-mono">
                          {inst.ownerJid ? inst.ownerJid.split("@")[0] : "无号码"}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* 国家/地区前缀映射规则 */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <label className="block text-sm font-black text-slate-900 mb-1">同步国家/地区与通知规则</label>
                <p className="text-xs text-slate-600 font-bold">按电话号码前缀自动归属地区，并发送通知到同步所属实例的拥有者</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const newRules = [
                    ...rules,
                    { prefix: "", market: "", notify: false, template: "新名单提醒: {phone}" }
                  ];
                  updateRules(newRules);
                }}
                className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white hover:bg-slate-800 transition-colors text-xs font-bold rounded-lg shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" /> 添加规则
              </button>
            </div>

            {rules.length === 0 ? (
              <div className="text-center py-6 text-slate-400 font-bold text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                📭 暂无前缀映射规则，点击右上角添加
              </div>
            ) : (
              <div className="space-y-4">
                {rules.map((rule, index) => (
                  <div key={index} className="p-4 border border-slate-200 rounded-xl bg-slate-50 space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex-1 min-w-[120px]">
                        <label className="block text-[10px] font-black text-slate-600 mb-1">号码前缀 (如 65, 60)</label>
                        <input
                          type="text"
                          value={rule.prefix}
                          onChange={(e) => {
                            const newRules = [...rules];
                            newRules[index].prefix = e.target.value.replace(/[^0-9]/g, "");
                            updateRules(newRules);
                          }}
                          placeholder="e.g. 60"
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 bg-white"
                        />
                      </div>
                      <div className="flex-1 min-w-[120px]">
                        <label className="block text-[10px] font-black text-slate-600 mb-1">所属市场/标签 (如 马来西亚)</label>
                        <input
                          type="text"
                          value={rule.market}
                          onChange={(e) => {
                            const newRules = [...rules];
                            newRules[index].market = e.target.value;
                            updateRules(newRules);
                          }}
                          placeholder="e.g. 马来西亚"
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 bg-white"
                        />
                      </div>
                      <div className="flex items-center gap-2 pt-4">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={rule.notify}
                            onChange={(e) => {
                              const newRules = [...rules];
                              newRules[index].notify = e.target.checked;
                              updateRules(newRules);
                            }}
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-teal-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-600"></div>
                        </label>
                        <span className="text-xs font-bold text-slate-700">发送新名单通知</span>
                      </div>
                      <div className="pt-4 ml-auto">
                        <button
                          type="button"
                          onClick={() => {
                            const newRules = rules.filter((_, idx) => idx !== index);
                            updateRules(newRules);
                          }}
                          className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                          title="删除规则"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {rule.notify && (
                      <div className="pt-2 border-t border-slate-200">
                        <label className="block text-[10px] font-black text-slate-600 mb-1 flex justify-between">
                          <span>通知消息模板</span>
                          <span className="text-slate-400 font-normal">支持以下变量</span>
                        </label>
                        <textarea
                          rows={2}
                          value={rule.template}
                          onChange={(e) => {
                            const newRules = [...rules];
                            newRules[index].template = e.target.value;
                            updateRules(newRules);
                          }}
                          placeholder="例如: 🔔 收到新来电!\n名字: {name}\n号码: {phone}\n市场: {market}\n时间: {date} {time}\n首条消息: {message}"
                          className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 bg-white placeholder:text-slate-400"
                        />
                        <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                          <span className="text-[10px] font-bold text-slate-500 mr-1">点击快速插入变量到末尾：</span>
                          {[
                            { label: "客户姓名 {name}", value: "{name}" },
                            { label: "电话号码 {phone}", value: "{phone}" },
                            { label: "地区/市场 {market}", value: "{market}" },
                            { label: "当前日期 {date}", value: "{date}" },
                            { label: "当前时间 {time}", value: "{time}" },
                            { label: "首条消息 {message}", value: "{message}" }
                          ].map((v) => (
                            <button
                              key={v.value}
                              type="button"
                              onClick={() => {
                                const newRules = [...rules];
                                const currentTemplate = rule.template || "";
                                newRules[index].template = currentTemplate + v.value;
                                updateRules(newRules);
                              }}
                              className="px-2 py-1 bg-teal-50 hover:bg-teal-100 text-teal-700 text-[10px] font-black rounded border border-teal-200 transition-colors cursor-pointer"
                            >
                              +{v.label.split(" ")[0]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>



      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-slate-900 text-white px-8 py-3 rounded-xl font-semibold flex items-center gap-2 hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          {saving ? "保存中..." : "保存所有设置"}
        </button>
      </div>

      {/* Bind Modal */}
      <Modal open={showBindModal} onClose={() => { if (!bindingLoading) setShowBindModal(false); }} title="绑定新 WhatsApp 实例">
        {!bindingQr && !bindingPairingCode ? (
          <form onSubmit={handleCreateInstance} className="space-y-4">
            {bindError && (
              <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{bindError}</span>
              </div>
            )}
            <div>
              <label className="block text-sm font-black text-slate-700 mb-1.5">实例名称 *</label>
              <input
                type="text"
                value={newInstanceName}
                onChange={(e) => setNewInstanceName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                placeholder="例如: malaysia-office (仅支持英文和数字)"
                className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-semibold"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-black text-slate-700 mb-1.5">实例备注别名 (例如: 新加坡)</label>
              <input
                type="text"
                value={newInstanceAlias}
                onChange={(e) => setNewInstanceAlias(e.target.value)}
                placeholder="可选，例如: 新加坡、马来西亚"
                className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-semibold"
              />
            </div>
            <div>
              <label className="block text-sm font-black text-slate-700 mb-1.5">手机号码 (带国区号) *</label>
              <input
                type="text"
                value={newPhoneNumber}
                onChange={(e) => setNewPhoneNumber(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="例如: 60124567786 (不要带+或空格)"
                className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-semibold"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-black text-slate-500 uppercase mb-2">绑定模式 *</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setBindMethod("qr")}
                  className={`py-2 px-3 rounded-xl border-2 text-center text-xs font-black transition-all ${
                    bindMethod === "qr"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                  }`}
                >
                  📸 扫码绑定
                </button>
                <button
                  type="button"
                  onClick={() => setBindMethod("pairing")}
                  className={`py-2 px-3 rounded-xl border-2 text-center text-xs font-black transition-all ${
                    bindMethod === "pairing"
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                  }`}
                >
                  🔑 验证码绑定
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={bindingLoading}
              className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors disabled:opacity-50 shadow-md"
            >
              {bindingLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : bindMethod === "pairing" ? "生成绑定验证码" : "生成绑定二维码"}
            </button>
          </form>
        ) : (
          <div className="text-center py-4 flex flex-col items-center">
            <h3 className="font-black text-lg text-emerald-600 mb-2 flex items-center gap-1.5 justify-center">
              <CheckCircle className="w-5 h-5" /> 实例创建成功！
            </h3>
            
            <div className="flex gap-2 mb-6 w-full bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={async () => {
                  setBindMethod("qr");
                  if (!bindingQr && bindingRawName) {
                    await fetchBindingQr(bindingRawName);
                  }
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${
                  bindMethod === "qr" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                📸 扫码绑定
              </button>
              <button
                type="button"
                onClick={async () => {
                  setBindMethod("pairing");
                  if (!bindingPairingCode && bindingRawName) {
                    await fetchBindingPairingCode(bindingRawName, newPhoneNumber);
                  }
                }}
                className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${
                  bindMethod === "pairing" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                🔑 验证码绑定
              </button>
            </div>

            {bindError && (
              <div className="bg-red-50 text-red-600 p-3.5 rounded-xl text-xs flex items-center gap-2 mb-4 w-full text-left">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{bindError}</span>
              </div>
            )}

            {bindMethod === "qr" ? (
              <div className="w-full flex flex-col items-center">
                <p className="text-sm text-slate-600 font-bold mb-4">请使用手机 WhatsApp 扫描下方二维码进行绑定：</p>
                {fetchingPairingCode ? (
                  <div className="w-64 h-64 border border-slate-200 rounded-2xl flex flex-col items-center justify-center bg-slate-50 mb-6 gap-2 text-slate-400">
                    <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                    <span className="text-xs font-bold">正在拉取二维码...</span>
                  </div>
                ) : bindingQr ? (
                  <div className="relative p-4 border border-slate-200 rounded-2xl bg-white shadow-sm mb-6">
                    <img
                      src={bindingQr}
                      alt="Scan to bind WhatsApp"
                      className="w-64 h-64 mx-auto rounded-lg"
                    />
                    <div className="absolute inset-0 bg-white/80 opacity-0 hover:opacity-100 transition-opacity flex flex-col items-center justify-center rounded-2xl p-4">
                      <p className="text-xs text-slate-500 font-bold mb-2">二维码将在 30 秒内过期</p>
                      <button
                        type="button"
                        onClick={() => fetchBindingQr(bindingRawName!)}
                        className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-700 flex items-center gap-1 shadow"
                      >
                        <RefreshCw className="w-3 h-3" /> 手动刷新
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="w-64 h-64 border border-slate-200 rounded-2xl flex flex-col items-center justify-center bg-slate-50 mb-6 gap-2">
                    <p className="text-xs text-red-500 font-bold">二维码获取失败</p>
                    <button
                      type="button"
                      onClick={() => fetchBindingQr(bindingRawName!)}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-700"
                    >
                      点击刷新
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full flex flex-col items-center">
                <p className="text-sm text-slate-600 font-bold mb-4">请在手机端输入以下 8 位验证码绑定：</p>
                {fetchingPairingCode ? (
                  <div className="w-full py-8 border border-slate-200 rounded-2xl flex flex-col items-center justify-center bg-slate-50 mb-6 gap-2 text-slate-400">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                    <span className="text-xs font-bold">正在生成验证码...</span>
                  </div>
                ) : bindingPairingCode ? (
                  <div className="w-full p-6 border border-slate-200 rounded-2xl bg-white shadow-sm mb-6 flex flex-col items-center gap-4">
                    <div className="font-mono text-3xl font-black text-slate-900 tracking-wider bg-slate-50 px-6 py-3.5 rounded-xl border-2 border-slate-200 border-dashed select-all">
                      {bindingPairingCode}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(bindingPairingCode);
                          alert("✓ 验证码已复制！");
                        }}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-black flex items-center gap-1 border border-slate-200"
                      >
                        复制验证码
                      </button>
                      <button
                        type="button"
                        onClick={() => fetchBindingPairingCode(bindingRawName!, newPhoneNumber)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-black flex items-center gap-1 shadow"
                      >
                        <RefreshCw className="w-3.5 h-3.5" /> 刷新验证码
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="w-full py-8 border border-slate-200 rounded-2xl flex flex-col items-center justify-center bg-slate-50 mb-6 gap-2">
                    <p className="text-xs text-red-500 font-bold">验证码获取失败，请确保填写的手机号带国区号</p>
                    <button
                      type="button"
                      onClick={() => fetchBindingPairingCode(bindingRawName!, newPhoneNumber)}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-black hover:bg-emerald-700"
                    >
                      点击重新生成
                    </button>
                  </div>
                )}

                <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left text-xs font-semibold text-slate-600 mb-6 space-y-2">
                  <p className="font-black text-slate-800">💡 验证码绑定指引：</p>
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>打开手机 WhatsApp {"->"} 点击“已链接的的设备” {"->"} “链接新设备”；</li>
                    <li>选择 <strong className="text-emerald-600">“使用手机号绑定” (Link with phone number instead)</strong>；</li>
                    <li>在手机上输入上述显示的 8 位验证码即可完成绑定连接。</li>
                  </ol>
                </div>
              </div>
            )}

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left w-full text-xs font-semibold space-y-1.5 mb-4 text-slate-700">
              <div><strong>显示名称：</strong> <code>{newInstanceName}</code></div>
              <div className="truncate"><strong>完整实例名：</strong> <code className="select-all">{bindingRawName}</code></div>
              <div className="truncate"><strong>实例凭证：</strong> 由服务器自动保管（不显示明文）</div>
            </div>

            <div className="flex items-center gap-2 text-xs font-bold text-slate-500 animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>等待手机扫码或验证中，系统会自动检测...</span>
            </div>
          </div>
        )}
      </Modal>

      {/* Reconnect Modal */}
      <Modal open={showReconnectModal} onClose={() => { if (!reconnectLoading) setShowReconnectModal(false); }} title={`重新连接 WhatsApp 实例: ${reconnectTarget?.displayName || ""}`}>
        <div className="text-center py-2 flex flex-col items-center">
          <p className="text-sm text-slate-600 font-bold mb-4">
            该实例当前处于离线状态。请选择一种方式重新绑定连接：
          </p>

          <div className="flex gap-2 mb-6 w-full bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setReconnectMethod("qr");
                if (!reconnectQr) {
                  handleRefreshReconnectQr();
                }
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${
                reconnectMethod === "qr" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              📸 扫码连接
            </button>
            <button
              type="button"
              onClick={() => {
                setReconnectMethod("pairing");
                if (!reconnectPairingCode) {
                  handleFetchReconnectPairing();
                }
              }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${
                reconnectMethod === "pairing" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              🔑 验证码连接
            </button>
          </div>

          {reconnectError && (
            <div className="bg-red-50 text-red-600 p-3.5 rounded-xl text-xs flex items-center gap-2 mb-4 w-full text-left">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{reconnectError}</span>
            </div>
          )}

          {reconnectMethod === "qr" ? (
            <div className="w-full flex flex-col items-center animate-in fade-in duration-200">
              {reconnectLoading ? (
                <div className="w-64 h-64 border border-slate-200 rounded-2xl flex flex-col items-center justify-center bg-slate-50 mb-6 gap-2 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
                  <span className="text-xs font-bold">正在生成二维码...</span>
                </div>
              ) : reconnectQr ? (
                <div className="relative p-4 border border-slate-200 rounded-2xl bg-white shadow-sm mb-6">
                  <img
                    src={reconnectQr}
                    alt="Scan to bind WhatsApp"
                    className="w-64 h-64 mx-auto rounded-lg"
                  />
                  <div className="absolute inset-0 bg-white/80 opacity-0 hover:opacity-100 transition-opacity flex flex-col items-center justify-center rounded-2xl p-4">
                    <p className="text-xs text-slate-500 font-bold mb-2">二维码将在 30 秒内过期</p>
                    <button
                      type="button"
                      onClick={handleRefreshReconnectQr}
                      className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-700 flex items-center gap-1 shadow"
                    >
                      <RefreshCw className="w-3 h-3" /> 手动刷新
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-64 h-64 border border-slate-200 rounded-2xl flex flex-col items-center justify-center bg-slate-50 mb-6 gap-2">
                  <p className="text-xs text-red-500 font-bold">二维码拉取失败</p>
                  <button
                    type="button"
                    onClick={handleRefreshReconnectQr}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black hover:bg-emerald-700"
                  >
                    点击重试
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="w-full flex flex-col items-center animate-in fade-in duration-200">
              <div className="w-full mb-4 text-left">
                <label className="block text-xs font-black text-slate-700 mb-1.5">手机号码 (带国区号) *</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reconnectPhone}
                    onChange={(e) => setReconnectPhone(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="例如: 60124567786"
                    className="flex-1 border-2 border-slate-200 rounded-xl px-4 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all font-semibold text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleFetchReconnectPairing}
                    disabled={fetchingReconnectCode || !reconnectPhone.trim()}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
                  >
                    {fetchingReconnectCode ? "生成中..." : "获取绑定码"}
                  </button>
                </div>
              </div>

              {fetchingReconnectCode ? (
                <div className="w-full py-8 border border-slate-200 rounded-2xl flex flex-col items-center justify-center bg-slate-50 mb-6 gap-2 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                  <span className="text-xs font-bold">正在拉取绑定码...</span>
                </div>
              ) : reconnectPairingCode ? (
                <div className="w-full p-6 border border-slate-200 rounded-2xl bg-white shadow-sm mb-6 flex flex-col items-center gap-4">
                  <div className="font-mono text-3xl font-black text-slate-900 tracking-wider bg-slate-50 px-6 py-3.5 rounded-xl border-2 border-slate-200 border-dashed select-all">
                    {reconnectPairingCode}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(reconnectPairingCode);
                        alert("✓ 验证码已复制！");
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-black flex items-center gap-1 border border-slate-200"
                    >
                      复制验证码
                    </button>
                    <button
                      type="button"
                      onClick={handleFetchReconnectPairing}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-black flex items-center gap-1 shadow"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> 刷新验证码
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full py-6 border border-slate-100 rounded-2xl bg-slate-50 text-slate-400 text-xs font-bold mb-6">
                  请输入手机号码并点击「获取绑定码」进行连接
                </div>
              )}

              <div className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left text-xs font-semibold text-slate-600 mb-6 space-y-1.5">
                <p className="font-black text-slate-800">💡 验证码绑定指引：</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>打开手机 WhatsApp {"->"} 点击“已链接的的设备” {"->"} “链接新设备”；</li>
                  <li>选择 <strong className="text-emerald-600">“使用手机号绑定” (Link with phone number instead)</strong>；</li>
                  <li>在手机上输入上述显示的 8 位验证码即可完成重新连接。</li>
                </ol>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs font-bold text-slate-500 animate-pulse mt-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>系统检测状态中，手机端操作完成后会自动关闭...</span>
          </div>
        </div>
      </Modal>

      {/* Manual Sync Modal */}
      <Modal open={showManualSyncModal} onClose={() => { if (!syncingNow) setShowManualSyncModal(false); }} title="🔄 立即手动同步 WhatsApp 联系人">
        <form onSubmit={handleStartManualSync} className="space-y-4">
          <div>
            <label className="block text-xs font-black text-slate-500 uppercase mb-2">选择同步实例 (可多选) *</label>
            {instances.length === 0 ? (
              <p className="text-xs text-red-500 font-bold py-2">⚠️ 暂无绑定的实例，请先绑定并扫码连接！</p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto border border-slate-100 p-2.5 rounded-xl bg-slate-50">
                {instances.map((inst) => {
                  const instName = inst.rawName || inst.name;
                  const isChecked = syncSelectedInstances.includes(instName);
                  const isConnected = String(inst.connectionStatus || inst.status || "").toLowerCase() === "connected" ||
                                      String(inst.connectionStatus || inst.status || "").toLowerCase() === "online" ||
                                      String(inst.connectionStatus || inst.status || "").toLowerCase() === "open";
                  return (
                    <label key={instName} className={`flex items-center gap-2.5 p-1 cursor-pointer select-none text-xs font-semibold hover:text-slate-900 transition-colors ${isConnected ? "text-slate-600" : "text-slate-400 opacity-50"}`}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={!isConnected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSyncSelectedInstances([...syncSelectedInstances, instName]);
                          } else {
                            setSyncSelectedInstances(syncSelectedInstances.filter(name => name !== instName));
                          }
                        }}
                        className="w-3.5 h-3.5 rounded text-teal-600 focus:ring-teal-500 border-slate-300 cursor-pointer"
                      />
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-red-500"}`}></span>
                        {inst.displayName || inst.name} <span className="text-slate-400 font-normal">({instName})</span>
                        {!isConnected && <span className="text-[10px] text-red-500 font-bold">(未连接/离线)</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-black text-slate-500 uppercase mb-1.5">选择目标数据源 *</label>
            <select
              value={syncTargetSourceId}
              onChange={(e) => setSyncTargetSourceId(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white cursor-pointer text-xs"
            >
              <option value="whatsapp_sync">(系统默认) WhatsApp 同步</option>
              <optgroup label="合并至已有数据源">
                {dataSources.map((ds: any) => (
                  <option key={ds.id} value={ds.id}>{ds.name} ({ds.type === 'WHATSAPP' ? 'WhatsApp' : ds.type})</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="bg-amber-50 border border-amber-100 p-3.5 rounded-xl space-y-1">
            <h4 className="text-xs font-bold text-amber-800 flex items-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> 规则注意事项
            </h4>
            <p className="text-[10px] text-amber-700 leading-relaxed font-semibold">
              1. 立即手动同步将严格执行您当前配置的“国家前缀映射规则”。未匹配前缀的联系人将被跳过以防污染数据库。<br />
              2. 同步过程中会静默查找在库联系人并执行更新合并，不干扰现有 Notion/Excel 等手动导入批次名单的归属。
            </p>
          </div>

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              disabled={syncingNow}
              onClick={() => setShowManualSyncModal(false)}
              className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={syncingNow || syncSelectedInstances.length === 0}
              className="flex-1 py-3 bg-gradient-to-r from-teal-500 to-emerald-600 text-white rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-2"
            >
              {syncingNow ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  正在同步中...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  开始同步
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteInstanceName}
        onClose={() => setDeleteInstanceName(null)}
        onConfirm={handleDeleteInstance}
        title="确认解绑 WhatsApp 实例"
        description="解绑后该实例的会话将被完全删除，系统将停止通过此号发送消息。确定继续？"
        confirmText="确定解绑"
        variant="danger"
      />
    </div>
  );
}
