"use client";

import { useEffect, useState } from "react";
import { Loader2, ArrowRight, Save, Database, LayoutTemplate } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

interface SyncMappingModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (mapping: Record<string, string>, selectedFields: string[]) => void;
  isExecuting: boolean;
  sourceId?: string;
}

const COMMON_MAPPING_DICTIONARY: Record<string, string> = {
  "name": "姓名",
  "phone": "电话",
  "sendCount": "发送次数",
  "lastSentAt": "最后发送时间",
  "relation": "关系",
  "market": "市场"
};

export function SyncMappingModal({ open, onClose, onConfirm, isExecuting, sourceId }: SyncMappingModalProps) {
  const [loading, setLoading] = useState(true);
  const [mysqlFields, setMysqlFields] = useState<any[]>([]);
  const [notionProperties, setNotionProperties] = useState<any[]>([]);
  
  // mapping 结构: { "mysqlFieldName": "notionPropertyName" }
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // selectedFields 记录哪些 MySQL 字段被勾选要同步
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

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

          // 自动生成初始映射和勾选
          const initialMapping: Record<string, string> = {};
          const initialSelected = new Set<string>();

          fields.forEach((field: any) => {
            // 忽略内部字段
            if (["id", "userId", "properties", "createdAt", "updatedAt"].includes(field.name)) return;
            
            // 尝试智能匹配
            const guessNotionName = COMMON_MAPPING_DICTIONARY[field.name] || field.name;
            const match = properties.find((p: any) => p.name === guessNotionName || p.name.toLowerCase() === field.name.toLowerCase());
            
            if (match) {
              initialMapping[field.name] = match.name;
              initialSelected.add(field.name);
            }
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

  const toggleField = (fieldName: string) => {
    const next = new Set(selectedFields);
    if (next.has(fieldName)) next.delete(fieldName);
    else next.add(fieldName);
    setSelectedFields(next);
  };

  const handleSelectChange = (mysqlField: string, notionProperty: string) => {
    setMapping(prev => ({ ...prev, [mysqlField]: notionProperty }));
    if (notionProperty && !selectedFields.has(mysqlField)) {
      toggleField(mysqlField); // 自动勾选
    }
  };

  const handleConfirm = () => {
    onConfirm(mapping, Array.from(selectedFields));
  };

  return (
    <Modal open={open} onClose={onClose} title="⚙️ 反向同步：高级字段映射 (Field Mapper)" className="max-w-4xl md:max-w-5xl lg:max-w-6xl w-full">
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin mb-4" />
          <p className="font-bold">正在扫描双边数据库结构，请稍候...</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm font-medium border border-blue-100 flex gap-3">
            <Database className="w-5 h-5 flex-shrink-0 text-blue-600 mt-0.5" />
            <p>
              系统已扫描你的本地 MySQL 数据库及目标 Notion 数据库。请在下方选择你想同步的字段，并指定它们在 Notion 中的对应列。<br/>
              <span className="text-blue-600 font-bold">没有被勾选的字段在本次同步中将被忽略。</span>
            </p>
          </div>

          <div className="bg-white border-2 border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="hidden md:flex items-center px-6 py-3 border-b-2 border-slate-200 bg-slate-50 font-black text-slate-700">
              <div className="flex-1 flex items-center gap-2"><Database className="w-4 h-4 text-slate-400" /> 本地 MySQL 字段</div>
              <div className="w-12 flex justify-center"><ArrowRight className="w-4 h-4 text-slate-400" /></div>
              <div className="flex-1 flex items-center gap-2"><LayoutTemplate className="w-4 h-4 text-slate-400" /> 目标 Notion 属性 (列)</div>
            </div>

            <div className="max-h-[50vh] overflow-y-auto p-2 space-y-1">
              {mysqlFields.map((field) => {
                if (["id", "userId", "properties", "createdAt", "updatedAt"].includes(field.name)) return null;
                
                const isSelected = selectedFields.has(field.name);
                
                return (
                  <div key={field.name} className={`flex flex-col md:flex-row md:items-center p-3 rounded-xl transition-all ${isSelected ? "bg-white hover:bg-slate-50 border border-slate-100 shadow-sm" : "opacity-50 grayscale hover:opacity-100 hover:grayscale-0 border border-transparent"}`}>
                    <div className="flex-grow md:flex-1 flex items-center gap-3 mb-2 md:mb-0">
                      <input 
                        type="checkbox" 
                        checked={isSelected}
                        onChange={() => toggleField(field.name)}
                        className="w-5 h-5 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <div>
                        <p className="font-black text-slate-800 text-sm">{field.name}</p>
                        {field.isDynamic && <span className="text-[10px] font-black bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded uppercase">JSON 动态提取</span>}
                      </div>
                    </div>
                    
                    <div className="hidden md:flex w-12 justify-center">
                      <ArrowRight className={`w-4 h-4 ${isSelected ? "text-blue-400" : "text-slate-300"}`} />
                    </div>

                    <div className="flex-grow md:flex-1 w-full md:w-auto">
                      <select 
                        value={mapping[field.name] || ""}
                        onChange={(e) => handleSelectChange(field.name, e.target.value)}
                        disabled={!isSelected}
                        className="w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm font-bold text-slate-700 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400 cursor-pointer h-[38px]"
                      >
                        <option value="">-- 请选择 Notion 目标列 --</option>
                        {notionProperties.map((prop: any) => (
                          <option key={prop.name} value={prop.name}>
                            {prop.name} ({prop.type})
                          </option>
                        ))}
                      </select>
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
              className="flex items-center gap-2 px-8 py-2.5 bg-blue-600 text-white rounded-xl font-black hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50"
            >
              {isExecuting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              {isExecuting ? "正在提交..." : `确认并开始同步 (${selectedFields.size} 列)`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
