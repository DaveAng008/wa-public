"use client";

import { Campaign } from "@/lib/api";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Play, Pause, Edit, Trash2, Users, Send, Clock, Database, ShieldCheck, RefreshCcw, BookImage } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useState } from "react";

interface CampaignCardProps {
  campaign: Campaign;
  onEdit?: (c: Campaign) => void;
  onToggleStatus?: (c: Campaign) => void;
  onDelete?: (id: string) => void;
  onSend?: (c: Campaign) => void;
  isAdmin?: boolean;
}

export function CampaignCard({ campaign, onEdit, onToggleStatus, onDelete, onSend, isAdmin = false }: CampaignCardProps) {
  const [showDelete, setShowDelete] = useState(false);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  let sc: any = null;
  if (campaign.scheduleConfig) {
    try {
      sc = typeof campaign.scheduleConfig === 'string' ? JSON.parse(campaign.scheduleConfig) : campaign.scheduleConfig;
    } catch (e) {}
  }

  const triggerType = sc?.triggerType || "MANUAL";
  const typeConfig: Record<string, { border: string; bg: string; label: string; icon: string }> = {
    MANUAL: {
      border: "border-t-blue-500",
      bg: "bg-blue-50 border-blue-100 text-blue-700",
      label: "手动触发 / 批量群发",
      icon: "🖱️"
    },
    SCHEDULED: {
      border: "border-t-emerald-500",
      bg: "bg-emerald-50 border-emerald-100 text-emerald-700",
      label: "定时周期触发",
      icon: "📅"
    },
    BIRTHDAY: {
      border: "border-t-rose-500",
      bg: "bg-rose-50 border-rose-100 text-rose-700",
      label: "生日自动触发",
      icon: "🎂"
    },
    DATE_ATTRIBUTE: {
      border: "border-t-indigo-500",
      bg: "bg-indigo-50 border-indigo-100 text-indigo-700",
      label: "日期属性触发",
      icon: "⏰"
    },
    COLUMN_ENTER: {
      border: "border-t-amber-500",
      bg: "bg-amber-50 border-amber-100 text-amber-700",
      label: "看板流转：移入触发",
      icon: "🎛️"
    },
    COLUMN_TIMEOUT: {
      border: "border-t-amber-500",
      bg: "bg-amber-50 border-amber-100 text-amber-700",
      label: "看板流转：超时触发",
      icon: "⏳"
    }
  };
  const currentType = typeConfig[triggerType] || typeConfig.MANUAL;

  const materials: any[] = (campaign as any).materials || [];

  return (
    <>
      <div className={`bg-white rounded-3xl shadow-sm border-2 border-slate-100 border-t-4 ${currentType.border} p-6 hover:shadow-lg transition-all duration-300 flex flex-col h-full`}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0 pr-3">
            <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-black border ${currentType.bg} mb-2.5`}>
              <span>{currentType.icon}</span>
              <span>{currentType.label}</span>
            </span>
            <h3 className="font-black text-xl text-slate-950 truncate leading-tight">{campaign.name}</h3>
            {campaign.description && (
              <p className="text-sm text-slate-500 font-bold mt-1 line-clamp-1 leading-relaxed">{campaign.description}</p>
            )}
          </div>
          <StatusBadge status={campaign.status} className="flex-shrink-0" />
        </div>

        <div className="flex items-center gap-3 text-xs font-black text-slate-600 mb-4 bg-slate-50 p-2.5 rounded-xl w-fit border border-slate-100">
          <span className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-blue-600" />
            {campaign.contactCount} 位联系人
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-500">{formatDate(campaign.updatedAt || campaign.createdAt)}</span>
        </div>

        {materials.length > 0 && (
          <div className="mb-3 bg-slate-50 rounded-lg p-2 border border-slate-100">
            <div className="space-y-0.5">
              {materials.slice(0, 2).map((m: any) => (
                <div key={m.id} className="text-[9px] text-slate-600 font-medium line-clamp-1">
                  <span className="font-black text-blue-600 mr-1">[{m.type}]</span>
                  {m.type === "TEXT" ? m.content : m.url}
                </div>
              ))}
              {materials.length > 2 && (
                <div className="text-[9px] text-slate-400 font-bold italic pt-0.5">
                  + 还有 {materials.length - 2} 个素材...
                </div>
              )}
            </div>
          </div>
        )}

        {sc && (
          <div className="mb-4 pt-3 border-t border-dashed border-slate-200">
            <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-bold">
              {sc.scheduledTime && (
                <span className="px-1.5 py-0.5 bg-blue-50 border border-blue-100 text-blue-600 rounded flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" /> 定时: {sc.scheduledTime}
                </span>
              )}
              <span className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-slate-600">
                每次: {sc.batchSize || 0}人
              </span>
              <span className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-slate-600">
                共: {sc.totalRuns || 0}轮
              </span>
              <span className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-slate-600">
                频率: {sc.frequencyValue || 0}{sc.frequencyUnit === 'days' ? '天' : '时'}
              </span>
              <span className="px-1.5 py-0.5 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded flex items-center gap-1">
                <ShieldCheck className="w-2.5 h-2.5" /> {sc.safeWindowStart || "00:00"}-{sc.safeWindowEnd || "23:59"}
              </span>
              {sc.isRepeating && (
                <span className="px-1.5 py-0.5 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded flex items-center gap-1">
                  <RefreshCcw className="w-2.5 h-2.5" /> 循环
                </span>
              )}
            </div>
            
            {campaign.contactCount > 0 && sc.batchSize > 0 && (
              <p className="text-[9px] text-slate-400 mt-2 flex items-center gap-1 font-medium bg-slate-50 px-2 py-1 rounded">
                <Database className="w-2.5 h-2.5 flex-shrink-0 text-slate-400" />
                共 {campaign.contactCount} 人：前 {Math.floor(campaign.contactCount / sc.batchSize)} 轮满额
                {campaign.contactCount % sc.batchSize > 0 && `，末轮补足 ${campaign.contactCount % sc.batchSize} 人`}
              </p>
            )}
          </div>
        )}

        <div className="mt-auto pt-4 flex flex-wrap gap-2">
          {onToggleStatus && (
            <button
              onClick={() => onToggleStatus(campaign)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors flex-1 justify-center ${
                campaign.status === "ACTIVE"
                  ? "bg-amber-50 text-amber-600 hover:bg-amber-100"
                  : "bg-green-50 text-green-600 hover:bg-green-100"
              }`}
            >
              {campaign.status === "ACTIVE" ? (
                <><Pause className="w-4 h-4" /> 暂停</>
              ) : (
                <><Play className="w-4 h-4" /> 启动</>
              )}
            </button>
          )}
          {onSend && (
            <button
              onClick={() => onSend(campaign)}
              disabled={campaign.status !== "ACTIVE"}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors flex-1 justify-center disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-blue-100"
            >
              <Send className="w-4 h-4" /> 立即发送
            </button>
          )}
          {onEdit && (
            <button
              onClick={() => onEdit(campaign)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <Edit className="w-4 h-4" /> 编辑
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => setShowDelete(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={() => { onDelete?.(campaign.id); setShowDelete(false); }}
        title="确认删除"
        description={`确定要删除活动「${campaign.name}」吗？此操作不可恢复。`}
        confirmText="删除"
        variant="danger"
      />
    </>
  );
}

