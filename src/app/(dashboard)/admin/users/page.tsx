"use client";

import { useEffect, useState } from "react";
import { Plus, Loader2, Shield } from "lucide-react";
import { usersApi, SystemUser } from "@/lib/api";
import { DataTable, Column } from "@/components/ui/DataTable";
import { UserForm } from "@/components/forms/UserForm";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { PageLoading } from "@/components/ui/LoadingSpinner";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<SystemUser | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser && currentUser.role !== "admin") {
      router.push("/");
      return;
    }
    fetchUsers();
  }, [currentUser, router]);

  const fetchUsers = async () => {
    try { setUsers(await usersApi.list()); }
    catch { setUsers([]); }
    finally { setLoading(false); }
  };

  const handleAdd = async (data: any) => {
    await usersApi.create(data);
    setShowAdd(false);
    fetchUsers();
  };

  const handleEdit = async (data: any) => {
    if (!editUser) return;
    await usersApi.update(editUser.id, data);
    setEditUser(null);
    fetchUsers();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try { await usersApi.delete(deleteId); setUsers((prev) => prev.filter((u) => u.id !== deleteId)); }
    catch {} finally { setDeleteId(null); }
  };

  const columns: Column<SystemUser>[] = [
    { key: "name", header: "姓名", sortable: true },
    { key: "email", header: "邮箱" },
    {
      key: "role",
      header: "角色",
      render: (row) => (
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${row.role === "admin" ? "bg-purple-50 text-purple-600" : "bg-blue-50 text-blue-600"}`}>
          {row.role === "admin" ? "管理员" : "操作员"}
        </span>
      ),
    },
    {
      key: "kanbanEnabled",
      header: "看板权限",
      render: (row) => (
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${row.kanbanEnabled ? "bg-green-50 text-green-600" : "bg-slate-50 text-slate-500"}`}>
          {row.kanbanEnabled ? "已启用" : "已禁用"}
        </span>
      ),
    },
    {
      key: "automationsEnabled",
      header: "自动规则权限",
      render: (row) => (
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${row.automationsEnabled ? "bg-green-50 text-green-600" : "bg-slate-50 text-slate-500"}`}>
          {row.automationsEnabled ? "已启用" : "已禁用"}
        </span>
      ),
    },
    {
      key: "maxInstances",
      header: "WhatsApp 配额",
      render: (row) => (
        <span className="font-bold text-slate-700 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 text-xs">
          {row.maxInstances || 1} 个实例
        </span>
      ),
    },
    { key: "createdAt", header: "创建时间", render: (row) => new Date(row.createdAt).toLocaleString("zh-CN") },
    {
      key: "actions",
      header: "",
      width: "100px",
      render: (row) => (
        <div className="flex gap-1 justify-end">
          <button
            onClick={() => setEditUser(row)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
          >
            编辑角色
          </button>
          {row.id !== currentUser?.id && (
            <button
              onClick={() => setDeleteId(row.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
            >
              删除
            </button>
          )}
        </div>
      ),
    },
  ];

  if (loading) return <PageLoading />;

  return (
    <div className="space-y-6 pb-16">
      <header className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-slate-950">用户管理</h1>
          <p className="text-xs md:text-sm font-bold text-slate-500 mt-1">管理系统用户与权限</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto">
          <button
            onClick={async () => {
              if (confirm("确认运行系统补丁？这可能会更新数据库结构。")) {
                const res = await fetch("/api/patch-db");
                const data = await res.json();
                alert(JSON.stringify(data, null, 2));
              }
            }}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 bg-white border-2 border-slate-200 text-slate-700 rounded-xl text-xs font-black hover:bg-slate-50 transition-colors shadow-sm"
          >
            <Shield className="w-4 h-4" /> 运行系统补丁
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-950 text-white rounded-xl text-xs font-black hover:bg-slate-800 transition-colors shadow-xl"
          >
            <Plus className="w-4 h-4" /> 添加用户
          </button>
        </div>
      </header>

      {/* Admin note */}
      <div className="bg-purple-50 border-2 border-purple-100 rounded-2xl p-4 flex items-center gap-3">
        <Shield className="w-5 h-5 text-purple-600 flex-shrink-0" />
        <p className="text-xs sm:text-sm font-black text-purple-700">仅管理员可以访问此页面并管理系统用户。</p>
      </div>

      {/* 移动端卡片流列表 (md以下屏幕可见) */}
      <div className="block md:hidden divide-y divide-slate-100 bg-white rounded-2xl border-2 border-slate-200 shadow-sm overflow-hidden">
        {users.length === 0 ? (
          <div className="px-4 py-12 text-center text-slate-400 text-sm font-bold">
            暂无数据
          </div>
        ) : (
          users.map((row) => (
            <div key={row.id} className="p-4 flex flex-col gap-2 bg-white">
              <div className="flex justify-between items-center">
                <span className="font-black text-slate-900 text-base">{row.name}</span>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black ${row.role === "admin" ? "bg-purple-50 text-purple-600 border border-purple-100" : "bg-blue-50 text-blue-600 border border-blue-100"}`}>
                  {row.role === "admin" ? "管理员" : "操作员"}
                </span>
              </div>
              <div className="flex flex-col gap-1 text-xs text-slate-500 font-bold pl-0.5">
                <div className="truncate">📧 {row.email}</div>
                <div>📱 实例配额: {row.maxInstances || 1} 个</div>
                <div>📊 看板权限: {row.kanbanEnabled ? "✅ 已启用" : "❌ 已禁用"}</div>
                <div>🤖 自动规则权限: {row.automationsEnabled ? "✅ 已启用" : "❌ 已禁用"}</div>
                <div>📅 {new Date(row.createdAt).toLocaleString("zh-CN")}</div>
              </div>
              <div className="flex gap-2 justify-end mt-2 pt-2 border-t border-slate-50">
                <button
                  onClick={() => setEditUser(row)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all border border-slate-200"
                >
                  编辑角色
                </button>
                {row.id !== currentUser?.id && (
                  <button
                    onClick={() => setDeleteId(row.id)}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-red-50 text-red-600 hover:bg-red-100 transition-all border border-red-100"
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 桌面端表格 (md及以上屏幕可见) */}
      <div className="hidden md:block">
        <DataTable columns={columns} data={users} pageSize={20} />
      </div>

      {/* Add Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="添加用户">
        <UserForm onSubmit={handleAdd} />
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title="编辑用户角色">
        {editUser && (
          <UserForm
            initial={{ name: editUser.name, email: editUser.email, role: editUser.role, maxInstances: editUser.maxInstances, kanbanEnabled: editUser.kanbanEnabled, automationsEnabled: editUser.automationsEnabled }}
            onSubmit={handleEdit}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="确认删除用户"
        description="删除后该用户将无法登录，确定继续？"
        confirmText="删除"
        variant="danger"
      />
    </div>
  );
}
