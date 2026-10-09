"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, Plus, Filter } from "lucide-react";
import { Campaign, campaignsApi } from "@/lib/api";
import { CampaignCard } from "@/components/campaign/CampaignCard";
import { PageLoading } from "@/components/ui/LoadingSpinner";
import { useRouter } from "next/navigation";

type FilterStatus = "ALL" | "ACTIVE" | "PAUSED" | "DRAFT";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("ALL");
  const [filterType, setFilterType] = useState<string>("ALL");
  const router = useRouter();

  const fetchCampaigns = useCallback(async () => {
    try {
      const data = await campaignsApi.list();
      setCampaigns(data);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const handleToggleStatus = async (campaign: Campaign) => {
    const newStatus = campaign.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    try {
      await campaignsApi.update(campaign.id, { status: newStatus });
      setCampaigns((prev) => prev.map((c) => c.id === campaign.id ? { ...c, status: newStatus } : c));
    } catch {}
  };

  const handleDelete = async (id: string) => {
    try {
      await campaignsApi.delete(id);
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
    } catch {}
  };

  const handleSend = async (campaign: Campaign) => {
    if (!window.confirm(`确定要立即启动发送活动「${campaign.name}」吗？\n将在后台向其联系人发送消息。`)) {
      return;
    }
    try {
      const result = await campaignsApi.trigger(campaign.id);
      if (result.success) {
        alert("指令已成功送达 n8n 工作流，开始发送！\n您可以点击编辑进入详情页查看进度。");
      } else {
        alert(result.message || "n8n 响应失败");
      }
    } catch (e: any) {
      alert(`发送失败: ${e.message}`);
    }
  };

  const filtered = campaigns.filter((c) => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "ALL" || c.status === filterStatus;
    
    let triggerType = "MANUAL";
    if (c.scheduleConfig) {
      try {
        const sc = typeof c.scheduleConfig === 'string' ? JSON.parse(c.scheduleConfig) : c.scheduleConfig;
        triggerType = sc.triggerType || "MANUAL";
      } catch {}
    }
    
    let matchType = true;
    if (filterType !== "ALL") {
      if (filterType === "KANBAN") {
        matchType = triggerType === "COLUMN_ENTER" || triggerType === "COLUMN_TIMEOUT";
      } else {
        matchType = triggerType === filterType;
      }
    }
    
    return matchSearch && matchStatus && matchType;
  });

  if (loading) return <PageLoading />;

  return (
    <div className="space-y-6 pb-16">
      <header>
        <h1 className="text-4xl font-black tracking-tighter text-slate-950">活动管理</h1>
        <p className="text-slate-700 font-bold mt-1">管理所有 WhatsApp 营销活动</p>
      </header>

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索活动名称..."
            className="w-full pl-12 pr-4 py-3 border-2 border-slate-200 rounded-2xl text-sm font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 bg-slate-50 placeholder:text-slate-400"
          />
        </div>

        {/* 触发类型筛选 */}
        <div className="relative min-w-[200px]">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="w-full border-2 border-slate-200 rounded-2xl pl-4 pr-10 py-3 text-sm font-black text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white appearance-none cursor-pointer"
          >
            <option value="ALL">🌐 全部触发类型</option>
            <option value="MANUAL">🖱️ 手动 / 批量群发</option>
            <option value="SCHEDULED">📅 定时周期触发</option>
            <option value="BIRTHDAY">🎂 生日自动触发</option>
            <option value="DATE_ATTRIBUTE">⏰ 日期属性触发</option>
            <option value="KANBAN">🎛️ 看板流转触发</option>
          </select>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-500 pointer-events-none" />
        </div>
        <div className="flex gap-2 flex-wrap">
          {(["ALL", "ACTIVE", "PAUSED", "DRAFT"] as FilterStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-6 py-3 rounded-2xl text-sm font-black transition-all ${filterStatus === s ? "bg-slate-950 text-white shadow-lg" : "bg-white border-2 border-slate-200 text-slate-700 hover:border-slate-400"}`}
            >
              {s === "ALL" ? "全部" : s === "ACTIVE" ? "进行中" : s === "PAUSED" ? "已暂停" : "草稿"}
            </button>
          ))}
        </div>
        <a
          href="/campaigns/new"
          className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors flex-shrink-0"
        >
          <Plus className="w-4 h-4" /> 新建
        </a>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-dashed border-slate-200 p-16 text-center">
          <Filter className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-slate-700 mb-2">还没有活动</h3>
          <p className="text-slate-400 text-sm mb-6">创建您的第一个 WhatsApp 营销活动</p>
          <a
            href="/campaigns/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-4 h-4" /> 新建活动
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              onEdit={(c) => router.push(`/campaigns/${c.id}`)}
              onToggleStatus={handleToggleStatus}
              onDelete={handleDelete}
              onSend={handleSend}
            />
          ))}
        </div>
      )}
    </div>
  );
}
