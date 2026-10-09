"use client";

import { useEffect, useState } from "react";
import { Download, TrendingUp, BarChart3, PieChart } from "lucide-react";
import { reportsApi, DailyStats, CampaignStats, HeatmapCell } from "@/lib/api";
import { PageLoading } from "@/components/ui/LoadingSpinner";

export default function ReportsPage() {
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [campaignStats, setCampaignStats] = useState<CampaignStats[]>([]);
  const [successRate, setSuccessRate] = useState<{ success: number; failed: number }>({ success: 0, failed: 0 });
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      reportsApi.dailyStats(30).catch(() => []),
      reportsApi.campaignComparison().catch(() => []),
      reportsApi.successRate().catch(() => ({ success: 0, failed: 0 })),
      reportsApi.heatmap().catch(() => []),
    ]).then(([d, c, s, h]) => {
      setDailyStats(d as DailyStats[]);
      setCampaignStats(c as CampaignStats[]);
      setSuccessRate(s as { success: number; failed: number });
      setHeatmap(h as HeatmapCell[]);
    }).finally(() => setLoading(false));
  }, []);

  const handleExport = () => {
    const rows = dailyStats.map((d) => `${d.date},${d.sent},${d.success},${d.failed},${d.responded}`);
    const csv = "日期,发送数,成功数,失败数,回复数\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "daily-report.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <PageLoading />;

  const maxDaily = Math.max(...dailyStats.map((d) => d.sent), 1);
  const maxCampaign = Math.max(...campaignStats.map((c) => c.sent), 1);
  const totalMessages = successRate.success + successRate.failed;
  const successPct = totalMessages > 0 ? Math.round((successRate.success / totalMessages) * 100) : 0;

  // Build heatmap grid
  const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const heatmapMap: Record<string, number> = {};
  heatmap.forEach((c) => { heatmapMap[`${c.dayOfWeek}-${c.hour}`] = c.count; });
  const maxHeat = Math.max(...heatmap.map((c) => c.count), 1);

  return (
    <div className="space-y-6 pb-16">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">数据报表</h1>
          <p className="text-slate-500 mt-1">近 30 天发送数据概览</p>
        </div>
        <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
          <Download className="w-4 h-4" /> 导出 CSV
        </button>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Trend */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="font-bold text-slate-800 flex items-center gap-2 mb-4"><TrendingUp className="w-5 h-5 text-blue-500" /> 每日发送趋势</h2>
          {dailyStats.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">暂无数据</p>
          ) : (
            <div className="space-y-2">
              {dailyStats.slice(-14).reverse().map((d) => (
                <div key={d.date} className="flex items-center gap-3">
                  <span className="text-xs text-slate-400 w-10 text-right">{d.date.slice(5)}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all duration-500 flex items-center justify-end pr-2" style={{ width: `${Math.max((d.sent / maxDaily) * 100, 2)}%` }}>
                      {d.sent > 0 && <span className="text-white text-xs font-medium">{d.sent}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Campaign Comparison */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="font-bold text-slate-800 flex items-center gap-2 mb-4"><BarChart3 className="w-5 h-5 text-green-500" /> 活动对比</h2>
          {campaignStats.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">暂无数据</p>
          ) : (
            <div className="space-y-3">
              {campaignStats.map((c) => (
                <div key={c.campaignId}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-700 font-medium truncate mr-2">{c.campaignName}</span>
                    <span className="text-slate-500">{c.sent} 发送</span>
                  </div>
                  <div className="flex gap-1">
                    <div className="bg-green-500 h-4 rounded-l" style={{ width: `${(c.success / maxCampaign) * 100}%` }} title={`成功 ${c.success}`} />
                    <div className="bg-red-400 h-4 rounded-r" style={{ width: `${(c.failed / maxCampaign) * 100}%` }} title={`失败 ${c.failed}`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Success Rate Pie */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="font-bold text-slate-800 flex items-center gap-2 mb-4"><PieChart className="w-5 h-5 text-purple-500" /> 发送成功率</h2>
          <div className="flex items-center justify-center gap-8">
            {/* Simple text-based pie using block characters */}
            <div className="text-center">
              <div className="text-5xl font-bold text-green-600">{successPct}%</div>
              <div className="text-sm text-slate-500 mt-2">成功率</div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
                <span className="text-sm text-slate-600">成功 {successRate.success}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-400 inline-block" />
                <span className="text-sm text-slate-600">失败 {successRate.failed}</span>
              </div>
            </div>
          </div>
          {/* Visual bar */}
          <div className="mt-6 h-4 bg-red-400 rounded-full overflow-hidden">
            <div className="h-full bg-green-500 rounded-full transition-all duration-700" style={{ width: `${successPct}%` }} />
          </div>
        </div>

        {/* Heatmap */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
          <h2 className="font-bold text-slate-800 flex items-center gap-2 mb-4"><BarChart3 className="w-5 h-5 text-amber-500" /> 响应热力图</h2>
          <p className="text-xs text-slate-400 mb-3">周几 / 几点最活跃</p>
          <div className="overflow-x-auto">
            <div className="min-w-[500px]">
              {/* Header row with hours */}
              <div className="flex gap-0.5 mb-1">
                <div className="w-8 flex-shrink-0" />
                {hours.filter((_, i) => i % 3 === 0).map((h) => (
                  <div key={h} className="flex-1 text-center text-xs text-slate-400">{h}:00</div>
                ))}
              </div>
              {days.map((day, di) => (
                <div key={day} className="flex gap-0.5 mb-1">
                  <div className="w-8 flex-shrink-0 text-xs text-slate-500 flex items-center">{day}</div>
                  {hours.map((h) => {
                    const count = heatmapMap[`${di}-${h}`] || 0;
                    const intensity = count / maxHeat;
                    const bg = intensity === 0 ? "bg-slate-100" : `bg-amber-200`;
                    return (
                      <div
                        key={h}
                        className={`flex-1 h-5 rounded-sm ${bg} transition-colors`}
                        title={`${day} ${h}:00 - ${count} 条响应`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
