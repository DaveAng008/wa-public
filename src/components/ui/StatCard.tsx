"use client";

import { LucideIcon, ArrowUpRight, ArrowDownRight } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendDirection?: "up" | "down" | "neutral";
  trendColor?: string;
  className?: string;
  sparklineData?: number[];
}

function generateSparklinePaths(data: number[], width: number, height: number) {
  if (data.length < 2) return { linePath: "", areaPath: "" };
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min === 0 ? 1 : max - min;
  
  const points = data.map((val, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 8) - 4;
    return { x, y };
  });

  const linePath = points.reduce((acc, p, i) => {
    return i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, "");

  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  return { linePath, areaPath };
}

export function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  trendDirection = "neutral",
  trendColor,
  className = "",
  sparklineData,
}: StatCardProps) {
  const colorMap: Record<string, string> = {
    up: "text-green-500",
    down: "text-red-500",
    neutral: "text-slate-500",
  };

  const TrendIcon = trendDirection === "up" ? ArrowUpRight : trendDirection === "down" ? ArrowDownRight : null;

  const width = 110;
  const height = 44;
  const paths = sparklineData ? generateSparklinePaths(sparklineData, width, height) : null;

  const isToday = title.includes("今日");
  const isTotal = title.includes("总");
  const isActive = title.includes("活跃");

  let themeColor = "bg-orange-100 text-orange-700";
  let textColor = "text-orange-600";
  let strokeColor = "#f97316"; 
  let gradientId = "gradient-orange";
  let stopColor = "rgba(249, 115, 22, 0.2)";

  if (isToday) {
    themeColor = "bg-blue-100 text-blue-700";
    textColor = "text-blue-600";
    strokeColor = "#3b82f6"; 
    gradientId = "gradient-blue";
    stopColor = "rgba(59, 130, 246, 0.2)";
  } else if (isTotal) {
    themeColor = "bg-purple-100 text-purple-700";
    textColor = "text-purple-600";
    strokeColor = "#a855f7"; 
    gradientId = "gradient-purple";
    stopColor = "rgba(168, 85, 247, 0.2)";
  } else if (isActive) {
    themeColor = "bg-emerald-100 text-emerald-700";
    textColor = "text-emerald-600";
    strokeColor = "#10b981"; 
    gradientId = "gradient-emerald";
    stopColor = "rgba(16, 185, 129, 0.2)";
  }

  return (
    <div
      className={`bg-white p-7 rounded-[2rem] shadow-sm border-2 border-slate-100 flex flex-col relative overflow-hidden group md:hover:shadow-lg transition-all duration-300 ${className}`}
    >
      <div className="flex justify-between items-start mb-6">
        <div className={`p-4 rounded-2xl transition-colors ${themeColor}`}>
          <Icon className="w-6 h-6" />
        </div>
        {trend && (
          <div className={`flex items-center text-xs font-black px-2 py-1 rounded-lg ${trendColor || colorMap[trendDirection]} ${trendDirection === 'up' ? 'bg-green-50' : 'bg-red-50'}`}>
            {TrendIcon && <TrendIcon className="w-3.5 h-3.5 mr-0.5" />}
            {trend}
          </div>
        )}
      </div>
      <div className="flex justify-between items-end relative z-10">
        <div className="flex-1 min-w-0">
          <h3 className="text-slate-900 text-xs font-black uppercase tracking-wider mb-1">{title}</h3>
          <p className={`text-5xl font-black tracking-tighter ${textColor}`}>{value}</p>
        </div>

        {paths && (
          <div className="w-[110px] h-[44px] shrink-0 opacity-80 group-hover:opacity-100 transition-opacity duration-300 mb-1">
            <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stopColor} />
                  <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
                </linearGradient>
              </defs>
              <path
                d={paths.areaPath}
                fill={`url(#${gradientId})`}
              />
              <path
                d={paths.linePath}
                fill="none"
                stroke={strokeColor}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        )}
      </div>
      <div className="absolute -right-4 -bottom-4 w-32 h-32 bg-slate-50/50 rounded-full md:group-hover:scale-110 transition-transform duration-700 ease-out -z-0" />
    </div>
  );
}
