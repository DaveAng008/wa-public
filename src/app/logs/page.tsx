"use client";

import { 
    Send, 
    CheckCircle2, 
    XCircle, 
    Info, 
    AlertCircle, 
    Trash2, 
    RefreshCw, 
    Loader2,
    Search,
    ChevronRight,
    Activity
} from "lucide-react";
import { useState, useEffect } from "react";

type LogEntry = {
    id: string;
    time: string;
    level: 'info' | 'success' | 'error' | 'warning';
    message: string;
    detail?: string;
};

export default function LogsPage() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");

    const fetchLogs = async (isManual = false) => {
        if (isManual) setRefreshing(true);
        try {
            const res = await fetch('/api/logs');
            if (res.ok) {
                const data = await res.json();
                setLogs(data);
            }
        } catch (err) {
            console.error("Failed to fetch logs:", err);
        }
        setLoading(false);
        setRefreshing(false);
    };

    useEffect(() => {
        fetchLogs();
    }, []);

    const handleClearLogs = async () => {
        if (!confirm("确定要清空所有日志记录吗？")) return;
        setClearing(true);
        try {
            await fetch('/api/logs', { method: 'DELETE' });
            setLogs([]);
        } catch (err) {
            alert("清空失败");
        }
        setClearing(false);
    };

    const getIcon = (level: string) => {
        switch (level) {
            case 'success': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
            case 'error': return <XCircle className="w-5 h-5 text-rose-500" />;
            case 'warning': return <AlertCircle className="w-5 h-5 text-amber-500" />;
            default: return <Info className="w-5 h-5 text-blue-500" />;
        }
    };

    const getBgColor = (level: string) => {
        switch (level) {
            case 'success': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
            case 'error': return 'bg-rose-50 text-rose-700 border-rose-100';
            case 'warning': return 'bg-amber-50 text-amber-700 border-amber-100';
            default: return 'bg-blue-50 text-blue-700 border-blue-100';
        }
    };

    const formatTime = (iso: string) => {
        try {
            const date = new Date(iso);
            return date.toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch (e) { return iso; }
    };

    const filteredLogs = logs.filter(log => 
        log.message?.toLowerCase().includes(searchTerm.toLowerCase()) || 
        log.detail?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (loading) return <div className="p-8 flex items-center text-slate-500 gap-2 font-medium"><Loader2 className="w-5 h-5 animate-spin" /> 正在加载日志数据...</div>;

    return (
        <div className="space-y-6 max-w-6xl pb-16">
            <header className="flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">发送日志 (Operation Logs)</h1>
                    <p className="text-slate-500 mt-2 font-medium text-sm">监控任务触发及 WhatsApp 发送的每一个细节。</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => fetchLogs(true)}
                        disabled={refreshing}
                        className="p-2.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all disabled:opacity-50"
                        title="刷新"
                    >
                        <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                    <button
                        onClick={handleClearLogs}
                        disabled={clearing || logs.length === 0}
                        className="flex items-center gap-2 px-4 py-2.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50 font-bold"
                    >
                        <Trash2 className="w-5 h-5" />
                        清空日志
                    </button>
                </div>
            </header>

            {/* Filter Bar */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-300 flex items-center gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                        type="text"
                        placeholder="搜索事件、号码或错误详情..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border-transparent focus:bg-white focus:border-blue-500 focus:ring-0 rounded-xl transition-all text-slate-900 font-medium text-sm"
                    />
                </div>
                <div className="flex items-center gap-2 text-sm font-bold text-slate-400 px-2 whitespace-nowrap">
                    <Activity className="w-4 h-4 text-emerald-500" />
                    已加载 {logs.length} 条记录
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-300 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-200">
                                <th className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider w-48">执行时间</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider w-32">状态标签</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-600 uppercase tracking-wider">事件描述</th>
                                <th className="px-6 py-4 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredLogs.length > 0 ? (
                                filteredLogs.map((log) => (
                                    <tr key={log.id} className="hover:bg-blue-50/30 transition-colors group">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm text-slate-700 font-bold font-mono">{formatTime(log.time)}</span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-black border uppercase ${getBgColor(log.level)}`}>
                                                {getIcon(log.level)}
                                                {log.level}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex flex-col gap-0.5">
                                                <p className="text-sm font-bold text-slate-900">{log.message}</p>
                                                {log.detail && (
                                                    <p className="text-xs text-slate-500 font-medium break-all">{log.detail}</p>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <ChevronRight className="w-4 h-4 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={4} className="px-6 py-24 text-center text-slate-400">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="p-5 bg-slate-50 rounded-full">
                                                <Send className="w-10 h-10 text-slate-200" />
                                            </div>
                                            <p className="font-bold">{searchTerm ? "找不到任何匹配的结果" : "暂无历史记录，请尝试触发一次发送任务"}</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
