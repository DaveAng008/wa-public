"use client";

import { useAuth } from "@/contexts/AuthContext";
import { LogOut, User, Menu } from "lucide-react";

interface TopBarProps {
  title?: string;
  onMenuToggle?: () => void;
}

export function TopBar({ title, onMenuToggle }: TopBarProps) {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-20 h-16 bg-white/95 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-4 md:px-6 flex-shrink-0 shadow-xs">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="p-2 rounded-xl text-slate-700 bg-slate-100/80 hover:bg-slate-200/80 transition-colors md:hidden active:scale-95"
          title="打开菜单"
        >
          <Menu className="w-5 h-5" />
        </button>
        {title && <h2 className="text-base md:text-lg font-bold text-slate-800 truncate">{title}</h2>}
      </div>
      <div className="flex items-center gap-3 md:gap-4">
        {user && (
          <div className="flex items-center gap-2 md:gap-3">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-8 h-8 bg-blue-50 border border-blue-200/60 rounded-full flex items-center justify-center text-blue-600 font-black flex-shrink-0">
                <User className="w-4 h-4" />
              </div>
              <div className="text-right flex flex-col justify-center min-w-0">
                <div className="font-black text-slate-800 text-xs sm:text-sm leading-tight truncate max-w-[110px] sm:max-w-[160px]">
                  {user.name}
                </div>
                <div className="text-[10px] text-blue-600 font-black leading-none mt-0.5 capitalize">
                  {user.role === "admin" ? "管理员" : "操作员"}
                </div>
              </div>
            </div>
            <button
              onClick={logout}
              className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors active:scale-95 ml-0.5"
              title="登出"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
