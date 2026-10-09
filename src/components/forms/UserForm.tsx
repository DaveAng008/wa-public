"use client";

import { useState } from "react";
import { Save, Loader2 } from "lucide-react";
import { UserRole } from "@/contexts/AuthContext";

interface UserFormProps {
  initial?: { name?: string; email?: string; role?: UserRole; maxInstances?: number; kanbanEnabled?: boolean; automationsEnabled?: boolean };
  onSubmit: (data: { name: string; email: string; password: string; role: UserRole; maxInstances: number; kanbanEnabled: boolean; automationsEnabled: boolean }) => Promise<void>;
  loading?: boolean;
}

export function UserForm({ initial = {}, onSubmit, loading = false }: UserFormProps) {
  const [name, setName] = useState(initial.name || "");
  const [email, setEmail] = useState(initial.email || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>(initial.role || "operator");
  const [maxInstances, setMaxInstances] = useState<number>(initial.maxInstances || 1);
  const [kanbanEnabled, setKanbanEnabled] = useState<boolean>(initial.kanbanEnabled || false);
  const [automationsEnabled, setAutomationsEnabled] = useState<boolean>(initial.automationsEnabled || false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError("请输入用户名"); return; }
    if (!email.trim() || !email.includes("@")) { setError("请输入有效的邮箱地址"); return; }
    if (!password && !initial.email) { setError("请输入密码"); return; }
    setError("");
    await onSubmit({ 
      name: name.trim(), 
      email: email.trim(), 
      password, 
      role, 
      maxInstances: Math.max(1, parseInt(maxInstances as any) || 1),
      kanbanEnabled,
      automationsEnabled
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-xl text-sm">{error}</div>
      )}

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">用户名 *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="显示名称"
          className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">邮箱 *</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com"
          className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">
          密码 {initial.email && <span className="text-slate-400 font-normal text-xs">（留空则不修改）</span>}
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={initial.email ? "不修改请留空" : "初始密码"}
          className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">角色 *</label>
        <div className="flex gap-3">
          {(["operator", "admin"] as UserRole[]).map((r) => (
            <label
              key={r}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ${role === r ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
            >
              <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
              <span className="text-sm font-medium">{r === "admin" ? "管理员" : "操作员"}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">看板权限 *</label>
        <div className="flex gap-3">
          {([true, false] as boolean[]).map((val) => (
            <label
              key={String(val)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ${kanbanEnabled === val ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
            >
              <input type="radio" name="kanbanEnabled" value={String(val)} checked={kanbanEnabled === val} onChange={() => setKanbanEnabled(val)} className="sr-only" />
              <span className="text-sm font-medium">{val ? "已开启" : "已关闭"}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500 font-bold mt-1">控制该用户是否可以使用 CRM 看板功能</p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">自动规则权限 *</label>
        <div className="flex gap-3">
          {([true, false] as boolean[]).map((val) => (
            <label
              key={String(val)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ${automationsEnabled === val ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}
            >
              <input type="radio" name="automationsEnabled" value={String(val)} checked={automationsEnabled === val} onChange={() => setAutomationsEnabled(val)} className="sr-only" />
              <span className="text-sm font-medium">{val ? "已开启" : "已关闭"}</span>
            </label>
          ))}
        </div>
        <p className="text-xs text-slate-500 font-bold mt-1">控制该用户是否可以使用自动回复与AI规则功能</p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1.5">📱 WhatsApp 实例配额 *</label>
        <input
          type="number"
          min="1"
          value={maxInstances}
          onChange={(e) => setMaxInstances(parseInt(e.target.value) || 1)}
          className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
        <p className="text-xs text-slate-500 font-bold mt-1">此用户允许绑定的 WhatsApp 实例数量上限</p>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-slate-900 text-white px-6 py-3 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
        {loading ? "处理中..." : "保存"}
      </button>
    </form>
  );
}
