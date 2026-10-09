"use client";

import React from "react";
import { Plus, Trash2, Filter, X } from "lucide-react";

export interface FilterRule {
  id: string;
  field: string;
  operator: "contains" | "not_contains" | "equals" | "not_equals" | "is_empty" | "is_not_empty";
  value: string;
}

interface FilterBuilderProps {
  availableColumns: string[];
  rules: FilterRule[];
  onChange: (rules: FilterRule[]) => void;
  contacts?: any[];
  ruleMatchMode?: "AND" | "OR";
  onRuleMatchModeChange?: (mode: "AND" | "OR") => void;
}

const OPERATORS = [
  { label: "包含", value: "contains" },
  { label: "不包含", value: "not_contains" },
  { label: "等于", value: "equals" },
  { label: "不等于", value: "not_equals" },
  { label: "为空", value: "is_empty" },
  { label: "不为空", value: "is_not_empty" },
];

export function FilterBuilder({ 
  availableColumns, 
  rules, 
  onChange, 
  contacts = [],
  ruleMatchMode = "AND",
  onRuleMatchModeChange
}: FilterBuilderProps) {
  const [focusedRuleId, setFocusedRuleId] = React.useState<string | null>(null);

  const addRule = () => {
    const newRule: FilterRule = {
      id: Math.random().toString(36).substr(2, 9),
      field: "name",
      operator: "contains",
      value: "",
    };
    onChange([...rules, newRule]);
  };

  const removeRule = (id: string) => {
    onChange(rules.filter((r) => r.id !== id));
  };

  const updateRule = (id: string, updates: Partial<FilterRule>) => {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  const fieldSuggestions = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    const fields = ["name", "phone", "market", ...availableColumns];
    
    fields.forEach(field => {
      const values = new Set<string>();
      contacts.forEach(contact => {
        let val = "";
        if (["name", "phone", "market", "relation"].includes(field)) {
          val = contact[field];
        } else if (contact.properties) {
          try {
            const props = typeof contact.properties === 'string' ? JSON.parse(contact.properties) : contact.properties;
            val = props?.[field];
          } catch(e) {}
        }
        if (val !== undefined && val !== null && val !== "") {
          values.add(String(val));
        }
      });
      map[field] = Array.from(values).sort();
    });
    return map;
  }, [contacts, availableColumns]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex flex-wrap items-center gap-4 text-slate-950 font-black text-sm uppercase tracking-wider">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-blue-600" /> 高级规则筛选
          </div>
          {rules.length > 1 && onRuleMatchModeChange && (
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button 
                onClick={() => onRuleMatchModeChange("AND")}
                className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-all ${ruleMatchMode === "AND" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
              >
                满足全部 (AND)
              </button>
              <button 
                onClick={() => onRuleMatchModeChange("OR")}
                className={`px-2.5 py-1 rounded-md text-[10px] font-black transition-all ${ruleMatchMode === "OR" ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
              >
                满足任一 (OR)
              </button>
            </div>
          )}
        </div>
        {rules.length > 0 && (
          <button 
            onClick={() => onChange([])}
            className="text-[10px] font-black text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors uppercase"
          >
            <X className="w-3 h-3" /> 清空所有规则
          </button>
        )}
      </div>

      <div className="space-y-3">
        {rules.map((rule) => (
          <div key={rule.id} className="flex flex-wrap items-center gap-2 bg-slate-50 p-3 rounded-2xl border-2 border-slate-100 animate-in fade-in slide-in-from-left-2 duration-200">
            {/* 字段选择 */}
            <select
              value={rule.field}
              onChange={(e) => updateRule(rule.id, { field: e.target.value })}
              className="bg-white border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-900 focus:border-blue-600 outline-none min-w-[120px]"
            >
              <optgroup label="核心字段">
                <option value="name">姓名</option>
                <option value="phone">电话</option>
                <option value="market">市场</option>
              </optgroup>
              <optgroup label="Notion 动态列">
                {availableColumns.map((col) => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </optgroup>
            </select>

            {/* 操作符选择 */}
            <select
              value={rule.operator}
              onChange={(e) => updateRule(rule.id, { operator: e.target.value as any })}
              className="bg-white border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-blue-700 focus:border-blue-600 outline-none"
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>

            {/* 值输入 */}
            {!["is_empty", "is_not_empty"].includes(rule.operator) && (
              <div className="relative flex-1 min-w-[150px]">
                <input
                  type="text"
                  value={rule.value}
                  onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                  placeholder="请输入搜索内容..."
                  onFocus={() => setFocusedRuleId(rule.id)}
                  onBlur={() => setTimeout(() => setFocusedRuleId(null), 200)}
                  className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-2 text-xs font-black text-slate-900 focus:border-blue-600 outline-none placeholder:text-slate-300"
                />
                {focusedRuleId === rule.id && fieldSuggestions[rule.field]?.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border-2 border-slate-200 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                    {fieldSuggestions[rule.field].map(val => (
                      <div
                        key={val}
                        onClick={() => {
                          updateRule(rule.id, { value: val });
                          setFocusedRuleId(null);
                        }}
                        className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {val}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 删除按钮 */}
            <button
              onClick={() => removeRule(rule.id)}
              className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        {rules.length === 0 && (
          <div className="text-center py-3 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 text-xs font-bold">
            暂无高级过滤规则，点击下方按钮开始精准筛选
          </div>
        )}

        <button
          onClick={addRule}
          className="w-full py-3 flex items-center justify-center gap-2 border-2 border-dashed border-blue-200 rounded-2xl text-blue-600 hover:bg-blue-50 hover:border-blue-400 transition-all font-black text-xs uppercase"
        >
          <Plus className="w-4 h-4" /> 添加过滤条件
        </button>
      </div>
    </div>
  );
}
