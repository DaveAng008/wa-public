"use client";

import { useEffect, useState } from "react";
import { Send, TrendingUp, Activity, Users, Plus, RefreshCw, Loader2 } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { SendProgress } from "@/components/campaign/SendProgress";
import { PageLoading } from "@/components/ui/LoadingSpinner";
import { dashboardApi } from "@/lib/api";

export default function DashboardPage() {
  const [data, setData] = useState<{
    todaySent: number;
    totalSent: number;
    activeCampaigns: number;
    onlineAccounts: number;
    recentActivity: Array<{
      id: string;
      type: "sent" | "failed" | "responded";
      contactName: string;
      campaignName: string;
      message: string;
      timestamp: string;
    }>;
    activeJob?: { campaignId: string; campaignName: string; total: number; sent: number; remaining: number; failed?: number; responded?: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const res = await dashboardApi.overview();
      setData(res);
    } catch {
      // graceful fallback - show empty state
      setData({
        todaySent: 0, totalSent: 0, activeCampaigns: 0, onlineAccounts: 0, recentActivity: [],
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleRefresh = () => { setRefreshing(true); fetchData(); };

  if (loading) return <PageLoading />;

  return (
    <div className="space-y-6 pb-16">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black tracking-tighter text-slate-950">总览仪表盘</h1>
          <p className="text-slate-700 font-bold mt-1">欢迎回来！以下是今日运营概览。</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-6 py-3 bg-white border-2 border-slate-200 rounded-2xl text-sm font-black text-slate-800 md:hover:border-blue-600 transition-all shadow-sm disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            刷新数据
          </button>
          <a
            href="/campaigns/new"
            className="flex items-center gap-2 px-6 py-3 bg-slate-950 text-white rounded-2xl text-sm font-black md:hover:bg-slate-800 transition-all shadow-lg"
          >
            <Plus className="w-4 h-4" /> 新建活动
          </a>
        </div>
      </header>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="今日发送量" 
          value={data?.todaySent ?? 0} 
          icon={Send} 
          trend="+12%" 
          trendDirection="up" 
          sparklineData={[5, 12, 18, 14, 25, 30, 22, 35, data?.todaySent ?? 0]}
        />
        <StatCard 
          title="总发送量" 
          value={data?.totalSent ?? 0} 
          icon={TrendingUp} 
          trend="+8%" 
          trendDirection="up" 
          sparklineData={[120, 180, 250, 310, 480, 560, 620, 780, data?.totalSent ?? 0]}
        />
        <StatCard 
          title="活跃活动" 
          value={data?.activeCampaigns ?? 0} 
          icon={Activity} 
          sparklineData={[1, 2, 2, 3, 2, 4, 3, 3, data?.activeCampaigns ?? 0]}
        />
        <StatCard 
          title="在线账号" 
          value={data?.onlineAccounts ?? 0} 
          icon={Users} 
          sparklineData={[1, 1, 1, 2, 2, 2, 2, 3, data?.onlineAccounts ?? 0]}
        />
      </div>

      {/* Active Job Progress */}
      {data?.activeJob && (
        <SendProgress
          total={data.activeJob.total}
          sent={data.activeJob.sent}
          failed={data.activeJob.failed ?? 0}
          responded={data.activeJob.responded ?? 0}
          remaining={data.activeJob.remaining}
          isRunning
        />
      )}

      {/* Onboarding for New Users */}
      {data && data.totalSent === 0 && data.activeCampaigns === 0 && (
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl p-8 text-white shadow-xl">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-black mb-4">开启您的专属营销之旅 🚀</h2>
            <p className="text-blue-100 font-medium mb-8 text-lg">
              欢迎使用全新的多用户隔离系统！您的数据与其他用户完全独立。
              只需三步即可开始您的第一次活动：
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white/20 md:bg-white/10 md:backdrop-blur-md rounded-2xl p-6 border border-white/20">
                <div className="w-10 h-10 bg-white text-blue-600 rounded-full flex items-center justify-center font-black mb-4 text-xl">1</div>
                <h3 className="font-black text-lg mb-2">同步联系人</h3>
                <p className="text-sm text-blue-50/80">配置您的 Notion 数据库链接并同步数据。</p>
                <a href="/contacts" className="inline-block mt-4 text-sm font-bold underline underline-offset-4">去同步 →</a>
              </div>
              <div className="bg-white/20 md:bg-white/10 md:backdrop-blur-md rounded-2xl p-6 border border-white/20">
                <div className="w-10 h-10 bg-white text-blue-600 rounded-full flex items-center justify-center font-black mb-4 text-xl">2</div>
                <h3 className="font-black text-lg mb-2">配置设置</h3>
                <p className="text-sm text-blue-50/80">设置发送延迟和 Webhook 地址。</p>
                <a href="/settings" className="inline-block mt-4 text-sm font-bold underline underline-offset-4">去设置 →</a>
              </div>
              <div className="bg-white/20 md:bg-white/10 md:backdrop-blur-md rounded-2xl p-6 border border-white/20">
                <div className="w-10 h-10 bg-white text-blue-600 rounded-full flex items-center justify-center font-black mb-4 text-xl">3</div>
                <h3 className="font-black text-lg mb-2">创建活动</h3>
                <p className="text-sm text-blue-50/80">编写您的消息模板并开始发送。</p>
                <a href="/campaigns/new" className="inline-block mt-4 text-sm font-bold underline underline-offset-4">去创建 →</a>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-3xl shadow-sm border-2 border-slate-100 p-4 md:p-8">
        <h2 className="text-xl font-black text-slate-950 mb-6 flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-600" /> 最近活动
        </h2>
        {data?.recentActivity && data.recentActivity.length > 0 ? (
          <div className="space-y-3">
            {data.recentActivity.map((item) => (
              <div key={item.id} className="flex gap-4 p-3 rounded-xl md:hover:bg-slate-50 transition-colors">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${item.type === "sent" ? "bg-blue-500" : item.type === "failed" ? "bg-red-500" : "bg-green-500"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">
                    {item.type === "failed" ? "跳过" : "发送给"} {item.contactName}
                    <span className="text-slate-400 font-normal"> · {item.campaignName || "日志记录"}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{item.message}</p>
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0">
                  {new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400 text-center py-8">暂无最近活动</p>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3 flex-wrap">
        <a href="/campaigns/new" className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium md:hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" /> 新建活动
        </a>
        <a href="/contacts" className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium md:hover:bg-slate-50 transition-colors">
          <Users className="w-4 h-4" /> 管理联系人
        </a>
        <a href="/reports" className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium md:hover:bg-slate-50 transition-colors">
          <TrendingUp className="w-4 h-4" /> 查看报表
        </a>
      </div>
    </div>
  );
}
