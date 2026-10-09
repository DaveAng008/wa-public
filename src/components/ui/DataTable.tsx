"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  editable?: boolean;
  getEditValue?: (row: T) => string; // 自定义进入编辑模式时输入框的值
}

interface DataTableProps<T extends { id: string }> {
  columns: Column<T>[];
  data: T[];
  pageSize?: number;
  totalTotalRows?: number; // 服务端返回的总条数
  currentPage?: number; // 当前页码
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  className?: string;
  onCellEdit?: (rowIds: string[], columnKey: string, newValue: any) => Promise<void>;
  autocompleteSuggestions?: Record<string, string[]>; // 外部传入的各列联想词源
  draftEdits?: Record<string, Record<string, any>>; // 外部传入的挂起草稿修改
  onHeaderDoubleClick?: (columnKey: string) => void;
  getRowClassName?: (row: T) => string;
  selectedRowIds?: Set<string>;
  onSelectionChange?: (selectedIds: Set<string>) => void;
}

export function DataTable<T extends { id: string; properties?: any }>({
  columns,
  data,
  pageSize = 20,
  totalTotalRows,
  currentPage = 1,
  onPageChange,
  onPageSizeChange,
  className = "",
  onCellEdit,
  autocompleteSuggestions,
  draftEdits,
  onHeaderDoubleClick,
  getRowClassName,
  selectedRowIds: propSelectedRowIds,
  onSelectionChange,
}: DataTableProps<T>) {
  const [internalPage, setInternalPage] = useState(1);
  const page = onPageChange ? currentPage : internalPage;
  const setPage = onPageChange || setInternalPage;
  
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // 列宽状态
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const lastTouchTimeRef = useRef<Record<string, number>>({});
  
  // 多选与编辑状态
  const [internalSelectedRowIds, setInternalSelectedRowIds] = useState<Set<string>>(new Set());
  const selectedRowIds = propSelectedRowIds !== undefined ? propSelectedRowIds : internalSelectedRowIds;

  const updateSelectedRowIds = (next: Set<string>) => {
    if (propSelectedRowIds === undefined) {
      setInternalSelectedRowIds(next);
    }
    if (onSelectionChange) {
      onSelectionChange(next);
    }
  };

  const [lastClickedRowId, setLastClickedRowId] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; colKey: string } | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [savingCell, setSavingCell] = useState<{ rowId: string; colKey: string } | null>(null);

  // 拖拽列重排状态
  const [columnOrder, setColumnOrder] = useState<string[]>([]);
  const [draggedColKey, setDraggedColKey] = useState<string | null>(null);
  const [dragOverColKey, setDragOverColKey] = useState<string | null>(null);

  // 初始化或同步列顺序与 localStorage
  useEffect(() => {
    const saved = localStorage.getItem("contacts_column_order");
    const colKeys = columns.map((c) => c.key);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as string[];
        const validKeys = parsed.filter((k) => colKeys.includes(k));
        const missingKeys = colKeys.filter((k) => !validKeys.includes(k));
        setColumnOrder([...validKeys, ...missingKeys]);
      } catch {
        setColumnOrder(colKeys);
      }
    } else {
      setColumnOrder(colKeys);
    }
  }, [columns]);

  // 根据拖动顺序对列进行排序
  const orderedColumns = React.useMemo(() => {
    if (columnOrder.length === 0) return columns;
    return [...columns].sort((a, b) => {
      const idxA = columnOrder.indexOf(a.key);
      const idxB = columnOrder.indexOf(b.key);
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  }, [columns, columnOrder]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = sortKey
    ? [...data].sort((a, b) => {
        const aVal = (a as any)[sortKey];
        const bVal = (b as any)[sortKey];
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return sortDir === "asc" ? cmp : -cmp;
      })
    : data;

  const totalRowsCount = totalTotalRows !== undefined ? totalTotalRows : data.length;
  const totalPages = Math.max(1, Math.ceil(totalRowsCount / pageSize));
  
  const paged = onPageChange ? sorted : sorted.slice((page - 1) * pageSize, page * pageSize);
  const pageSizes = [20, 50, 100, 200, 500];

  // 清除失效的选择
  useEffect(() => {
    if (propSelectedRowIds === undefined) {
      setInternalSelectedRowIds(new Set());
    }
    setLastClickedRowId(null);
  }, [page, data, propSelectedRowIds]);

  // 列宽调整逻辑
  const startResize = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    const startX = e.clientX;
    const headerElement = e.currentTarget.parentElement;
    const startWidth = colWidths[colKey] || headerElement?.getBoundingClientRect().width || 120;
    
    const doDrag = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      setColWidths((prev) => ({
        ...prev,
        [colKey]: Math.max(60, startWidth + deltaX),
      }));
    };
    
    const stopDrag = () => {
      document.removeEventListener("mousemove", doDrag);
      document.removeEventListener("mouseup", stopDrag);
    };
    
    document.addEventListener("mousemove", doDrag);
    document.addEventListener("mouseup", stopDrag);
  };

  // 获取以当前列已有值作为联想源
  const getUniqueValues = (colKey: string): string[] => {
    // 优先使用外部传入的全量联想数据
    if (autocompleteSuggestions) {
      if (autocompleteSuggestions[colKey]) {
        return autocompleteSuggestions[colKey];
      }
      if (colKey.startsWith("prop_")) {
        const propName = colKey.substring(5);
        if (autocompleteSuggestions[propName]) {
          return autocompleteSuggestions[propName];
        }
      }
    }

    const values = data.map((row) => {
      if (colKey.startsWith("prop_")) {
        const propName = colKey.substring(5);
        return row.properties?.[propName];
      }
      return (row as any)[colKey];
    });
    
    return Array.from(
      new Set(
        values
          .map((v) => v?.toString().trim())
          .filter(Boolean)
      )
    ) as string[];
  };

  // 点击行进行多选
  const handleRowClick = (e: React.MouseEvent, rowId: string) => {
    if (
      e.target instanceof HTMLInputElement || 
      e.target instanceof HTMLButtonElement || 
      editingCell
    ) {
      return;
    }
    
    const newSelected = new Set(selectedRowIds);
    
    if (e.ctrlKey || e.metaKey) {
      if (newSelected.has(rowId)) {
        newSelected.delete(rowId);
      } else {
        newSelected.add(rowId);
      }
      setLastClickedRowId(rowId);
    } else if (e.shiftKey && lastClickedRowId) {
      const rowIds = paged.map((r) => r.id);
      const idx1 = rowIds.indexOf(lastClickedRowId);
      const idx2 = rowIds.indexOf(rowId);
      
      if (idx1 !== -1 && idx2 !== -1) {
        const start = Math.min(idx1, idx2);
        const end = Math.max(idx1, idx2);
        
        for (let i = start; i <= end; i++) {
          newSelected.add(rowIds[i]);
        }
      }
    } else {
      newSelected.clear();
      newSelected.add(rowId);
      setLastClickedRowId(rowId);
    }
    
    updateSelectedRowIds(newSelected);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowId: string, colKey: string) => {
    if (e.key === "Enter") {
      saveEdit(rowId, colKey, editValue);
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  const saveEdit = async (rowId: string, colKey: string, val: string) => {
    setEditingCell(null);
    
    let originalVal = "";
    const row = data.find((r) => r.id === rowId);
    if (row) {
      if (colKey.startsWith("prop_")) {
        const propName = colKey.substring(5);
        originalVal = row.properties?.[propName] || "";
      } else {
        originalVal = (row as any)[colKey] || "";
      }
    }
    
    if (originalVal.toString() === val.toString()) {
      return;
    }
    
    if (onCellEdit) {
      setSavingCell({ rowId, colKey });
      try {
        const idsToUpdate = selectedRowIds.has(rowId) 
          ? Array.from(selectedRowIds) 
          : [rowId];
          
        await onCellEdit(idsToUpdate, colKey, val);
      } catch (err) {
        console.error("保存失败", err);
      } finally {
        setSavingCell(null);
      }
    }
  };

  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden flex flex-col w-full ${className}`}>
      
      {/* 滚动容器，表头粘性置顶 */}
      <div className="overflow-auto max-h-[calc(100vh-290px)] min-h-[250px] flex-grow">
        <table className="w-full text-sm table-fixed border-collapse">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              {orderedColumns.map((col) => {
                const widthStyle = colWidths[col.key] 
                  ? `${colWidths[col.key]}px` 
                  : (col.width || "120px");
                
                const isSelection = col.key === "selection";
                
                return (
                  <th
                    key={col.key}
                    draggable={!isSelection}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", col.key);
                      setDraggedColKey(col.key);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (draggedColKey && draggedColKey !== col.key && !isSelection) {
                        setDragOverColKey(col.key);
                      }
                    }}
                    onDragLeave={() => {
                      setDragOverColKey(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggedColKey && draggedColKey !== col.key && !isSelection) {
                        const newOrder = [...columnOrder];
                        const dragIdx = newOrder.indexOf(draggedColKey);
                        const targetIdx = newOrder.indexOf(col.key);
                        
                        if (dragIdx !== -1 && targetIdx !== -1) {
                          newOrder.splice(dragIdx, 1);
                          newOrder.splice(targetIdx, 0, draggedColKey);
                          setColumnOrder(newOrder);
                          localStorage.setItem("contacts_column_order", JSON.stringify(newOrder));
                        }
                      }
                      setDraggedColKey(null);
                      setDragOverColKey(null);
                    }}
                    onDragEnd={() => {
                      setDraggedColKey(null);
                      setDragOverColKey(null);
                    }}
                    className={`sticky top-0 bg-slate-50 z-30 py-3 text-left font-bold text-slate-800 border-b border-slate-200 relative select-none truncate transition-all ${
                      isSelection ? "px-2" : "px-4"
                    } ${
                      col.sortable ? "cursor-pointer hover:text-slate-950" : ""
                    } ${
                      draggedColKey === col.key ? "opacity-35" : ""
                    } ${
                      dragOverColKey === col.key ? "border-l-4 border-l-blue-500 bg-blue-50/50" : ""
                    }`}
                    style={{ width: widthStyle }}
                    onClick={() => col.sortable && handleSort(col.key)}
                    onDoubleClick={(e) => {
                      if (onHeaderDoubleClick && !isSelection) {
                        e.stopPropagation();
                        onHeaderDoubleClick(col.key);
                      }
                    }}
                    onTouchStart={(e) => {
                      if (!isSelection) {
                        const now = Date.now();
                        const prev = lastTouchTimeRef.current[col.key] || 0;
                        if (now - prev < 300) {
                          e.stopPropagation();
                          onHeaderDoubleClick?.(col.key);
                        }
                        lastTouchTimeRef.current[col.key] = now;
                      }
                    }}
                  >
                    <span className="flex items-center gap-1 truncate pr-2">
                      {col.header}
                      {col.sortable && sortKey === col.key && (
                        sortDir === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
                      )}
                    </span>
                    
                    {/* 拖动列宽的手柄 */}
                    <div 
                      onMouseDown={(e) => startResize(e, col.key)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-2 bottom-2 w-2 border-r-2 border-slate-300/60 cursor-col-resize hover:bg-blue-500/20 hover:border-blue-500 active:bg-blue-600 z-20 transition-all"
                      title="拖动调整列宽"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={orderedColumns.length} className="px-4 py-12 text-center text-slate-400">
                  暂无数据
                </td>
              </tr>
            ) : (
              paged.map((row, idx) => {
                const isSelected = selectedRowIds.has(row.id);
                const customRowClass = getRowClassName ? getRowClassName(row) : "";
                
                return (
                  <tr 
                    key={row.id} 
                    onClick={(e) => handleRowClick(e, row.id)}
                    className={`border-b border-slate-50 transition-colors ${
                      isSelected 
                        ? "bg-blue-50/70 hover:bg-blue-50" 
                        : (customRowClass || (idx % 2 === 0 ? "bg-white hover:bg-slate-50/50" : "bg-slate-50/30 hover:bg-slate-50/50"))
                    }`}
                  >
                    {orderedColumns.map((col) => {
                      const isEditing = editingCell?.rowId === row.id && editingCell?.colKey === col.key;
                      const isSaving = savingCell?.rowId === row.id && savingCell?.colKey === col.key;
                      
                      const widthStyle = colWidths[col.key] 
                        ? `${colWidths[col.key]}px` 
                        : (col.width || "120px");

                      const isSelection = col.key === "selection";

                      // 获取展示文字
                      let rawVal = "";
                      if (col.key.startsWith("prop_")) {
                        const propName = col.key.substring(5);
                        rawVal = row.properties?.[propName] || "";
                      } else {
                        rawVal = (row as any)[col.key] || "";
                      }
                      
                      const displayVal = Array.isArray(rawVal) 
                        ? rawVal.join(", ") 
                        : (rawVal?.toString() || "");

                      if (isEditing) {
                        const options = getUniqueValues(col.key);
                        const filteredOptions = options.filter((opt) => 
                          opt.toLowerCase().includes(editValue.toLowerCase())
                        );

                        return (
                          <td 
                            key={col.key} 
                            className="px-2 py-1.5 z-40 bg-white"
                            style={{ width: widthStyle }}
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                          >
                            <div className="relative w-full">
                              <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={(e) => handleKeyDown(e, row.id, col.key)}
                                onBlur={() => saveEdit(row.id, col.key, editValue)}
                                autoFocus
                                className="w-full border-2 border-blue-500 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 outline-none bg-white h-[32px] shadow-sm"
                              />
                              {/* 智能联想下拉菜单 */}
                              {filteredOptions.length > 0 && (
                                <div 
                                  className={`absolute left-0 right-0 z-50 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto p-1 text-[11px] ${
                                    idx >= paged.length - 3 ? "bottom-full mb-1" : "top-full mt-1"
                                  }`}
                                >
                                  {filteredOptions.map((opt) => (
                                    <div
                                      key={opt}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        saveEdit(row.id, col.key, opt);
                                      }}
                                      className="p-1.5 hover:bg-blue-50 cursor-pointer rounded font-medium text-slate-700 truncate"
                                      title={opt}
                                    >
                                      {opt}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      }

                      const isDraft = draftEdits?.[row.id]?.[col.key] !== undefined;

                      return (
                        <td 
                          key={col.key} 
                          onDoubleClick={() => {
                            if (col.editable) {
                              setEditingCell({ rowId: row.id, colKey: col.key });
                              const editVal = col.getEditValue ? col.getEditValue(row) : displayVal;
                              setEditValue(editVal);
                            }
                          }}
                          className={`py-3 text-slate-700 truncate select-none relative ${
                            isSelection ? "px-2" : "px-4"
                          } ${
                            col.editable ? "hover:bg-slate-100/40 cursor-pointer" : ""
                          } ${isSaving ? "opacity-40 grayscale" : ""} ${
                            isDraft ? "bg-amber-50/50 border-2 border-dashed border-amber-300" : ""
                          }`}
                          style={{ width: widthStyle, maxWidth: widthStyle }}
                          title={displayVal || undefined}
                        >
                          <div className="w-full truncate pr-4">
                            {col.render ? col.render(row) : (displayVal || "—")}
                          </div>
                          
                          {/* 行内单单元格加载态 */}
                          {isSaving && (
                            <div className="absolute right-2 top-1/2 -translate-y-1/2">
                              <span className="inline-block w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 flex-shrink-0 z-30">
        <div className="flex items-center gap-6">
          <span className="text-sm font-bold text-slate-600">
            第 {Math.min(page, totalPages)} / {totalPages} 页，共 {totalRowsCount} 条
          </span>
          
          {onPageSizeChange && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-slate-500 uppercase">每页显示</span>
              <select 
                value={pageSize} 
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="bg-white border-2 border-slate-200 rounded-xl px-3 py-1.5 text-sm font-black text-slate-800 focus:border-blue-600 focus:outline-none transition-all cursor-pointer"
              >
                {pageSizes.map(size => (
                  <option key={size} value={size}>{size} 条</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="p-2 rounded-xl hover:bg-white hover:shadow-md border-2 border-transparent hover:border-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronLeft className="w-5 h-5 text-slate-700" />
          </button>
          
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const p = Math.max(1, Math.min(page - 2, totalPages - 4)) + i;
            if (p > totalPages || p < 1) return null;
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-10 h-10 rounded-xl text-sm font-black transition-all ${
                  p === page 
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-200" 
                    : "hover:bg-white hover:border-slate-200 border-2 border-transparent text-slate-600"
                }`}
              >
                {p}
              </button>
            );
          })}

          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="p-2 rounded-xl hover:bg-white hover:shadow-md border-2 border-transparent hover:border-slate-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <ChevronRight className="w-5 h-5 text-slate-700" />
          </button>
        </div>
      </div>
    </div>
  );
}
