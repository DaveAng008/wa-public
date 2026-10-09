"use client";

import { Filter, UsersRound, Save, Loader2, Globe, Mail, MessageSquare, RefreshCw, Pin } from "lucide-react";
import { useState, useEffect } from "react";

type DynamicSchema = {
    markets: string[];
    relations: string[];
    raceAndLangs: string[];
    sendStatuses: string[];
    responseStatuses: string[];
};

export default function AudiencePage() {
    const [audience, setAudience] = useState<DynamicSchema>({
        markets: [],
        relations: [],
        raceAndLangs: [],
        sendStatuses: [],
        responseStatuses: []
    });
    const [schema, setSchema] = useState<DynamicSchema | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [schemaError, setSchemaError] = useState("");
    const [cacheTime, setCacheTime] = useState<string | null>(null);

    // 进入页面时：只读取缓存（秒回），不请求 Notion
    useEffect(() => {
        Promise.all([
            fetch('/api/audience').then(res => res.json()).catch(() => ({})),
            fetch('/api/notion/schema/cache').then(res => res.json()).catch(() => ({ schema: null }))
        ]).then(([audienceData, cacheData]) => {
            setAudience(prev => ({ ...prev, ...audienceData }));

            if (cacheData.schema) {
                setSchema(cacheData.schema);
                setCacheTime(cacheData.updatedAt);
            }
            // 如果没有缓存，不报错，只是显示空状态，提示用户点刷新
            setLoading(false);
        });
    }, []);

    // 手动刷新：从 Notion 实时拉取最新数据
    const handleRefresh = async () => {
        setRefreshing(true);
        setSchemaError("");
        try {
            const res = await fetch('/api/notion/schema');
            const data = await res.json();

            if (data.error) {
                if (data.error === "NoCredentials") {
                    setSchemaError("暂未配置 Notion 密钥。请先前往【发送配置】页面填入 Notion Secret 和 Database ID。");
                } else {
                    setSchemaError("动态拉取 Notion 标签失败: " + data.error);
                }
            } else {
                setSchema(data);
                setCacheTime(new Date().toISOString());
                setSchemaError("");
            }
        } catch (err: any) {
            setSchemaError("网络异常: " + err.message);
        }
        setRefreshing(false);
    };

    const handleSave = async () => {
        setSaving(true);
        await fetch('/api/audience', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(audience)
        });
        setTimeout(() => {
            setSaving(false);
            alert('人群筛选规则保存成功！n8n 将使用最新的五维严密匹配方案来发单。');
        }, 600);
    };

    const toggleTag = (category: keyof DynamicSchema, tag: string) => {
        setAudience(prev => {
            const currentList = prev[category] || [];
            const isSelected = currentList.includes(tag);
            return {
                ...prev,
                [category]: isSelected ? currentList.filter(i => i !== tag) : [...currentList, tag]
            };
        });
    };

    if (loading) return <div className="p-8 flex items-center text-slate-500 gap-2"><Loader2 className="w-5 h-5 animate-spin" /> 正在加载缓存数据...</div>;

    const sections = [
        { key: 'markets' as const, title: '按市场筛选', icon: Filter, color: 'text-orange-600', bg: 'bg-orange-50' },
        { key: 'relations' as const, title: '按身份关系', icon: UsersRound, color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { key: 'raceAndLangs' as const, title: '按种族与语言', icon: Globe, color: 'text-sky-600', bg: 'bg-sky-50' },
        { key: 'sendStatuses' as const, title: '按是否已发送', icon: Mail, color: 'text-rose-600', bg: 'bg-rose-50' },
        { key: 'responseStatuses' as const, title: '按是否有回应', icon: MessageSquare, color: 'text-emerald-600', bg: 'bg-emerald-50' }
    ];

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="space-y-6 max-w-4xl pb-16">
            <header className="mb-4">
                <h1 className="text-3xl font-bold tracking-tight">人群筛选规则 (Audience V3)</h1>
                <p className="text-slate-500 mt-2">完全由 Notion 数据源动态驱动的五维漏斗系统。</p>
            </header>

            {/* 📌 钉住数据状态栏 + 刷新按钮 */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                        <Pin className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-800">数据快照 (钉住数据)</h3>
                        {cacheTime ? (
                            <p className="text-sm text-slate-500">
                                上次从 Notion 同步时间：<span className="font-semibold text-slate-700">{formatTime(cacheTime)}</span>
                            </p>
                        ) : (
                            <p className="text-sm text-amber-600">尚未从 Notion 拉取过数据，请点击右侧按钮首次同步。</p>
                        )}
                    </div>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="bg-blue-600 text-white px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-sm"
                >
                    {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    {refreshing ? '正在从 Notion 同步...' : '从 Notion 刷新数据'}
                </button>
            </div>

            {schemaError && (
                <div className="bg-red-50 text-red-600 p-4 rounded-2xl shadow-sm border border-red-100 text-center">
                    <p>{schemaError}</p>
                </div>
            )}

            {schema ? (
                <>
                    {sections.map((section) => {
                        const items = schema[section.key] || [];
                        const selected = audience[section.key] || [];
                        return (
                            <div key={section.key} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                                <div className="p-6 border-b border-slate-100 flex items-center gap-3">
                                    <div className={`p-2 ${section.bg} ${section.color} rounded-lg`}>
                                        <section.icon className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold">{section.title}</h2>
                                        <p className="text-sm text-slate-500">检测到 Notion 中存在 <span className="font-bold text-slate-700">{items.length}</span> 个标签选项</p>
                                    </div>
                                </div>
                                <div className="p-6">
                                    {items.length === 0 ? (
                                        <p className="text-sm text-slate-400 italic">在 Notion 里暂无此标签配置。</p>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {items.map(tag => (
                                                <label key={tag} className="flex items-center gap-3 p-3 border border-slate-100 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors group">
                                                    <input
                                                        type="checkbox"
                                                        checked={selected.includes(tag)}
                                                        onChange={() => toggleTag(section.key, tag)}
                                                        className="w-5 h-5 rounded border-slate-400 text-blue-600 focus:ring-blue-500 cursor-pointer transition-all"
                                                    />
                                                    <span className="font-semibold group-hover:text-black text-slate-900">{tag}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    <div className="pt-4 flex justify-end">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="bg-slate-900 text-white px-8 py-3 rounded-xl font-medium flex items-center gap-2 hover:bg-slate-800 transition-colors disabled:opacity-50 shadow-md"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {saving ? '保存联动中...' : '应用五维规则'}
                        </button>
                    </div>
                </>
            ) : (
                <div className="bg-slate-50 rounded-2xl p-12 text-center border border-dashed border-slate-200">
                    <RefreshCw className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-500 text-lg">尚无缓存数据</p>
                    <p className="text-slate-400 text-sm mt-1">请点击上方"从 Notion 刷新数据"按钮进行首次同步。</p>
                </div>
            )}
        </div>
    );
}
