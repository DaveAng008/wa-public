"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useAuth } from "@/contexts/AuthContext";
import {
  LayoutDashboard,
  Settings,
  Users,
  Send,
  Activity,
  BarChart3,
  Shield,
  Bell,
  ChevronLeft,
  Menu,
  BookImage,
  LogOut,
  User as UserIcon,
  Columns,
  Cpu,
} from "lucide-react";
import { APP_NAME, APP_NAME_SUFFIX } from "@/lib/brand";

interface NavItem {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  path: string;
  adminOnly?: boolean;
}

const menuItems: NavItem[] = [
  { name: "仪表盘", icon: LayoutDashboard, path: "/" },
  { name: "CRM 看板", icon: Columns, path: "/kanban" },
  { name: "自动规则", icon: Cpu, path: "/automations" },
  { name: "活动管理", icon: Send, path: "/campaigns" },
  { name: "联系人", icon: Users, path: "/contacts" },
  { name: "黑名单", icon: Bell, path: "/blacklist" },
  { name: "数据报表", icon: BarChart3, path: "/reports" },
  { name: "素材库", icon: BookImage, path: "/materials" },
  { name: "系统设置", icon: Settings, path: "/settings" },
  { name: "用户管理", icon: Shield, path: "/admin/users", adminOnly: true },
];

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: (collapsed: boolean) => void;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ collapsed, onToggleCollapse, isMobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const role = user?.role || "operator";

  const visibleItems = menuItems.filter((item) => {
    if (item.adminOnly && role !== "admin") return false;
    if (item.path === "/kanban" && !user?.kanbanEnabled) return false;
    if (item.path === "/automations" && role !== "admin" && !user?.automationsEnabled) return false;
    return true;
  });

  return (
    <aside
      className={`fixed top-0 left-0 h-screen bg-slate-900 text-white flex flex-col z-40 transition-all duration-300 md:translate-x-0 ${
        collapsed ? "w-16" : "w-64"
      } ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-6 border-b border-slate-800">
        <Activity className="w-7 h-7 text-green-400 flex-shrink-0" />
        {(!collapsed || isMobileOpen) && (
          <div className="overflow-hidden">
            <h1 className="text-base font-bold tracking-wide whitespace-nowrap">{APP_NAME}</h1>
            <span className="text-[10px] text-green-400 tracking-wider">{APP_NAME_SUFFIX.toUpperCase()}</span>
          </div>
        )}
        {/* 电脑端折叠按钮 */}
        <button
          onClick={() => onToggleCollapse(!collapsed)}
          className="ml-auto p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors hidden md:block"
        >
          {collapsed ? <Menu className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
        {/* 移动端收起按钮 */}
        <button
          onClick={onMobileClose}
          className="ml-auto p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors md:hidden block"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        <ul className="flex flex-col gap-1 px-3">
          {visibleItems.map((item) => {
            const isActive = pathname === item.path || (item.path !== "/" && pathname.startsWith(item.path));
            const Icon = item.icon;
            return (
              <li key={item.path}>
                <Link
                  href={item.path}
                  onClick={onMobileClose}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
                    isActive
                      ? "bg-slate-800 text-green-400 font-medium"
                      : "text-slate-400 hover:text-white hover:bg-slate-800/50"
                  }`}
                  title={collapsed ? item.name : undefined}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {(!collapsed || isMobileOpen) && <span className="text-sm whitespace-nowrap">{item.name}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User Card & Logout */}
      <div className="mt-auto px-3 py-4 border-t border-slate-800 bg-slate-900/80">
        <div className={`flex items-center gap-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700 ${(collapsed && !isMobileOpen) ? "justify-center" : ""}`}>
          <div className="w-10 h-10 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 flex-shrink-0 shadow-inner">
            <UserIcon className="w-5 h-5" />
          </div>
          
          {(!collapsed || isMobileOpen) && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{user?.name || "未知用户"}</p>
              <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">{role}</p>
            </div>
          )}
        </div>

        <button
          onClick={() => {
            if (onMobileClose) onMobileClose();
            signOut({ callbackUrl: "/login" });
          }}
          className={`mt-3 flex items-center gap-3 w-full px-4 py-3 rounded-xl text-red-400 hover:text-white hover:bg-red-500 transition-all font-black shadow-lg ${(collapsed && !isMobileOpen) ? "justify-center" : ""}`}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {(!collapsed || isMobileOpen) && <span className="text-sm">退出登录</span>}
        </button>
      </div>

      {/* Collapse toggle (Alternative placement) */}
      <div className="px-3 py-2 mb-2 hidden md:block">
        <button
          onClick={() => onToggleCollapse(!collapsed)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-slate-500 hover:text-slate-300 transition-colors"
        >
          <ChevronLeft className={`w-4 h-4 flex-shrink-0 transition-transform ${collapsed ? "rotate-180" : ""}`} />
          {!collapsed && <span className="text-xs">隐藏侧边栏</span>}
        </button>
      </div>
    </aside>
  );
}