"use client";

import { useEffect, useState } from "react";
import { Send, CheckCircle2, XCircle, Clock } from "lucide-react";

interface SendProgressProps {
  total: number;
  sent: number;
  failed?: number;
  responded?: number;
  remaining: number;
  isRunning?: boolean;
}

export function SendProgress({ total, sent, failed = 0, responded = 0, remaining, isRunning = true }: SendProgressProps) {
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    if (total === 0) return;
    const target = Math.round((sent / total) * 100);
    let frame: number;
    const step = () => {
      setAnimated((prev) => {
        if (prev < target) { frame = requestAnimationFrame(step); return Math.min(prev + 2, target); }
        return target;
      });
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [sent, total]);

  const pct = total > 0 ? Math.round((sent / total) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800 flex items-center gap-2">
          {isRunning ? (
            <><Send className="w-4 h-4 text-blue-500 animate-pulse" /> 发送进度</>
          ) : (
            <><CheckCircle2 className="w-4 h-4 text-green-500" /> 发送完成</>
          )}
        </h3>
        <span className="text-sm font-semibold text-slate-700">{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-3 bg-slate-100 rounded-full overflow-hidden mb-4">
        <div
          className={`h-full rounded-full transition-all duration-500 ${isRunning ? "bg-blue-500" : "bg-green-500"}`}
          style={{ width: `${animated}%` }}
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <StatBox icon={<Send className="w-4 h-4" />} label="已发送" value={sent} color="text-blue-600" bg="bg-blue-50" />
        <StatBox icon={<CheckCircle2 className="w-4 h-4" />} label="成功" value={sent - failed} color="text-green-600" bg="bg-green-50" />
        <StatBox icon={<XCircle className="w-4 h-4" />} label="失败" value={failed} color="text-red-600" bg="bg-red-50" />
        <StatBox icon={<Clock className="w-4 h-4" />} label="剩余" value={remaining} color="text-slate-600" bg="bg-slate-50" />
      </div>
    </div>
  );
}

function StatBox({ icon, label, value, color, bg }: { icon: React.ReactNode; label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-3 text-center`}>
      <div className={`${color} font-bold text-lg`}>{value}</div>
      <div className="flex items-center justify-center gap-1 text-xs text-slate-500 mt-1">
        {icon} {label}
      </div>
    </div>
  );
}
