"use client";

import { useState, useEffect, useRef } from "react";
import { 
  Plus, Image as ImageIcon, FileText, Video, Mic, Trash2, Link as LinkIcon, 
  BookImage, Edit2, PlayCircle, ExternalLink, File, Folder, MoreVertical, 
  Copy, Download, Upload, X, Settings2, Shield, Check, Ban, Lock, Share2, Sparkles 
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface MaterialFolder {
  id: string;
  name: string;
  parentId?: string | null;
  userId?: string;
  sharedType?: "NONE" | "SYSTEM" | "SPECIFIC" | "ADMIN_REVIEW";
  sharedTo?: string | null;
  createdAt?: string;
  userName?: string;
}

interface Material {
  id: string;
  name: string;
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "RANDOM_GROUP";
  content: string | null;
  url: string | null;
  folderId: string | null;
  userId?: string;
  sharedType?: "NONE" | "SYSTEM" | "SPECIFIC" | "ADMIN_REVIEW";
  sharedTo?: string | null;
  createdAt: string;
  userName?: string;
}

const ChevronRight = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m9 18 6-6-6-6"/></svg>
);

const ChevronDown = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m6 9 6 6 6-6"/></svg>
);

export default function MaterialsPage() {
  const { user } = useAuth();
  const currentUserId = user?.id;
  const isAdmin = user?.role === "admin";

  const [folders, setFolders] = useState<MaterialFolder[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<"personal" | "public" | "review">("personal");
  
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", type: "TEXT", content: "", url: "", folderId: "" });
  
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [parentFolderIdForNew, setParentFolderIdForNew] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderNameValue, setEditingFolderNameValue] = useState("");
  
  const [isLoading, setIsLoading] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  
  // AI 扩写相关状态
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiResults, setAiResults] = useState<string[]>([]);
  const [detectedHoliday, setDetectedHoliday] = useState("");
  const [selectedBrand, setSelectedBrand] = useState("gemini");
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-pro");

  const [importMode, setImportMode] = useState<"append" | "overwrite">("append");
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 文件上传与音频录制状态
  const [mediaSourceType, setMediaSourceType] = useState<"upload" | "record" | "url">("upload");
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [localFilePreview, setLocalFilePreview] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "stopped">("idle");
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);

  // 共享与审核状态
  const [selectedMaterials, setSelectedMaterials] = useState<Set<string>>(new Set());
  
  // 管理员共享配置弹窗状态
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareTarget, setShareTarget] = useState<any>(null); // Material or MaterialFolder
  const [shareTargetIsFolder, setShareTargetIsFolder] = useState(false);
  const [shareType, setShareType] = useState<"NONE" | "SYSTEM" | "SPECIFIC">("NONE");
  const [shareTo, setShareTo] = useState<string[]>([]);
  const [systemUsers, setSystemUsers] = useState<any[]>([]);
  
  // 操作员克隆副本状态
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<Material | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneFolderId, setCloneFolderId] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    fetchFolders();
    fetchMaterials();
  }, []);

  useEffect(() => {
    if (isAdmin && showShareModal) {
      fetchSystemUsers();
    }
  }, [showShareModal]);

  const fetchSystemUsers = async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setSystemUsers(data.filter((u: any) => u && u.role === "operator"));
        } else {
          setSystemUsers([]);
        }
      }
    } catch (err) {
      console.error("无法获取用户列表:", err);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const options = { mimeType: "audio/webm" };
      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = new MediaRecorder(stream, options);
      } catch (e) {
        mediaRecorder = new MediaRecorder(stream);
      }
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorder.start();
      setRecordingState("recording");
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          if (prev >= 300) {
            stopRecording();
            return 300;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      console.error("无法启动麦克风录音:", err);
      alert("无法获取麦克风权限，请检查浏览器设置是否允许访问麦克风。");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setRecordingState("stopped");
  };

  const handleExport = (format: "xlsx" | "txt") => {
    window.open(`/api/materials/export?format=${format}`, "_blank");
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (importMode === "overwrite" && !confirm("⚠️ 覆盖模式将清除所有现有素材，确定继续吗？")) {
      e.target.value = "";
      return;
    }
    setImportStatus("正在导入，请稍候...");
    const form = new FormData();
    form.append("file", file);
    form.append("mode", importMode);
    try {
      const res = await fetch("/api/materials/import", { method: "POST", body: form });
      const data = await res.json();
      if (res.ok) {
        setImportStatus(`✅ ${data.message}`);
        fetchMaterials();
      } else {
        setImportStatus(`❌ 导入失败: ${data.error}`);
      }
    } catch (err: any) {
      setImportStatus(`❌ 网络错误: ${err.message}`);
    }
    e.target.value = "";
  };

  const getDriveId = (url: string) => {
    if (!url) return null;
    const match = url.match(/\/file\/d\/([^/]+)/) || url.match(/id=([^&]+)/);
    return match ? match[1] : null;
  };

  const getPreviewUrl = (url: string | null, type: string) => {
    if (!url) return "";
    const driveId = getDriveId(url);
    if (driveId && type === "IMAGE") {
      return `https://drive.google.com/thumbnail?id=${driveId}&sz=w800`;
    }
    return url;
  };

  const fetchFolders = async () => {
    const res = await fetch("/api/material-folders");
    if (res.ok) {
      const data = await res.json();
      setFolders(Array.isArray(data) ? data : []);
    }
  };

  const fetchMaterials = async () => {
    const res = await fetch("/api/materials");
    if (res.ok) {
      const data = await res.json();
      setMaterials(Array.isArray(data) ? data : []);
    }
  };

  const handleSaveFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await fetch("/api/material-folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: folderName, parentId: parentFolderIdForNew }),
      });
      if (res.ok) {
        setShowFolderForm(false);
        setFolderName("");
        setParentFolderIdForNew(null);
        fetchFolders();
      } else {
        const errorData = await res.json();
        alert("保存失败: " + (errorData.error || "未知错误"));
      }
    } catch (err: any) {
      alert("网络错误: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveFolderRename = async (folderId: string, newName: string) => {
    if (!newName.trim()) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/material-folders/${folderId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        setEditingFolderId(null);
        fetchFolders();
      } else {
        const errorData = await res.json();
        alert("重命名失败: " + (errorData.error || "未知错误"));
      }
    } catch (err: any) {
      alert("网络错误: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm("确定要删除此文件夹及其下属所有内容吗？此操作无法恢复！")) return;
    await fetch(`/api/material-folders/${id}`, { method: "DELETE" });
    if (activeFolderId === id) setActiveFolderId(null);
    fetchFolders();
    fetchMaterials();
  };

  const handleAiRewrite = async () => {
    if (!formData.content) return;
    setIsGenerating(true);
    setAiResults([]);
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const res = await fetch("/api/materials/ai-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: formData.content,
          prompt: aiPrompt,
          date: today,
          type: formData.type,
          selectedBrand,
          selectedModel
        }),
      });
      
      const data = await res.json();
      if (res.ok) {
        setAiResults(data.results || []);
        if (data.holiday) setDetectedHoliday(data.holiday);
      } else {
        alert("AI 生成失败: " + (data.error || "未知错误"));
      }
    } catch (err: any) {
      alert("网络错误: " + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setUploadingFile(true);
    try {
      let finalUrl = formData.url;

      // 如果不是纯文本且有本地文件或新录制的音频，先进行文件上传
      if (formData.type !== "TEXT" && formData.type !== "RANDOM_GROUP") {
        if (mediaSourceType === "upload" && localFile) {
          const uploadForm = new FormData();
          uploadForm.append("file", localFile);
          uploadForm.append("type", formData.type === "IMAGE" ? "image" : "audio");
          
          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            body: uploadForm
          });
          const uploadData = await uploadRes.json();
          if (!uploadRes.ok) throw new Error(uploadData.error || "文件上传失败");
          finalUrl = uploadData.url;
        } else if (formData.type === "AUDIO" && mediaSourceType === "record" && audioBlob) {
          const uploadForm = new FormData();
          const audioFile = new (window as any).File([audioBlob], `voice_${Date.now()}.webm`, { type: audioBlob.type });
          uploadForm.append("file", audioFile);
          uploadForm.append("type", "audio");
          
          const uploadRes = await fetch("/api/upload", {
            method: "POST",
            body: uploadForm
          });
          const uploadData = await uploadRes.json();
          if (!uploadRes.ok) throw new Error(uploadData.error || "录音上传失败");
          finalUrl = uploadData.url;
        }
      }

      const isEditing = !!editingId;
      const endpoint = isEditing ? `/api/materials/${editingId}` : "/api/materials";
      const method = isEditing ? "PUT" : "POST";
      
      let content = formData.content;
      if (formData.type === "RANDOM_GROUP") {
        const lines = content.split('\n').map(l => l.trim()).filter(l => l !== "");
        content = JSON.stringify(lines);
      }

      const payload = {
        ...formData,
        url: finalUrl || null,
        content,
        folderId: formData.folderId || null
      };

      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowForm(false);
        setEditingId(null);
        setFormData({ name: "", type: "TEXT", content: "", url: "", folderId: activeFolderId || "" });
        setLocalFile(null);
        setLocalFilePreview(null);
        setAudioBlob(null);
        setAudioUrl(null);
        setRecordingState("idle");
        fetchMaterials();
      } else {
        const errorData = await res.json();
        alert("保存失败: " + (errorData.error || "未知错误"));
      }
    } catch (err: any) {
      alert("错误: " + err.message);
    } finally {
      setIsLoading(false);
      setUploadingFile(false);
    }
  };

  const handleCopyMaterial = async (mat: Material) => {
    if (!confirm(`确定要复制素材 "${mat.name}" 吗？`)) return;
    try {
      const res = await fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mat.name + " (副本)",
          type: mat.type,
          content: mat.content,
          url: mat.url,
          folderId: mat.folderId
        }),
      });
      if (res.ok) {
        fetchMaterials();
      }
    } catch (err) {
      alert("复制失败");
    }
  };

  const startEdit = (mat: Material) => {
    setEditingId(mat.id);
    
    let content = mat.content || "";
    if (mat.type === "RANDOM_GROUP" && content) {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          content = parsed.join('\n');
        }
      } catch (e) {
        console.error("Failed to parse random group content:", e);
      }
    }

    setFormData({
      name: mat.name,
      type: mat.type,
      content: content,
      url: mat.url || "",
      folderId: mat.folderId || "",
    });
    
    if (mat.url) {
      const isWebLink = mat.url.startsWith("http://") || mat.url.startsWith("https://") || mat.url.startsWith("//");
      if (isWebLink) {
        setMediaSourceType("url");
        setLocalFilePreview(null);
      } else {
        setMediaSourceType("upload");
        setLocalFilePreview(mat.url);
      }
    } else {
      setMediaSourceType("upload");
      setLocalFilePreview(null);
    }
    setLocalFile(null);
    setAudioBlob(null);
    setAudioUrl(null);
    setRecordingState("idle");
    
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDeleteMaterial = async (id: string) => {
    if (!confirm("确定要删除这个素材吗？")) return;
    await fetch(`/api/materials/${id}`, { method: "DELETE" });
    fetchMaterials();
  };

  // 共享与审核接口交互
  const handleShareSubmit = async () => {
    if (!shareTarget) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/materials/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: shareTarget.id,
          isFolder: shareTargetIsFolder,
          sharedType: shareType,
          sharedTo: shareType === "SPECIFIC" ? shareTo : []
        })
      });
      if (res.ok) {
        setShowShareModal(false);
        setShareTarget(null);
        fetchFolders();
        fetchMaterials();
      } else {
        const data = await res.json();
        alert("共享失败: " + (data.error || "未知错误"));
      }
    } catch (err: any) {
      alert("网络错误: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyShareSingle = async (materialId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/materials/submit-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialIds: [materialId] })
      });
      if (res.ok) {
        alert("提交审核成功，等待管理员处理。");
        fetchMaterials();
      } else {
        const data = await res.json();
        alert("提交失败: " + (data.error || "未知错误"));
      }
    } catch (err: any) {
      alert("网络错误: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyShareBatch = async () => {
    if (selectedMaterials.size === 0) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/materials/submit-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialIds: Array.from(selectedMaterials) })
      });
      if (res.ok) {
        alert("批量提交审核成功，已清空选择。");
        setSelectedMaterials(new Set());
        fetchMaterials();
      } else {
        const data = await res.json();
        alert("批量提交失败: " + (data.error || "未知错误"));
      }
    } catch (err: any) {
      alert("网络错误: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (id: string, action: "APPROVE_ALL" | "SAVE_SELF" | "REJECT", targets?: string[]) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/materials/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action,
          sharedTo: targets || []
        })
      });
      if (res.ok) {
        alert("审批操作成功。");
        fetchMaterials();
      } else {
        const data = await res.json();
        alert("操作失败: " + (data.error || "未知错误"));
      }
    } catch (err: any) {
      alert("网络错误: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneTarget) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cloneName,
          type: cloneTarget.type,
          content: cloneTarget.content,
          url: cloneTarget.url,
          folderId: cloneFolderId || null
        })
      });
      if (res.ok) {
        alert(`已成功克隆到您的素材库！`);
        setShowCloneModal(false);
        setCloneTarget(null);
        setCloneName("");
        setCloneFolderId("");
        fetchMaterials();
      } else {
        const data = await res.json();
        alert("克隆失败: " + (data.error || "未知错误"));
      }
    } catch (err: any) {
      alert("网络错误: " + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelectMaterial = (id: string) => {
    const next = new Set(selectedMaterials);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedMaterials(next);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "TEXT": return <FileText className="w-5 h-5 text-blue-500" />;
      case "IMAGE": return <ImageIcon className="w-5 h-5 text-emerald-500" />;
      case "AUDIO": return <Mic className="w-5 h-5 text-purple-500" />;
      case "VIDEO": return <Video className="w-5 h-5 text-red-500" />;
      case "DOCUMENT": return <File className="w-5 h-5 text-orange-500" />;
      case "RANDOM_GROUP": return <Plus className="w-5 h-5 text-yellow-500" />;
      default: return <FileText className="w-5 h-5 text-slate-500" />;
    }
  };

  // 数据分离与归属划分 (使用兼容性过滤，防止未打补丁时素材及目录消失)
  const personalFolders = folders.filter(f => String(f.userId) === String(currentUserId) || !f.sharedType || f.sharedType === "NONE");
  const publicFolders = folders.filter(f => String(f.userId) !== String(currentUserId) && (f.sharedType === "SYSTEM" || f.sharedType === "SPECIFIC"));

  const personalMaterials = materials.filter(m => String(m.userId) === String(currentUserId) || !m.sharedType || m.sharedType === "NONE");
  const publicMaterials = materials.filter(m => String(m.userId) !== String(currentUserId) && (m.sharedType === "SYSTEM" || m.sharedType === "SPECIFIC"));
  const reviewMaterials = materials.filter(m => m.sharedType === 'ADMIN_REVIEW');

  const getSubFolderIds = (foldersList: MaterialFolder[], id: string | null, visited = new Set<string>()): string[] => {
    if (id === null) return (foldersList || []).map(f => f.id);
    if (visited.has(id)) return [];
    visited.add(id);
    const children = (foldersList || []).filter(f => f.parentId === id).map(f => f.id);
    let all = [id, ...children];
    children.forEach(c => {
      all = [...all, ...getSubFolderIds(foldersList, c, visited)];
    });
    return Array.from(new Set(all));
  };

  const getFilteredMaterials = () => {
    if (activeCategory === "review") {
      return reviewMaterials;
    }
    if (activeCategory === "public") {
      if (activeFolderId === null) {
        return publicMaterials;
      }
      const subFolderIds = getSubFolderIds(publicFolders, activeFolderId);
      return publicMaterials.filter(m => subFolderIds.includes(m.folderId || ""));
    }
    // personal
    if (activeFolderId === null) {
      return personalMaterials;
    }
    const subFolderIds = getSubFolderIds(personalFolders, activeFolderId);
    return personalMaterials.filter(m => subFolderIds.includes(m.folderId || ""));
  };

  const filteredMaterials = getFilteredMaterials();

  const renderFolderTreeWrapper = (targetFolders: MaterialFolder[], parentId: string | null = null, depth = 0, isPublic = false) => {
    if (depth > 15) return null;
    const children = (targetFolders || []).filter(f => (f.parentId || null) === parentId);
    if (children.length === 0) return null;

    return (
      <div className={`space-y-1 ${depth > 0 ? "ml-4 border-l-2 border-slate-200 pl-2 mt-1" : ""}`}>
        {children.map(folder => {
          const hasChildren = (targetFolders || []).some(f => f.parentId === folder.id);
          const isExpanded = expandedFolders.has(folder.id);
          
          const countMaterialsInFolder = (fId: string, visited = new Set<string>()): number => {
            if (visited.has(fId)) return 0;
            visited.add(fId);
            const mList = isPublic ? publicMaterials : personalMaterials;
            const directCount = (mList || []).filter(m => m.folderId === fId).length;
            const subFolders = (targetFolders || []).filter(sf => sf.parentId === fId);
            return directCount + subFolders.reduce((sum, sf) => sum + countMaterialsInFolder(sf.id, visited), 0);
          };
          const count = countMaterialsInFolder(folder.id);

          return (
            <div key={folder.id} className="group relative flex flex-col">
              <div className="flex items-center justify-between">
                {editingFolderId === folder.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSaveFolderRename(folder.id, editingFolderNameValue);
                    }}
                    className="flex-1 flex items-center gap-1.5 px-2 py-1 bg-slate-50 border border-slate-200 rounded-xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Folder className={`w-4 h-4 shrink-0 ${isPublic ? "text-purple-500" : "text-blue-500"}`} />
                    <input
                      autoFocus
                      type="text"
                      value={editingFolderNameValue}
                      onChange={(e) => setEditingFolderNameValue(e.target.value)}
                      className="flex-1 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs text-slate-900 focus:border-blue-500 outline-none font-bold"
                    />
                    <button
                      type="submit"
                      className="p-1 text-emerald-600 hover:bg-slate-100 rounded-md shrink-0"
                      title="保存"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingFolderId(null)}
                      className="p-1 text-slate-400 hover:bg-slate-100 rounded-md shrink-0"
                      title="取消"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => {
                      setActiveCategory(isPublic ? "public" : "personal");
                      setActiveFolderId(folder.id);
                    }}
                    className={`flex-1 flex items-center gap-2 px-2 py-2 rounded-xl transition-all text-sm font-black ${
                      activeFolderId === folder.id && activeCategory === (isPublic ? "public" : "personal")
                        ? isPublic ? "bg-purple-600 text-white shadow-md shadow-purple-100" : "bg-blue-600 text-white shadow-md shadow-blue-100"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                    }`}
                  >
                    <div 
                      className="w-5 h-5 flex items-center justify-center shrink-0" 
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = new Set(expandedFolders);
                        if (next.has(folder.id)) next.delete(folder.id);
                        else next.add(folder.id);
                        setExpandedFolders(next);
                      }}
                    >
                      {hasChildren ? (isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : <span className="w-4 h-4" />}
                    </div>
                    <Folder className={`w-4 h-4 shrink-0 ${
                      activeFolderId === folder.id && activeCategory === (isPublic ? "public" : "personal")
                        ? "text-white"
                        : isPublic ? "text-purple-500" : "text-blue-500"
                    }`} />
                    <span className="truncate text-left flex-1">{folder.name}</span>
                    <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full shrink-0 ${
                      activeFolderId === folder.id && activeCategory === (isPublic ? "public" : "personal")
                        ? isPublic ? "bg-purple-700 text-white" : "bg-blue-700 text-white"
                        : "bg-slate-200 text-slate-600"
                    }`}>{count}</span>
                  </button>
                )}
                
                {/* 仅能对自己的文件夹进行新增、删除和共享设置 */}
                {!isPublic && (
                  <div className="flex items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity ml-1 shrink-0">
                    <button 
                      onClick={() => { setParentFolderIdForNew(folder.id); setShowFolderForm(true); }} 
                      className="p-1 text-slate-400 hover:text-emerald-600 hover:bg-slate-100 rounded-md" 
                      title="在此创建子文件夹"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={() => {
                        setEditingFolderId(folder.id);
                        setEditingFolderNameValue(folder.name);
                      }} 
                      className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-md" 
                      title="重命名文件夹"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    {isAdmin && (
                      <button 
                        onClick={() => {
                          setShareTarget(folder);
                          setShareTargetIsFolder(true);
                          setShareType(folder.sharedType === "ADMIN_REVIEW" ? "SYSTEM" : (folder.sharedType || "NONE"));
                          try {
                            const parsed = folder.sharedTo ? JSON.parse(folder.sharedTo) : [];
                            setShareTo(Array.isArray(parsed) ? parsed : []);
                          } catch (e) {
                            setShareTo([]);
                          }
                          setShowShareModal(true);
                        }} 
                        className="p-1 text-slate-400 hover:text-purple-600 hover:bg-slate-100 rounded-md" 
                        title="共享设置"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button 
                      onClick={() => handleDeleteFolder(folder.id)} 
                      className="p-1 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded-md" 
                      title="删除文件夹"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              {isExpanded && renderFolderTreeWrapper(targetFolders, folder.id, depth + 1, isPublic)}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 md:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter text-slate-950">素材库</h1>
          <p className="text-xs md:text-sm font-bold text-slate-500 mt-1">管理您的消息模板、图片、语音、视频和文档素材，支持跨角色共享与审核分发</p>
        </div>
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {/* 新增/根目录操作只在“我的素材”中生效 */}
          {activeCategory === "personal" && (
            <>
              <button
                onClick={() => {
                  setParentFolderIdForNew(null);
                  setShowFolderForm(true);
                }}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-2 border-slate-200 rounded-xl text-xs font-black transition-all shadow-sm"
              >
                <Folder className="w-4 h-4 text-blue-500" />
                新建根目录
              </button>
              
              <button
                onClick={() => {
                  setEditingId(null);
                  setFormData({ name: "", type: "TEXT", content: "", url: "", folderId: activeFolderId || "" });
                  setMediaSourceType("upload");
                  setLocalFile(null);
                  setLocalFilePreview(null);
                  setAudioBlob(null);
                  setAudioUrl(null);
                  setRecordingState("idle");
                  setShowForm(true);
                }}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black transition-all shadow-md shadow-emerald-100"
              >
                <Plus className="w-4 h-4" />
                新增素材
              </button>
            </>
          )}

          {/* 批量提交审核：操作员在个人素材库且有勾选项 */}
          {!isAdmin && activeCategory === "personal" && selectedMaterials.size > 0 && (
            <button
              onClick={handleApplyShareBatch}
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black transition-all shadow-md shadow-purple-100"
            >
              <Share2 className="w-4 h-4" />
              批量申请共享 ({selectedMaterials.size})
            </button>
          )}
          
          <div className="relative group flex-1 sm:flex-initial">
            <button
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-2 border-slate-200 rounded-xl text-xs font-black transition-all shadow-sm"
            >
              <Download className="w-4 h-4 text-emerald-600" />
              导出素材
            </button>
            <div className="absolute right-0 top-full mt-1 bg-white border-2 border-slate-200 rounded-2xl shadow-xl overflow-hidden z-50 hidden group-hover:block min-w-[150px]">
              <button onClick={() => handleExport("xlsx")} className="w-full text-left px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors flex items-center gap-2 border-b border-slate-100">
                <FileText className="w-4 h-4 text-emerald-600" />导出 Excel (.xlsx)
              </button>
              <button onClick={() => handleExport("txt")} className="w-full text-left px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />导出 TXT (.txt)
              </button>
            </div>
          </div>
          
          <button
            onClick={() => { setShowImportModal(true); setImportStatus(null); }}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-2 border-slate-200 rounded-xl text-xs font-black transition-all shadow-sm"
          >
            <Upload className="w-4 h-4 text-yellow-600" />
            导入素材
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.txt" className="hidden" onChange={handleImportFile} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* 左侧边栏：多分类目录树 */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white border-2 border-slate-200 rounded-3xl p-5 shadow-sm space-y-6">
            
            {/* 分类区一：我的素材 (个人素材) */}
            <div>
              <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between">
                <span>我的素材</span>
                <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-bold border border-blue-100">私有</span>
              </h3>
              
              <div className="space-y-1">
                <button
                  onClick={() => {
                    setActiveCategory("personal");
                    setActiveFolderId(null);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-black mb-2 ${
                    activeCategory === "personal" && activeFolderId === null 
                      ? "bg-blue-600 text-white shadow-md shadow-blue-100" 
                      : "text-slate-700 hover:text-slate-900 hover:bg-slate-50 border border-transparent"
                  }`}
                >
                  <BookImage className="w-4 h-4" />
                  所有个人素材
                  <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${
                    activeCategory === "personal" && activeFolderId === null ? "bg-blue-700 text-white" : "bg-slate-200 text-slate-600"
                  }`}>{personalMaterials.length}</span>
                </button>
                
                {renderFolderTreeWrapper(personalFolders, null, 0, false)}
              </div>
            </div>

            {/* 分类区二：公共素材库 (仅操作员可用或管理员查阅) */}
            {(publicFolders.length > 0 || publicMaterials.length > 0 || !isAdmin) && (
              <div className="pt-4 border-t border-slate-100">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between">
                  <span>公共素材库</span>
                  <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full font-bold border border-purple-100">共享</span>
                </h3>
                
                <div className="space-y-1">
                  <button
                    onClick={() => {
                      setActiveCategory("public");
                      setActiveFolderId(null);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-black mb-2 ${
                      activeCategory === "public" && activeFolderId === null 
                        ? "bg-purple-600 text-white shadow-md shadow-purple-100" 
                        : "text-slate-700 hover:text-slate-900 hover:bg-slate-50 border border-transparent"
                    }`}
                  >
                    <Share2 className="w-4 h-4" />
                    全部共享素材
                    <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${
                      activeCategory === "public" && activeFolderId === null ? "bg-purple-700 text-white" : "bg-slate-200 text-slate-600"
                    }`}>{publicMaterials.length}</span>
                  </button>
                  
                  {renderFolderTreeWrapper(publicFolders, null, 0, true)}
                </div>
              </div>
            )}

            {/* 分类区三：管理员专属审核工作台 */}
            {isAdmin && (
              <div className="pt-4 border-t border-slate-100">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center justify-between">
                  <span>审批管理</span>
                  <span className="text-[10px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-bold border border-red-100">全局</span>
                </h3>
                
                <button
                  onClick={() => {
                    setActiveCategory("review");
                    setActiveFolderId(null);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-black mb-2 relative ${
                    activeCategory === "review"
                      ? "bg-red-600 text-white shadow-md shadow-red-100"
                      : "text-slate-700 hover:text-slate-900 hover:bg-slate-50 border border-transparent"
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  操作员投稿审核
                  {reviewMaterials.length > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white animate-bounce shadow-sm">
                      {reviewMaterials.length}
                    </span>
                  )}
                  <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full ${
                    activeCategory === "review" ? "bg-red-700 text-white" : "bg-slate-200 text-slate-600"
                  }`}>{reviewMaterials.length}</span>
                </button>
              </div>
            )}
            
            {/* 快速新建文件夹表单 */}
            {showFolderForm && activeCategory === "personal" && (
              <form onSubmit={handleSaveFolder} className="mt-4 p-4 bg-slate-50 rounded-2xl border-2 border-slate-200 space-y-3">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                  创建在: <span className="text-blue-600 font-black">{parentFolderIdForNew ? (folders || []).find(f => f.id === parentFolderIdForNew)?.name : "根目录"}</span>
                </div>
                <input
                  autoFocus
                  required
                  type="text"
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                  placeholder="文件夹名称..."
                  className="w-full bg-white border-2 border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 focus:border-blue-600 outline-none font-bold"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={() => setShowFolderForm(false)} className="flex-1 py-1.5 bg-slate-200 hover:bg-slate-300 text-xs font-black text-slate-700 rounded-xl">取消</button>
                  <button type="submit" disabled={isLoading} className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-700 text-xs font-black text-white rounded-xl disabled:opacity-50">保存</button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* 右侧：主内容区 */}
        <div className="lg:col-span-3 space-y-6">
          {showForm && (
            <div className="bg-white border-2 border-slate-200 rounded-3xl p-6 shadow-md mb-8 animate-in slide-in-from-top duration-300">
              <form onSubmit={handleSaveMaterial} className="space-y-4">
                <div className="flex justify-between items-center mb-2 pb-2 border-b-2 border-slate-100">
                  <h2 className="text-lg md:text-xl font-black text-slate-900">{editingId ? "编辑素材" : "新建素材"}</h2>
                  <button type="button" onClick={() => setShowForm(false)} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg"><X className="w-5 h-5" /></button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">素材名称</label>
                    <input
                      required
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-black text-slate-950 focus:border-green-600 focus:bg-white outline-none transition-all"
                      placeholder="例如：春节促销早安问候"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">素材类型</label>
                    <select
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                      className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-black text-slate-950 focus:border-green-600 focus:bg-white outline-none transition-all h-[46px]"
                    >
                      <option value="TEXT">文本/文案</option>
                      <option value="RANDOM_GROUP">随机文本组</option>
                      <option value="IMAGE">图片</option>
                      <option value="AUDIO">语音</option>
                      <option value="VIDEO">视频</option>
                      <option value="DOCUMENT">文件 (PDF/PPT等)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">所属文件夹</label>
                    <select
                      value={formData.folderId || ""}
                      onChange={(e) => setFormData({ ...formData, folderId: e.target.value })}
                      className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-black text-slate-950 focus:border-green-600 focus:bg-white outline-none transition-all h-[46px]"
                    >
                      <option value="">-- 未分类 --</option>
                      {(() => {
                        const renderOptions = (parentId: string | null = null, depth = 0): React.ReactNode[] => {
                          // 仅允许选择自己拥有的文件夹
                          const children = folders.filter(f => (f.userId === currentUserId || !f.sharedType || f.sharedType === "NONE") && (f.parentId || null) === parentId);
                          return children.flatMap(f => [
                            <option key={f.id} value={f.id}>
                              {"\u00A0".repeat(depth * 4)}📁 {f.name}
                            </option>,
                            ...renderOptions(f.id, depth + 1)
                          ]);
                        };
                        return renderOptions(null, 0);
                      })()}
                    </select>
                  </div>
                </div>

                {formData.type === "TEXT" || formData.type === "RANDOM_GROUP" ? (
                  <div>
                    <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase flex justify-between items-center">
                      <span>{formData.type === "RANDOM_GROUP" ? "随机文本池 (每行一条文案)" : "文案内容"}</span>
                      <button
                        type="button"
                        onClick={() => setShowAiPanel(!showAiPanel)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg transition-all shadow-md shadow-purple-100 font-black"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                        ✨ AI 智能改写/扩写
                      </button>
                    </label>
                    <textarea
                      required
                      rows={4}
                      value={formData.content}
                      onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                      className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 focus:border-green-600 focus:bg-white outline-none transition-all resize-none"
                      placeholder={formData.type === "RANDOM_GROUP" ? "请输入随机文案，每行一条..." : "输入要发送的消息内容..."}
                    />
                    
                    {/* AI 智能面板 */}
                    {showAiPanel && (
                      <div className="mt-4 p-4 bg-purple-50/50 border-2 border-purple-100 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex justify-between items-center">
                          <h4 className="text-sm font-black text-purple-900 flex items-center gap-1.5">
                            ✨ AI 智能改写顾问
                          </h4>
                          {detectedHoliday && (
                            <span className="text-[10px] font-black bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full border border-purple-200">
                              📅 节日识别：{detectedHoliday}
                            </span>
                          )}
                        </div>
                        
                        <div className="flex flex-col sm:flex-row gap-2">
                          <select
                            value={selectedBrand}
                            onChange={(e) => {
                              setSelectedBrand(e.target.value);
                              if (e.target.value === "gemini") setSelectedModel("gemini-2.5-pro");
                              else if (e.target.value === "openai") setSelectedModel("gpt-4o");
                              else if (e.target.value === "deepseek") setSelectedModel("deepseek-reasoner");
                            }}
                            className="bg-white border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-800 focus:border-purple-500 shadow-sm outline-none"
                          >
                            <option value="gemini">Gemini</option>
                            <option value="openai">OpenAI</option>
                            <option value="deepseek">DeepSeek</option>
                          </select>
                          <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="flex-1 bg-white border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-black text-slate-800 focus:border-purple-500 shadow-sm outline-none"
                          >
                            {selectedBrand === "gemini" && (
                              <>
                                <option value="gemini-2.5-flash">Gemini 2.5 Flash (快速版 - API有免费额度/低成本)</option>
                                <option value="gemini-2.5-pro">Gemini 2.5 Pro (专业版 - API有免费额度/强推理)</option>
                                <option value="gemini-1.5-pro">Gemini 1.5 Pro (200万超长上下文)</option>
                                <option value="gemini-3.0-flash">Gemini 3.0 Flash (2026最新快速版)</option>
                                <option value="gemini-3.0-pro">Gemini 3.0 Pro (2026最新专业版)</option>
                              </>
                            )}
                            {selectedBrand === "openai" && (
                              <>
                                <option value="gpt-4o">GPT-4o (旗舰多模态 - 智能度高/全能)</option>
                                <option value="gpt-4o-mini">GPT-4o-mini (性价比王 - 极快/超低成本)</option>
                                <option value="o1-preview">o1-preview (强推理 - 适合复杂逻辑思考)</option>
                                <option value="o1-mini">o1-mini (轻量推理 - 适合代码/结构化输出)</option>
                              </>
                            )}
                            {selectedBrand === "deepseek" && (
                              <>
                                <option value="deepseek-chat">DeepSeek-V3 (通用对话 - 极低成本/高智商)</option>
                                <option value="deepseek-reasoner">DeepSeek-R1 (推理版 - 强逻辑/深度思考)</option>
                              </>
                            )}
                          </select>
                        </div>
                        
                        <div className="flex flex-wrap gap-1.5">
                          {["朋友圈种草", "节日温馨", "幽默风趣", "催单促销"].map(style => (
                            <button
                              key={style}
                              type="button"
                              onClick={() => setAiPrompt(`帮我改写成【${style}】风格，保持原意但更生动。`)}
                              className="text-xs px-2.5 py-1.5 bg-white hover:bg-purple-100 text-purple-700 rounded-lg transition-colors border border-purple-200 shadow-sm"
                            >
                              {style}
                            </button>
                          ))}
                        </div>

                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder="输入自定义改写要求，或选择上方风格..."
                            className="flex-1 bg-white border-2 border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 focus:border-purple-500 outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => handleAiRewrite()}
                            disabled={isGenerating || !formData.content}
                            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md shadow-purple-100"
                          >
                            {isGenerating ? "生成中..." : "开始生成"}
                          </button>
                        </div>

                        {aiResults.length > 0 && (
                          <div className="space-y-2 mt-3 pt-3 border-t border-purple-100">
                            <div className="text-[10px] text-purple-600 font-black uppercase tracking-widest">生成建议列表 (点击应用):</div>
                            {aiResults.map((result, index) => (
                              <div key={index} className="group relative bg-white hover:bg-purple-50/50 border border-purple-200 rounded-xl p-3 text-xs text-slate-800 transition-all shadow-sm">
                                <p className="whitespace-pre-wrap font-medium">{result}</p>
                                <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 bg-white/95 p-1 rounded-lg border border-purple-100 shadow-sm">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFormData({ ...formData, content: result });
                                    }}
                                    className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-[10px] font-black text-white rounded-md"
                                    title="覆盖主文本"
                                  >
                                    覆盖
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const sep = formData.type === "RANDOM_GROUP" ? "\n" : "\n\n";
                                      setFormData({ ...formData, content: formData.content + sep + result });
                                    }}
                                    className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-[10px] font-black text-white rounded-md"
                                    title="追加到最后"
                                  >
                                    追加
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* 媒体来源选择器 */}
                    <div>
                      <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">素材来源</label>
                      <div className="flex gap-2">
                        {formData.type === "AUDIO" && (
                          <button
                            type="button"
                            onClick={() => {
                              setMediaSourceType("record");
                              setLocalFile(null);
                              setLocalFilePreview(null);
                            }}
                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 border-2 rounded-xl text-xs font-black transition-all ${
                              mediaSourceType === "record"
                                ? "border-purple-600 bg-purple-50 text-purple-700"
                                : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
                            }`}
                          >
                            <Mic className="w-3.5 h-3.5" />
                            麦克风录音
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setMediaSourceType("upload");
                            setAudioBlob(null);
                            setAudioUrl(null);
                            setRecordingState("idle");
                          }}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 border-2 rounded-xl text-xs font-black transition-all ${
                            mediaSourceType === "upload"
                              ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
                          }`}
                        >
                          <Upload className="w-3.5 h-3.5" />
                          {formData.type === "IMAGE" ? "导入本地图片" : "导入本地音频"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMediaSourceType("url");
                            setLocalFile(null);
                            setLocalFilePreview(null);
                            setAudioBlob(null);
                            setAudioUrl(null);
                            setRecordingState("idle");
                          }}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 border-2 rounded-xl text-xs font-black transition-all ${
                            mediaSourceType === "url"
                              ? "border-blue-600 bg-blue-50 text-blue-700"
                              : "border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-600"
                          }`}
                        >
                          <LinkIcon className="w-3.5 h-3.5" />
                          使用网络链接
                        </button>
                      </div>
                    </div>

                    {/* 来源渲染区 */}
                    {mediaSourceType === "url" && (
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">文件链接 (URL)</label>
                        <div className="relative">
                          <LinkIcon className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                          <input
                            required
                            type="url"
                            value={formData.url}
                            onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                            className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm font-black text-slate-950 focus:border-green-600 focus:bg-white outline-none transition-all"
                            placeholder={
                              formData.type === "IMAGE"
                                ? "https://example.com/image.jpg"
                                : formData.type === "AUDIO"
                                ? "https://example.com/audio.mp3"
                                : "https://example.com/file.pdf"
                            }
                          />
                        </div>
                      </div>
                    )}

                    {mediaSourceType === "upload" && (
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">选择本地文件</label>
                        {localFilePreview ? (
                          <div className="relative border-2 border-slate-200 rounded-2xl p-4 bg-slate-50 flex items-center justify-between">
                            <div className="flex items-center gap-3 overflow-hidden">
                              {formData.type === "IMAGE" ? (
                                <img src={localFilePreview} alt="Preview" className="w-16 h-16 object-cover rounded-xl border border-slate-200 shrink-0" />
                              ) : (
                                <div className="p-3 bg-slate-200 rounded-xl shrink-0">
                                  {getTypeIcon(formData.type)}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="text-xs font-black text-slate-900 truncate">
                                  {localFile ? localFile.name : (typeof localFilePreview === 'string' && localFilePreview !== "file_loaded" ? localFilePreview.split('/').pop() : "已上传的文件")}
                                </p>
                                <p className="text-[10px] text-slate-400 font-bold">
                                  {localFile ? `${(localFile.size / (1024 * 1024)).toFixed(2)} MB` : "点击右侧 X 可重新上传"}
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setLocalFile(null);
                                setLocalFilePreview(null);
                              }}
                              className="p-1.5 hover:bg-slate-200 text-slate-400 hover:text-red-500 rounded-lg transition-all"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div
                            onClick={() => {
                              const input = document.createElement("input");
                              input.type = "file";
                              input.accept =
                                formData.type === "IMAGE"
                                  ? "image/*"
                                  : formData.type === "AUDIO"
                                  ? "audio/*"
                                  : formData.type === "VIDEO"
                                  ? "video/*"
                                  : "*/*";
                              input.onchange = (e: any) => {
                                const file = e.target.files?.[0];
                                if (!file) return;

                                const limitMB = formData.type === "IMAGE" ? 10 : 20;
                                if (file.size > limitMB * 1024 * 1024) {
                                  alert(`文件大小不能超过 ${limitMB}MB`);
                                  return;
                                }

                                setLocalFile(file);
                                if (formData.type === "IMAGE") {
                                  const reader = new FileReader();
                                  reader.onloadend = () => {
                                    setLocalFilePreview(reader.result as string);
                                  };
                                  reader.readAsDataURL(file);
                                } else {
                                  setLocalFilePreview("file_loaded");
                                }
                              };
                              input.click();
                            }}
                            className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl p-8 bg-slate-50 hover:bg-slate-100/50 flex flex-col items-center justify-center cursor-pointer transition-all gap-2"
                          >
                            <Upload className="w-8 h-8 text-slate-400" />
                            <p className="text-xs font-black text-slate-700">点击选择或拖拽文件</p>
                            <p className="text-[10px] text-slate-400 font-bold">
                              {formData.type === "IMAGE"
                                ? "支持手机照片库/电脑图片，限制 10MB 以内"
                                : "支持本地音频，限制 20MB 以内"}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {mediaSourceType === "record" && formData.type === "AUDIO" && (
                      <div className="border-2 border-slate-200 rounded-2xl p-6 bg-slate-50 flex flex-col items-center gap-4">
                        <div className="text-center">
                          <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-1">麦克风语音录制</h4>
                          <p className="text-[10px] text-slate-400 font-bold">最长录制 5 分钟，停止录制后可在线试听</p>
                        </div>

                        {recordingState === "idle" && (
                          <button
                            type="button"
                            onClick={startRecording}
                            className="w-16 h-16 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
                          >
                            <Mic className="w-7 h-7" />
                          </button>
                        )}

                        {recordingState === "recording" && (
                          <div className="flex flex-col items-center gap-3">
                            <div className="text-2xl font-black text-red-600 font-mono tracking-widest animate-pulse flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-red-600 shrink-0"></span>
                              {Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, "0")}
                            </div>
                            <button
                              type="button"
                              onClick={stopRecording}
                              className="px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-black shadow-md flex items-center gap-2 transition-all"
                            >
                              <span className="w-3 h-3 bg-white rounded-sm"></span>
                              停止录制
                            </button>
                          </div>
                        )}

                        {recordingState === "stopped" && audioUrl && (
                          <div className="w-full flex flex-col items-center gap-4">
                            <audio src={audioUrl} controls className="w-full" />
                            <div className="flex gap-2 w-full">
                              <button
                                type="button"
                                onClick={() => {
                                  setRecordingState("idle");
                                  setAudioBlob(null);
                                  setAudioUrl(null);
                                  setRecordingTime(0);
                                  startRecording();
                                }}
                                className="flex-1 py-2 bg-slate-200 hover:bg-slate-300 text-xs font-black text-slate-700 rounded-xl transition-all"
                              >
                                重新录制
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRecordingState("idle");
                                  setAudioBlob(null);
                                  setAudioUrl(null);
                                  setRecordingTime(0);
                                }}
                                className="py-2 px-3 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition-all"
                                title="放弃录音"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-3 border-t-2 border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setEditingId(null);
                    }}
                    className="px-4 py-2.5 text-xs font-black text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-black rounded-xl shadow-md transition-all"
                  >
                    {isLoading ? "保存中..." : "确认保存"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* 待审核审核模块工作台展示 */}
          {activeCategory === "review" && (
            <div className="bg-red-50/50 border-2 border-red-200 rounded-3xl p-5 mb-6">
              <h2 className="text-sm font-black text-red-900 flex items-center gap-2 mb-2">
                <Shield className="w-4.5 h-4.5" /> 操作员投稿审核区
              </h2>
              <p className="text-xs text-red-700 font-bold mb-0">这里展示的是操作员主动申请共享给全系统的文案、语音、图片素材，您可以快速决定将其“同意共享并公开”或“存入自己素材库（仅自己收藏）”或“驳回”。</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredMaterials.map((mat) => {
              const isSharedFromAdmin = mat.userId !== currentUserId && (mat.sharedType === "SYSTEM" || mat.sharedType === "SPECIFIC");
              const isSelected = selectedMaterials.has(mat.id);

              return (
                <div 
                  key={mat.id} 
                  className={`bg-white border-2 rounded-3xl p-5 shadow-sm group transition-all flex flex-col relative ${
                    isSharedFromAdmin 
                      ? "border-purple-200 hover:border-purple-400 hover:shadow-purple-50/50 hover:shadow-lg" 
                      : "border-slate-200 hover:border-blue-300 hover:shadow-lg"
                  }`}
                >
                  {/* 选择框：仅展示在自己私有库，且处于正常或未审核状态 */}
                  {activeCategory === "personal" && !isAdmin && mat.sharedType !== "ADMIN_REVIEW" && (
                    <div className="absolute top-4 right-4 z-10">
                      <input 
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectMaterial(mat.id)}
                        className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                      />
                    </div>
                  )}

                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-slate-50 rounded-xl border border-slate-100 group-hover:bg-slate-100 transition-colors shrink-0">
                        {getTypeIcon(mat.type)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-black text-slate-950 line-clamp-1 truncate">{mat.name}</h3>
                        <div className="text-[10px] text-slate-400 font-bold flex flex-wrap items-center gap-1.5 mt-0.5">
                          {mat.folderId && folders.find(f => f.id === mat.folderId) ? (
                            <span className="text-blue-600 font-black">[{folders.find(f => f.id === mat.folderId)?.name}]</span>
                          ) : null}
                          <span>{new Date(mat.createdAt).toLocaleDateString()}</span>
                          
                          {/* 状态徽章 */}
                          {mat.sharedType === "ADMIN_REVIEW" && (
                            <span className="bg-yellow-50 text-yellow-600 border border-yellow-100 px-1 rounded text-[8px] font-black">审核中</span>
                          )}
                          {mat.sharedType === "SYSTEM" && !isSharedFromAdmin && (
                            <span className="bg-purple-50 text-purple-600 border border-purple-100 px-1 rounded text-[8px] font-black">已共享</span>
                          )}
                          {mat.sharedType === "SPECIFIC" && !isSharedFromAdmin && (
                            <span className="bg-indigo-50 text-indigo-600 border border-indigo-100 px-1 rounded text-[8px] font-black">个人共享</span>
                          )}
                          {isSharedFromAdmin && (
                            <span className="bg-purple-100 text-purple-700 border border-purple-200 px-1.5 py-0.2 rounded text-[8px] font-black flex items-center gap-0.5">
                              <Lock className="w-2.5 h-2.5" /> 共享只读
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 操作按钮区：如果是只读共享素材，禁用删除编辑 */}
                    {!isSharedFromAdmin && activeCategory !== "review" && (
                      <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all bg-white shadow-sm border border-slate-200 rounded-lg p-0.5 shrink-0 z-10">
                        <button onClick={() => handleCopyMaterial(mat)} className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-slate-50 rounded-md" title="复制素材"><Copy className="w-3.5 h-3.5" /></button>
                        <button onClick={() => startEdit(mat)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded-md" title="编辑/移动"><Edit2 className="w-3.5 h-3.5" /></button>
                        
                        {/* 管理员共享设置按钮 */}
                        {isAdmin && (
                          <button 
                            onClick={() => {
                              setShareTarget(mat);
                              setShareTargetIsFolder(false);
                              setShareType(mat.sharedType === "ADMIN_REVIEW" ? "SYSTEM" : (mat.sharedType || "NONE"));
                              try {
                                const parsed = mat.sharedTo ? JSON.parse(mat.sharedTo) : [];
                                setShareTo(Array.isArray(parsed) ? parsed : []);
                              } catch (e) {
                                setShareTo([]);
                              }
                              setShowShareModal(true);
                            }}
                            className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-slate-50 rounded-md" 
                            title="共享设置"
                          >
                            <Settings2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button onClick={() => handleDeleteMaterial(mat.id)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-50 rounded-md" title="删除"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </div>

                  {/* 针对共享给操作员的素材：显示分享人姓名 */}
                  {isSharedFromAdmin && mat.userName && (
                    <div className="text-[10px] text-slate-400 font-bold mb-2 flex items-center gap-1 bg-slate-50 py-1 px-2.5 rounded-lg border border-slate-100">
                      <span>👤 分享人:</span>
                      <span className="text-purple-600 font-black">{mat.userName}</span>
                    </div>
                  )}

                  {/* 针对投稿审核素材：显示投稿人姓名 */}
                  {activeCategory === "review" && mat.userName && (
                    <div className="text-[10px] text-slate-400 font-bold mb-2 flex items-center gap-1 bg-red-50 py-1 px-2.5 rounded-lg border border-red-100">
                      <span>👤 投稿操作员:</span>
                      <span className="text-red-600 font-black">{mat.userName}</span>
                    </div>
                  )}

                  <div className="flex-1 mt-2">
                    {mat.type === "TEXT" ? (
                      <p className="text-sm text-slate-700 font-medium line-clamp-4 whitespace-pre-wrap">
                        {mat.content}
                      </p>
                    ) : mat.type === "RANDOM_GROUP" ? (
                      <div className="text-sm text-slate-700 font-medium line-clamp-4">
                        {(() => {
                          let pool = [];
                          try { pool = JSON.parse(mat.content || "[]"); } catch (e) {}
                          return (
                            <>
                              <div className="text-[10px] text-yellow-600 font-black mb-1">随机词组池 ({pool.length} 条):</div>
                              <div className="whitespace-pre-wrap">{pool.join(' | ')}</div>
                            </>
                          );
                        })()}
                      </div>
                    ) : mat.type === "IMAGE" ? (
                      <a href={mat.url!} target="_blank" rel="noreferrer" className="relative h-32 rounded-2xl overflow-hidden bg-slate-50 border border-slate-200 block group/img">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={getPreviewUrl(mat.url, "IMAGE")} alt={mat.name} className="w-full h-full object-cover group-hover/img:opacity-80 transition-opacity" />
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity pointer-events-none bg-black/10">
                          <ExternalLink className="w-6 h-6 text-white drop-shadow-lg" />
                        </div>
                      </a>
                    ) : mat.type === "VIDEO" ? (
                      <div className="relative h-32 rounded-2xl overflow-hidden bg-slate-50 border border-slate-200 flex items-center justify-center">
                        {getDriveId(mat.url!) ? (
                          <iframe src={`https://drive.google.com/file/d/${getDriveId(mat.url!)}/preview`} className="w-full h-full border-0 rounded-2xl" allow="autoplay" />
                        ) : (
                          <video src={mat.url!} controls className="w-full h-full object-contain rounded-2xl" />
                        )}
                      </div>
                    ) : mat.type === "AUDIO" ? (
                      <div className="h-20 bg-slate-50 rounded-2xl border border-slate-200 flex flex-col items-center justify-center p-2 relative group/audio overflow-hidden">
                        {getDriveId(mat.url!) ? (
                          <iframe src={`https://drive.google.com/file/d/${getDriveId(mat.url!)}/preview`} className="w-full h-full border-0 rounded-2xl" />
                        ) : (
                          <audio src={mat.url!} controls className="w-full h-10" />
                        )}
                        {getDriveId(mat.url!) && (
                          <a href={mat.url!} target="_blank" rel="noreferrer" className="absolute top-1 right-1 p-1 bg-white/90 rounded-md hover:bg-slate-100 border border-slate-200 shadow-sm opacity-0 group-hover/audio:opacity-100 transition-opacity">
                            <ExternalLink className="w-3.5 h-3.5 text-slate-600" />
                          </a>
                        )}
                      </div>
                    ) : mat.type === "DOCUMENT" ? (
                      <a href={mat.url!} target="_blank" rel="noreferrer" className="h-20 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-center p-3 group/doc hover:border-slate-400 transition-all">
                        <div className="flex flex-col items-center gap-1">
                          <File className="w-6 h-6 text-orange-500 group-hover/doc:scale-110 transition-transform" />
                          <span className="text-[10px] text-slate-400 group-hover/doc:text-slate-600 font-bold">点击查看文件</span>
                        </div>
                      </a>
                    ) : (
                      <div className="h-20 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-center p-3">
                        <p className="text-xs text-slate-400 line-clamp-2 break-all text-center font-bold">
                          {mat.url}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* 动作区卡片底部扩展 */}
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    {/* 公共只读素材克隆功能 */}
                    {isSharedFromAdmin && (
                      <button
                        onClick={() => {
                          setCloneTarget(mat);
                          setCloneName(mat.name + " (克隆副本)");
                          setCloneFolderId("");
                          setShowCloneModal(true);
                        }}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-purple-50 hover:bg-purple-100 text-purple-700 hover:text-purple-900 border border-purple-200 rounded-xl text-xs font-black transition-all shadow-sm"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        💾 保存副本到我的素材库
                      </button>
                    )}

                    {/* 操作员对自己素材的共享申请 */}
                    {!isAdmin && !isSharedFromAdmin && mat.sharedType !== "ADMIN_REVIEW" && (
                      <button
                        onClick={() => handleApplyShareSingle(mat.id)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 hover:border-slate-300 rounded-xl text-xs font-black transition-all"
                      >
                        <Share2 className="w-3.5 h-3.5 text-slate-500" />
                        📤 申请系统共享
                      </button>
                    )}

                    {/* 操作员对自己素材的审核中展示 */}
                    {!isAdmin && mat.sharedType === "ADMIN_REVIEW" && (
                      <div className="w-full text-center text-xs text-yellow-600 bg-yellow-50 py-2 rounded-xl font-bold border border-yellow-100 animate-pulse">
                        ⏳ 共享审核中，请耐心等待
                      </div>
                    )}

                    {/* 管理员对待审核投稿的审批栏 */}
                    {activeCategory === "review" && (
                      <div className="w-full flex flex-wrap gap-1.5">
                        <button
                          onClick={() => {
                            setShareTarget(mat);
                            setShareTargetIsFolder(false);
                            setShareType("SYSTEM");
                            setShareTo([]);
                            // 借用 share modal 的架构来做 "同意并公开" 的范围选择
                            setEditingId(mat.id); // 临时标记被审批的 ID
                            setShowShareModal(true);
                          }}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black transition-all shadow-sm"
                        >
                          <Check className="w-3 h-3" /> 同意共享
                        </button>
                        <button
                          onClick={() => handleApprove(mat.id, "SAVE_SELF")}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-black transition-all shadow-sm"
                          title="存为自己名下素材，原作者撤销共享"
                        >
                          <Download className="w-3 h-3" /> 仅自己收藏
                        </button>
                        <button
                          onClick={() => handleApprove(mat.id, "REJECT")}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-[10px] font-black transition-all"
                        >
                          <Ban className="w-3 h-3" /> 驳回
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredMaterials.length === 0 && !showForm && (
              <div className="col-span-full py-16 flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-3xl border-2 border-slate-200 border-dashed animate-in fade-in duration-300">
                <BookImage className="w-12 h-12 mb-3 text-slate-300 animate-pulse" />
                <p className="font-black text-slate-500">
                  {activeCategory === "review" 
                    ? "暂无待审核的操作员投稿素材" 
                    : activeCategory === "public" 
                    ? "公共素材库暂无素材" 
                    : "该分类下暂无素材"}
                </p>
                {activeCategory === "personal" && (
                  <p className="text-xs mt-1 text-slate-400 font-bold">点击右上角新增素材，或在编辑时移动素材到此</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* ====== 导入素材弹窗 ====== */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border-2 border-slate-200 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5 relative animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-2 border-b-2 border-slate-100">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Upload className="w-5 h-5 text-yellow-600" /> 导入素材
              </h3>
              <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-50 rounded-full transition-all">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-xs text-slate-500 font-bold">支持导入 <span className="text-green-600 font-black">.xlsx</span> 或 <span className="text-blue-600 font-black">.txt</span> 格式的素材文件（格式与导出一致）。</p>
              
              <div>
                <label className="block text-xs font-black text-slate-700 mb-2 uppercase">导入模式</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setImportMode("append")}
                    className={`p-3 rounded-2xl border-2 text-left transition-all ${importMode === "append" ? "border-green-500 bg-green-50/50" : "border-slate-200 bg-slate-50 hover:bg-slate-100"}`}
                  >
                    <div className={`font-black text-sm mb-1 ${importMode === "append" ? "text-green-700" : "text-slate-700"}`}>✅ 追加模式</div>
                    <div className="text-[10px] text-slate-500 font-bold">只添加新素材，不影响现有数据</div>
                  </button>
                  <button
                    onClick={() => setImportMode("overwrite")}
                    className={`p-3 rounded-2xl border-2 text-left transition-all ${importMode === "overwrite" ? "border-red-500 bg-red-50/50" : "border-slate-200 bg-slate-50 hover:bg-slate-100"}`}
                  >
                    <div className={`font-black text-sm mb-1 ${importMode === "overwrite" ? "text-red-700" : "text-slate-700"}`}>⚠️ 覆盖模式</div>
                    <div className="text-[10px] text-slate-500 font-bold">清空所有现有素材再导入</div>
                  </button>
                </div>
              </div>

              {importStatus && (
                <div className={`p-3 rounded-xl text-xs font-bold ${importStatus.startsWith("✅") ? "bg-green-50 text-green-700 border border-green-200" : importStatus.startsWith("❌") ? "bg-red-50 text-red-700 border border-red-200" : "bg-slate-50 text-slate-600 border border-slate-200"}`}>
                  {importStatus}
                </div>
              )}
              
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 bg-yellow-500 hover:bg-yellow-400 text-slate-950 font-black rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-yellow-100"
              >
                <Upload className="w-4.5 h-4.5" /> 选择文件并导入
              </button>
              <p className="text-center text-[10px] text-slate-400 font-bold">提示：可先用「导出素材」获取标准格式模板</p>
            </div>
          </div>
        </div>
      )}

      {/* ====== 管理员共享配置弹窗 (Modal) ====== */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white border-2 border-slate-200 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5 relative animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-2 border-b-2 border-slate-100">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-purple-600" />
                {activeCategory === "review" ? "审批同意并分发共享" : "共享范围设置"}
              </h3>
              <button 
                onClick={() => {
                  setShowShareModal(false);
                  setShareTarget(null);
                  setEditingId(null);
                }} 
                className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-50 rounded-full transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <p className="text-xs text-slate-500 font-bold mb-2">
                  您正在为 {shareTargetIsFolder ? "📁 文件夹" : "📄 素材"}: <span className="text-slate-800 font-black">“{shareTarget?.name}”</span> 设置共享范围。
                </p>
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-2 uppercase">共享范围</label>
                <div className="grid grid-cols-3 gap-2">
                  {/* 审核状态下的同意不支持 NONE */}
                  {activeCategory !== "review" && (
                    <button
                      type="button"
                      onClick={() => { setShareType("NONE"); setShareTo([]); }}
                      className={`py-2.5 px-2 rounded-xl border-2 text-center text-xs font-black transition-all ${
                        shareType === "NONE" ? "border-slate-800 bg-slate-50 text-slate-800" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                      }`}
                    >
                      🔒 私有
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setShareType("SYSTEM"); setShareTo([]); }}
                    className={`py-2.5 px-2 rounded-xl border-2 text-center text-xs font-black transition-all ${
                      shareType === "SYSTEM" ? "border-purple-600 bg-purple-50 text-purple-700" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                    }`}
                  >
                    🌍 全员共享
                  </button>
                  <button
                    type="button"
                    onClick={() => setShareType("SPECIFIC")}
                    className={`py-2.5 px-2 rounded-xl border-2 text-center text-xs font-black transition-all ${
                      shareType === "SPECIFIC" ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                    }`}
                  >
                    👥 特定人员
                  </button>
                </div>
              </div>

              {shareType === "SPECIFIC" && (
                <div className="space-y-2">
                  <label className="block text-xs font-black text-slate-700 uppercase">选择共享的操作员 ({shareTo.length})</label>
                  <div className="border-2 border-slate-200 rounded-2xl max-h-48 overflow-y-auto p-3 bg-slate-50 divide-y divide-slate-100">
                    {systemUsers.length === 0 ? (
                      <p className="text-center text-xs text-slate-400 py-4 font-bold">暂无操作员用户</p>
                    ) : (
                      systemUsers.map((operator) => {
                        const isChecked = shareTo.includes(operator.id);
                        return (
                          <label key={operator.id} className="flex items-center gap-3 py-2 cursor-pointer hover:bg-white px-2 rounded-lg transition-colors">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setShareTo(shareTo.filter(id => id !== operator.id));
                                } else {
                                  setShareTo([...shareTo, operator.id]);
                                }
                              }}
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-black text-slate-900 truncate">{operator.name}</p>
                              <p className="text-[9px] text-slate-400 truncate">{operator.email}</p>
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowShareModal(false);
                    setShareTarget(null);
                    setEditingId(null);
                  }}
                  className="px-4 py-2 text-xs font-black text-slate-500 hover:text-slate-900"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={isLoading || (shareType === "SPECIFIC" && shareTo.length === 0)}
                  onClick={() => {
                    if (activeCategory === "review" && editingId) {
                      // 属于审批通过并分发
                      handleApprove(editingId, "APPROVE_ALL", shareTo);
                      setShowShareModal(false);
                      setEditingId(null);
                      setShareTarget(null);
                    } else {
                      handleShareSubmit();
                    }
                  }}
                  className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black disabled:opacity-50 shadow-md shadow-purple-100"
                >
                  确定
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====== 操作员克隆副本弹窗 (Modal) ====== */}
      {showCloneModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCloneSubmit} className="bg-white border-2 border-slate-200 rounded-3xl shadow-2xl w-full max-w-md p-6 space-y-5 relative animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center pb-2 border-b-2 border-slate-100">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Copy className="w-5 h-5 text-purple-600" /> 保存副本到我的素材库
              </h3>
              <button 
                type="button"
                onClick={() => {
                  setShowCloneModal(false);
                  setCloneTarget(null);
                }} 
                className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-50 rounded-full transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <p className="text-xs text-slate-500 font-bold">
                您将保存一份共享素材的副本到您个人的素材库中，保存后您可以对该副本进行自由编辑和删除。
              </p>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">副本素材名称</label>
                <input
                  required
                  type="text"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-black text-slate-950 focus:border-purple-600 focus:bg-white outline-none transition-all"
                  placeholder="例如：春节促销早安问候 (克隆副本)"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5 uppercase">保存至文件夹</label>
                <select
                  value={cloneFolderId}
                  onChange={(e) => setCloneFolderId(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-black text-slate-950 focus:border-purple-600 focus:bg-white outline-none transition-all h-[46px]"
                >
                  <option value="">-- 未分类 --</option>
                  {(() => {
                    const renderOptions = (parentId: string | null = null, depth = 0): React.ReactNode[] => {
                      // 仅获取个人拥有的文件夹作为归属选项
                      const children = folders.filter(f => (f.userId === currentUserId || !f.sharedType || f.sharedType === "NONE") && (f.parentId || null) === parentId);
                      return children.flatMap(f => [
                        <option key={f.id} value={f.id}>
                          {"\u00A0".repeat(depth * 4)}📁 {f.name}
                        </option>,
                        ...renderOptions(f.id, depth + 1)
                      ]);
                    };
                    return renderOptions(null, 0);
                  })()}
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setShowCloneModal(false);
                    setCloneTarget(null);
                  }}
                  className="px-4 py-2 text-xs font-black text-slate-500 hover:text-slate-900"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-black shadow-md shadow-purple-100"
                >
                  确认克隆保存
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
