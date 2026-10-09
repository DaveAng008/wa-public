"use client";

import { Loader2 } from "lucide-react";

interface LoadingSpinnerProps {
  size?: number;
  className?: string;
  text?: string;
}

export function LoadingSpinner({ size = 24, className = "", text }: LoadingSpinnerProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Loader2 className="animate-spin text-slate-400" style={{ width: size, height: size }} />
      {text && <span className="text-slate-500 text-sm">{text}</span>}
    </div>
  );
}

export function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-64">
      <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
    </div>
  );
}
