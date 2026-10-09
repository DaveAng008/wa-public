"use client";

import { useState, useEffect } from "react";
import { Save, Loader2, Users } from "lucide-react";
import { Campaign, groupsApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

interface CampaignFormProps {
  initial?: Partial<Campaign & { sourceId?: string }>;
  onSubmit: (data: { name: string; description?: string; groupId?: string; sourceId?: string; scheduleConfig?: any }) => Promise<void>;
  loading?: boolean;
}

export function CampaignForm({ initial = {}, onSubmit, loading = false }: CampaignFormProps) {
  const { user } = useAuth();
  const [name, setName] = useState(initial.name || "");
  const [description, setDescription] = useState(initial.description || "");
  const [groupId, setGroupId] = useState(initial.groupId || "");
  const [sourceId, setSourceId] = useState(initial.sourceId || "");
  const [groups, setGroups] = useState<any[]>([]);
  const [dataSources, setDataSources] = useState<any[]>([]);
  const [triggerType, setTriggerType] = useState<"SCHEDULED" | "BIRTHDAY" | "DATE_ATTRIBUTE" | "COLUMN_ENTER" | "COLUMN_TIMEOUT">("SCHEDULED");
  const [error, setError] = useState("");

  useEffect(() => {
    groupsApi.list().then(setGroups).catch(console.error);
    fetch("/api/data-sources")
      .then(res => res.json())
      .then(setDataSources)
      .catch(console.error);
  }, []);

  // 级联过滤：根据选择的数据源仅展现属于该数据源的人群包
  const filteredGroups = groups.filter(g => {
    if (!sourceId) return true;
    try {
      const cfg = typeof g.filterConfig === 'string' ? JSON.parse(g.filterConfig) : g.filterConfig;
      const gSourceId = cfg?.sourceId || "";
      return !gSourceId || gSourceId === "all" || gSourceId === sourceId;
    } catch {
      return true;
    }
  });

  const handleSourceChange = (newSourceId: string) => {
    setSourceId(newSourceId);
    if (groupId) {
      const currentG = groups.find(g => g.id === groupId);
      if (currentG) {
        try {
          const cfg = typeof currentG.filterConfig === 'string' ? JSON.parse(currentG.filterConfig) : currentG.filterConfig;
          const gSourceId = cfg?.sourceId || "";
          if (gSourceId && gSourceId !== "all" && gSourceId !== newSourceId) {
            setGroupId("");
          }
        } catch {}
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("请输入活动名称"); return; }
    setError("");
    try {
      await onSubmit({ 
        name: name.trim(), 
        description: description.trim() || undefined, 
        groupId: groupId || undefined,
        sourceId: sourceId || undefined,
        scheduleConfig: {
          triggerType: triggerType
        }
      });
    } catch (err: any) {
      setError(err.message || "保存失败，请检查网络或配置");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm font-bold border border-red-100">{error}</div>
      )}

      <div>
        <label className="block text-sm font-black text-slate-700 mb-1.5 uppercase tracking-wider">活动名称 *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：母亲节促销"
          className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-bold focus:border-blue-500 transition-all outline-none"
        />
      </div>

      <div>
        <label className="block text-sm font-black text-slate-700 mb-1.5 uppercase tracking-wider">绑定数据源 (Data Source)</label>
        <div className="relative">
          <select
            value={sourceId}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-bold focus:border-blue-500 transition-all outline-none bg-white appearance-none"
          >
            <option value="">🌐 所有数据源 (合并视图)</option>
            {dataSources.map(ds => (
              <option key={ds.id} value={ds.id}>
                {ds.type === 'NOTION' ? '🇸🇬 ' : '📁 '} {ds.name} ({ds.type})
              </option>
            ))}
          </select>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-500 pointer-events-none" />
        </div>
        <p className="text-[10px] text-slate-400 mt-1 font-bold italic">💡 切换数据源后，下方「目标人群包」将仅展示属于该数据源的专属人群包。</p>
      </div>

      <div>
        <label className="block text-sm font-black text-slate-700 mb-1.5 uppercase tracking-wider">目标人群包 (Target Audience)</label>
        <div className="relative">
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-bold focus:border-blue-500 transition-all outline-none bg-white appearance-none"
          >
            <option value="">-- 请选择一个人群包 (可选) --</option>
            {filteredGroups.map(g => (
              <option key={g.id} value={g.id}>{g.name} ({g.contactCount || 0}人)</option>
            ))}
          </select>
          <Users className="absolute right-4 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
        </div>
        
        {/* 人群包即时预览逻辑 */}
        {groupId && groups.find(g => g.id === groupId) && (() => {
          const g = groups.find(g => g.id === groupId);
          const cfg = typeof g.filterConfig === 'string' ? JSON.parse(g.filterConfig) : g.filterConfig;
          return (
            <div className="mt-3 p-4 bg-blue-50 border-2 border-dashed border-blue-100 rounded-2xl animate-in fade-in slide-in-from-top-1 duration-300">
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">选中人群预览</span>
                <span className="text-lg font-black text-blue-700">{g.contactCount || 0} <span className="text-xs">位联系人</span></span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cfg.markets?.length > 0 ? cfg.markets.map((m: string) => (
                  <span key={m} className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-[9px] font-black rounded uppercase">{m}</span>
                )) : <span className="text-[9px] text-slate-400 font-bold italic">所有市场</span>}
                
                <div className="w-px h-3 bg-blue-200 mx-1 self-center" />
 
                {cfg.relations?.length > 0 ? cfg.relations.map((r: string) => (
                  <span key={r} className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[9px] font-black rounded uppercase">{r}</span>
                )) : <span className="text-[9px] text-slate-400 font-bold italic">所有关系类型</span>}
              </div>
            </div>
          );
        })()}
        
        <p className="text-[10px] text-slate-400 mt-1 font-bold italic">选择后，该活动将仅针对该人群包内的联系人执行</p>
      </div>

      <div>
        <label className="block text-sm font-black text-slate-700 mb-1.5 uppercase tracking-wider">触发模式 (Trigger Mode)</label>
        <div className="relative">
          <select
            value={triggerType}
            onChange={(e: any) => setTriggerType(e.target.value)}
            className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-bold focus:border-blue-500 transition-all outline-none bg-white appearance-none"
          >
            <option value="SCHEDULED">特定日期或周期定时触发</option>
            <option value="BIRTHDAY">生日自动触发</option>
            <option value="DATE_ATTRIBUTE">日期属性触发 (如到期提醒)</option>
            {user?.kanbanEnabled && (
              <optgroup label="看板流转触发">
                <option value="COLUMN_ENTER">进入某一看板列时立刻触发</option>
                <option value="COLUMN_TIMEOUT">在某一列停留超时触发</option>
              </optgroup>
            )}
          </select>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-500 pointer-events-none" />
        </div>
        <p className="text-[10px] text-slate-400 mt-1 font-bold italic">
          {triggerType === "SCHEDULED" && "当到达指定日期或时间时，批量自动发送"}
          {triggerType === "BIRTHDAY" && "每天扫描，并在联系人生日当天自动发送祝福"}
          {triggerType === "DATE_ATTRIBUTE" && "读取属性(如到期时间)，并在到期前/后指定天数自动触发"}
          {triggerType === "COLUMN_ENTER" && "客户卡片一旦进入设定的看板列，立即触发消息发送"}
          {triggerType === "COLUMN_TIMEOUT" && "客户卡片在设定的看板列停留超过指定时长后触发发送"}
        </p>
      </div>

      <div>
        <label className="block text-sm font-black text-slate-700 mb-1.5 uppercase tracking-wider">活动描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="简要描述这个活动的目的（可选）"
          rows={2}
          className="w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-slate-900 font-bold focus:border-blue-500 transition-all outline-none resize-none"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 text-white px-6 py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
        {loading ? "正在保存..." : "立即保存活动"}
      </button>
    </form>
  );
}
