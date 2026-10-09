"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { PageLoading } from "@/components/ui/LoadingSpinner";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login");
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <PageLoading />
      </div>
    );
  }

  if (!user) return null;

  const sidebarWidth = collapsed ? "md:pl-16" : "md:pl-64";

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 移动端侧边栏背景遮罩层 */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-slate-950/40 backdrop-blur-[2px] z-30 md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={setCollapsed}
        isMobileOpen={isMobileOpen}
        onMobileClose={() => setIsMobileOpen(false)}
      />
      <div className={`flex flex-col min-h-screen transition-all duration-300 pl-0 ${sidebarWidth}`}>
        <TopBar onMenuToggle={() => setIsMobileOpen(true)} />
        <main className="flex-1 p-4 md:p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}