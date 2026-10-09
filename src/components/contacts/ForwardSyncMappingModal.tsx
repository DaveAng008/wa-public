"use client";

import { useEffect, useState } from "react";
import { Loader2, ArrowRight, Save, Database, LayoutTemplate } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

interface ForwardSyncMappingModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (mapping: Record<string, string>, selectedFields: string[], purge: boolean) => void;
  isExecuting: boolean;
  sourceId?: string;
}

const COMMON_MAPPING_DICTIONARY: Record<string, string> = {
  "姓名": "name",
  "Name": "name",
  "电话": "phone",
  "电话号码": "phone",
  "Phone": "phone",
  "市场": "market",
  "Market": "market",
  "关系": "relation",
  "Relation": "relation"
};

export function ForwardSyncMappingModal({ open, onClose, onConfirm, isExecuting, sourceId }: ForwardSyncMappingModalProps) {
  const [loading, setLoading] = useState(true);
  const [mysqlFields, setMysqlFields] = useState<any[]>([]);
  const [notionProperties, setNotionProperties] = useState<any[]>([]);
  
  // mapping 结构: { "notionPropertyName": "mysqlFieldName" }
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // selectedFields 记录哪些 Notion 属性被勾选要同步
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [purge, setPurge] = useState(false);

  useEffect(() => {
    if (!open) return;
    
    let isMounted = true;
    const fetchSchemas = async () => {
      setLoading(true);
      try {
        const [mysqlRes, notionRes] = await Promise.all([
          fetch("/api/contacts/schema"),
          fetch(`/api/notion/schema${sourceId ? `?sourceId=${sourceId}` : ""}`)
        ]);
        
        const mysqlData = await mysqlRes.json();
        const notionData = await notionRes.json();

        if (isMounted) {
          const fields = mysqlData.allFields || [];
          const properties = notionData.properties || [];
          
          setMysqlFields(fields);
          setNotionProperties(properties);

          const initialMapping: Record<string, string> = {};
          const initialSelected = new Set<string>();

          properties.forEach((prop: any) => {
            // 尝试智能匹配
            const guessMysqlName = COMMON_MAPPING_DICTIONARY[prop.name] || prop.name;
            initialMapping[prop.name] = guessMysqlName;
            initialSelected.add(prop.name); // 默认全选
          });

          setMapping(initialMapping);
          setSelectedFields(initialSelected);
        }
      } catch (e) {
        console.error("获取数据结构失败", e);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchSchemas();
    return () => { isMounted = false; };
  }, [open]);

  const toggleField = (propName: string) => {
    const next = new Set(selectedFields);
    if (next.has(propName)) next.delete(propName);
    else next.add(propName);
    setSelectedFields(next);
  };

  const handleSelectChange = (notionProperty: string, mysqlField: string) => {
    setMapping(prev => ({ ...prev, [notionProperty]: mysqlField }));
    if (mysqlField && !selectedFields.has(notionProperty)) {
      toggleField(notionProperty);
    }
  };

  const handleCustomFieldChange = (notionProperty: string, value: string) => {
    setMapping(prev => ({ ...prev, [notionProperty]: value }));
    if (value && !selectedFields.has(notionProperty)) {
      toggleField(notionProperty);
    }
  };

  const handleConfirm = () => {
    onConfirm(mapping, Array.from(selectedFields), purge);
  };

  return (
    <Modal open={open} onClose={onClose} title="📥 正向同步：从 Notion 拉取数据" className="max-w-4xl md:max-w-5xl lg:max-w-6xl w-full">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mb-4" />
          <p className="font-bold">正在扫描双边数据库结构，请稍候...</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-emerald-50 text-emerald-800 p-4 rounded-xl text-sm font-medium border border-emerald-100 flex gap-3">
            <LayoutTemplate className="w-5 h-5 flex-shrink-0 text-emerald-600 mt-0.5" />
            <p>
              系统将从 Notion 抓取数据并覆盖到本地 MySQL。请在下方配置 Notion 字段如何映射到本地字段。<br/>
              <span className="text-emerald-600 font-bold">没有被勾选的 Notion 列将不会被同步到本地。如果填入新的字段名，系统会自动在本地创建该扩展字段。</span>
            </p>
          </div>

          <label className="flex items-center gap-2 p-3 bg-red-50 text-red-700 border border-red-200 rounded-xl cursor-pointer">
            <input 
              type="checkbox" 
              checked={purge} 
              onChange={(e) => setPurge(e.target.checked)}
              className="w-4 h-4 text-red-600 rounded focus:ring-red-500"
            />
            <span className="font-bold text-sm">清除本地所有旧数据（仅保留本次同步下来的数据）</span>
          </label>

          <div className="bg-white border-2 border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="hidden md:flex items-center px-6 py-3 border-b-2 border-slate-200 bg-slate-50 font-black text-slate-700">
              <div className="flex-1 flex items-center gap-2"><LayoutTemplate className="w-4 h-4 text-slate-400" /> 源：Notion 属性 (列)</div>
              <div className="w-12 flex justify-center"><ArrowRight className="w-4 h-4 text-slate-400" /></div>
              <div className="flex-1 flex items-center gap-2"><Database className="w-4 h-4 text-slate-400" /> 目标：本地 MySQL 字段</div>
            </div>

            <div className="max-h-[50vh] overflow-y-auto p-2 space-y-1">
              {notionProperties.map((prop) => {
                const isSelected = selectedFields.has(prop.name);
                
                return (
                  <div key={prop.name} className={`flex flex-col md:flex-row md:items-center p-3 rounded-xl transition-all ${isSelected ? "bg-white hover:bg-slate-50 border border-slate-100 shadow-sm" : "opacity-50 grayscale hover:opacity-100 hover:grayscale-0 border border-transparent"}`}>
                    <div className="flex-grow md:flex-1 flex items-center gap-3 mb-2 md:mb-0">
                      <input 
                        type="checkbox" 
                        checked={isSelected}
                        onChange={() => toggleField(prop.name)}
                        className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                      />
                      <div>
                        <p className="font-black text-slate-800 text-sm">{prop.name}</p>
                        <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase">{prop.type}</span>
                      </div>
                    </div>
                    
                    <div className="hidden md:flex w-12 justify-center">
                      <ArrowRight className={`w-4 h-4 ${isSelected ? "text-emerald-400" : "text-slate-300"}`} />
                    </div>

                    <div className="flex-grow md:flex-1 flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                      <select 
                        value={mysqlFields.some(f => f.name === mapping[prop.name]) ? mapping[prop.name] : (mapping[prop.name] ? "custom" : "")}
                        onChange={(e) => {
                          if (e.target.value !== "custom") {
                            handleSelectChange(prop.name, e.target.value);
                          }
                        }}
                        disabled={!isSelected}
                        className="w-full sm:w-1/2 border-2 border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none disabled:bg-slate-50 disabled:text-slate-400 cursor-pointer h-[38px]"
                      >
                        <option value="">-- 忽略此列 --</option>
                        <optgroup label="内置核心字段">
                          <option value="name">姓名 (name)</option>
                          <option value="phone">电话 (phone)</option>
                          <option value="market">市场 (market)</option>
                          <option value="relation">关系 (relation)</option>
                        </optgroup>
                        <optgroup label="已有的扩展字段">
                          {mysqlFields
                            .filter(f => !["id", "userId", "properties", "createdAt", "updatedAt", "name", "phone", "market", "relation"].includes(f.name))
                            .map((field: any) => (
                            <option key={field.name} value={field.name}>{field.name}</option>
                          ))}
                        </optgroup>
                        <option value="custom">✎ 自定义新字段...</option>
                      </select>

                      <input 
                        type="text"
                        placeholder="或输入自定义字段名"
                        disabled={!isSelected}
                        value={mapping[prop.name] || ""}
                        onChange={(e) => handleCustomFieldChange(prop.name, e.target.value)}
                        className="w-full sm:w-1/2 border-2 border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none disabled:bg-slate-50 disabled:text-slate-400 h-[38px]"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button 
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              取消
            </button>
            <button 
              onClick={handleConfirm}
              disabled={isExecuting || selectedFields.size === 0}
              className="flex items-center gap-2 px-8 py-2.5 bg-emerald-600 text-white rounded-xl font-black hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 disabled:opacity-50"
            >
              {isExecuting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              {isExecuting ? "正在同步..." : `确认并开始同步 (${selectedFields.size} 列)`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
