"use client";

import { AlertTriangle } from "lucide-react";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning" | "default";
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "确认",
  cancelText = "取消",
  variant = "default",
  loading = false,
}: ConfirmDialogProps) {
  const variantStyles = {
    danger: { btn: "bg-red-600 hover:bg-red-700 text-white", icon: "text-red-500", iconBg: "bg-red-50" },
    warning: { btn: "bg-amber-600 hover:bg-amber-700 text-white", icon: "text-amber-500", iconBg: "bg-amber-50" },
    default: { btn: "bg-slate-900 hover:bg-slate-800 text-white", icon: "text-slate-500", iconBg: "bg-slate-50" },
  };

  const style = variantStyles[variant];

  return (
    <Modal open={open} onClose={onClose} className="max-w-sm">
      <div className="flex flex-col items-center text-center">
        <div className={`p-3 rounded-full ${style.iconBg} mb-4`}>
          <AlertTriangle className={`w-6 h-6 ${style.icon}`} />
        </div>
        <h3 className="text-lg font-bold mb-2">{title}</h3>
        <p className="text-slate-500 text-sm mb-6">{description}</p>
        <div className="flex gap-3 w-full">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`flex-1 px-4 py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50 ${style.btn}`}
          >
            {loading ? "处理中..." : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
