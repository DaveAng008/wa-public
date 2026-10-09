"use client";

export type CampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";

interface StatusBadgeProps {
  status: CampaignStatus | string;
  className?: string;
}

const config: Record<string, { label: string; bg: string; text: string }> = {
  DRAFT: { label: "草稿", bg: "bg-slate-100", text: "text-slate-600" },
  ACTIVE: { label: "进行中", bg: "bg-green-100", text: "text-green-700" },
  PAUSED: { label: "已暂停", bg: "bg-amber-100", text: "text-amber-700" },
  COMPLETED: { label: "已完成", bg: "bg-blue-100", text: "text-blue-700" },
  ONLINE: { label: "在线", bg: "bg-green-100", text: "text-green-700" },
  OFFLINE: { label: "离线", bg: "bg-red-100", text: "text-red-700" },
};

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const { label, bg, text } = config[status] ?? config.DRAFT;
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border border-current opacity-90 ${bg} ${text} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${text.replace("text-", "bg-")}`} />
      {label}
    </span>
  );
}
