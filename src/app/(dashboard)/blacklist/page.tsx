"use client";

import { useEffect, useState } from "react";
import { Ban, Plus, Trash2, Loader2, Phone, Check, ArrowUpLeft } from "lucide-react";
import { blacklistApi, BlacklistEntry } from "@/lib/api";
import { DataTable, Column } from "@/components/ui/DataTable";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Modal } from "@/components/ui/Modal";
import { PageLoading } from "@/components/ui/LoadingSpinner";
import { useAuth } from "@/contexts/AuthContext";

export default function BlacklistPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 多选与批量操作状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [showBatchConfirm, setShowBatchConfirm] = useState<{ type: 'restore' | 'delete' } | null>(null);

  // 单行操作状态
  const [singleActionTarget, setSingleActionTarget] = useState<{ id: string; phone: string; type: 'restore' | 'delete' } | null>(null);

  const fetchEntries = async () => {
    try { setEntries(await blacklistApi.list()); }
    catch { setEntries([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchEntries(); }, []);

  const handleAdd = async () => {
    if (!phone.trim()) return;
    setSubmitting(true);
    try {
      await blacklistApi.add(phone.trim(), reason.trim(), name.trim());
      setShowAdd(false); setPhone(""); setName(""); setReason("");
      fetchEntries();
    } catch {} finally { setSubmitting(false); }
  };

  const handleBatchAction = async () => {
    if (selectedIds.size === 0 || !showBatchConfirm) return;
    setIsProcessing(true);
    const idsArray = Array.from(selectedIds);
    try {
      if (showBatchConfirm.type === 'restore') {
        await blacklistApi.deleteBatch(idsArray, false);
        alert(`✓ 成功将 ${idsArray.length} 个号码移出黑名单！`);
      } else {
        await blacklistApi.deleteBatch(idsArray, true);
        alert(`✓ 成功将 ${idsArray.length} 个号码永久彻底删除！`);
      }
      setSelectedIds(new Set());
      setShowBatchConfirm(null);
      await fetchEntries();
    } catch (err: any) {
      alert("操作失败: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSingleAction = async () => {
    if (!singleActionTarget) return;
    try {
      if (singleActionTarget.type === 'restore') {
        await blacklistApi.deleteBatch([singleActionTarget.id], false);
        alert("✓ 号码已移出黑名单！");
      } else {
        await blacklistApi.deleteBatch([singleActionTarget.id], true);
        alert("✓ 号码已永久彻底删除！");
      }
      setSingleActionTarget(null);
      await fetchEntries();
    } catch (err: any) {
      alert("操作失败: " + err.message);
    }
  };

  const columns: Column<BlacklistEntry>[] = [
    {
      key: "selection",
      header: (
        <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => {
              const allOnPageSelected = entries.length > 0 && entries.every(e => selectedIds.has(e.id));
              if (allOnPageSelected) {
                setSelectedIds(new Set());
              } else {
                setSelectedIds(new Set(entries.map(e => e.id)));
              }
            }}
            className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
              entries.length > 0 && entries.every(e => selectedIds.has(e.id))
                ? "bg-red-600 border-red-600"
                : "border-slate-300 bg-white"
            }`}
          >
            {entries.length > 0 && entries.every(e => selectedIds.has(e.id)) && <Check className="w-3.5 h-3.5 text-white" />}
          </button>
        </div>
      ),
      width: "60px",
      render: (row) => {
        const isSelected = selectedIds.has(row.id);
        return (
          <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={() => {
                const next = new Set(selectedIds);
                if (isSelected) next.delete(row.id);
                else next.add(row.id);
                setSelectedIds(next);
              }}
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${isSelected ? "bg-red-600 border-red-600" : "border-slate-300 bg-white"}`}
            >
              {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
            </button>
          </div>
        );
      }
    },
    { key: "phone", header: "号码", render: (row) => <span className="font-mono text-sm">{row.phone}</span> },
    { key: "name", header: "姓名/名称", render: (row) => <span>{row.name || "—"}</span> },
    { key: "reason", header: "原因" },
    { key: "addedBy", header: "添加人", render: (row) => <span>{row.addedBy?.name || "—"}</span> },
    { key: "createdAt", header: "时间", render: (row) => new Date(row.createdAt).toLocaleString("zh-CN") },
    {
      key: "actions",
      header: "操作",
      width: "100px",
      render: (row: BlacklistEntry) => (
        <div className="flex gap-2 justify-center" onClick={(e) => e.stopPropagation()}>
          <button 
            onClick={() => setSingleActionTarget({ id: row.id, phone: row.phone, type: 'restore' })} 
            className="p-1.5 rounded-lg text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 transition-colors"
            title="移出黑名单并恢复为联系人"
          >
            <ArrowUpLeft className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setSingleActionTarget({ id: row.id, phone: row.phone, type: 'delete' })} 
            className="p-1.5 rounded-lg text-red-500 hover:text-red-700 hover:bg-red-50 transition-colors"
            title="从黑名单和联系人中永久彻底删除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  if (loading) return <PageLoading />;

  return (
    <div className="space-y-6 pb-16">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">黑名单</h1>
          <p className="text-slate-500 mt-1">已屏蔽的联系人，不会收到任何消息</p>
        </div>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <>
              <button 
                onClick={() => setShowBatchConfirm({ type: 'restore' })}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-black transition-colors cursor-pointer"
              >
                移出黑名单 ({selectedIds.size})
              </button>
              <button 
                onClick={() => setShowBatchConfirm({ type: 'delete' })}
                disabled={isProcessing}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-xl text-xs font-black transition-colors cursor-pointer"
              >
                批量永久删除 ({selectedIds.size})
              </button>
            </>
          )}
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm font-medium hover:bg-slate-800 transition-colors">
            <Plus className="w-4 h-4" /> 添加
          </button>
        </div>
      </header>

      <DataTable columns={columns} data={entries} pageSize={20} />

      {/* Add Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="加入黑名单">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">电话号码 *</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+65 xxxx xxxx"
                className="w-full pl-10 border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">姓名/名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="输入名称或备注姓名"
              className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">原因</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例如：用户主动退订"
              className="w-full border border-slate-300 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={submitting || !phone.trim()}
            className="w-full bg-slate-900 text-white py-3 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Ban className="w-5 h-5" />}
            {submitting ? "添加中..." : "加入黑名单"}
          </button>
        </div>
      </Modal>

      {/* Batch Action Confirm Dialog */}
      <ConfirmDialog
        open={!!showBatchConfirm}
        onClose={() => setShowBatchConfirm(null)}
        onConfirm={handleBatchAction}
        title={showBatchConfirm?.type === 'restore' ? "确认批量移出黑名单" : "确认批量永久删除"}
        description={
          showBatchConfirm?.type === 'restore'
            ? `确定要将选中的 ${selectedIds.size} 个号码移出黑名单吗？移出后他们将重新出现在联系人主列表中。`
            : `⚠️ 确定要将选中的 ${selectedIds.size} 个联系人从黑名单和系统联系人库中永久彻底删除吗？此操作无法恢复！`
        }
        confirmText={
          isProcessing
            ? "正在处理..."
            : showBatchConfirm?.type === 'restore'
            ? "确定移出"
            : "确定永久删除"
        }
        variant={showBatchConfirm?.type === 'restore' ? "default" : "danger"}
      />

      {/* Single Action Confirm Dialog */}
      <ConfirmDialog
        open={!!singleActionTarget}
        onClose={() => setSingleActionTarget(null)}
        onConfirm={handleSingleAction}
        title={singleActionTarget?.type === 'restore' ? "移出黑名单" : "确认永久删除"}
        description={
          singleActionTarget?.type === 'restore'
            ? `确定要将号码 ${singleActionTarget?.phone} 移出黑名单吗？移出后该号码将重新出现在联系人列表中。`
            : `⚠️ 确定要将号码 ${singleActionTarget?.phone} 从黑名单和系统联系人库中永久彻底删除吗？该操作不可恢复！`
        }
        confirmText="确定"
        variant={singleActionTarget?.type === 'restore' ? "default" : "danger"}
      />
    </div>
  );
}
