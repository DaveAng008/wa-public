"use client";

type FetchOptions = RequestInit & {
  timeout?: number;
};

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorData: { error?: string; code?: string } = {};
    try {
      errorData = await res.json();
    } catch {}
    throw new ApiError(
      errorData.error || `请求失败 (${res.status})`,
      res.status,
      errorData.code
    );
  }
  return res.json();
}

async function apiClient<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { timeout = 10000, ...fetchOptions } = options;

  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...fetchOptions.headers,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(endpoint, {
      ...fetchOptions,
      headers,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return handleResponse<T>(res);
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") {
      throw new ApiError("请求超时", 408);
    }
    throw err;
  }
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export const authApi = {
  login: (email: string, password: string) =>
    apiClient<{ token: string; user: { id: string; name: string; email: string; role: "admin" | "operator" } }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  register: (data: { name: string; email: string; password: string }) =>
    apiClient<{ token: string; user: { id: string; name: string; email: string; role: "admin" | "operator" } }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  me: () =>
    apiClient<{ id: string; name: string; email: string; role: "admin" | "operator" }>("/api/auth/session"),
};

// ─── Campaigns ─────────────────────────────────────────────────────────────

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED";
  notionDbId?: string;
  notionDatabaseId?: string;
  n8nWebhookUrl?: string;
  groupId?: string;
  materialId?: string;
  scheduleConfig?: any;
  useAi?: boolean | number;
  useRandom?: boolean | number;
  aiPrompt?: string;
  aiModel?: string;
  sourceId?: string;
  instanceName?: string;
  contactCount: number;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; name: string; email: string };
  _count?: { sendLogs: number; groups: number };
}

export const campaignsApi = {
  list: () => apiClient<Campaign[]>("/api/campaigns"),

  get: (id: string) => apiClient<Campaign>(`/api/campaigns/${id}`),

  create: (data: { name: string; description?: string; notionDbId?: string; notionDatabaseId?: string; n8nWebhookUrl?: string; groupId?: string; sourceId?: string }) =>
    apiClient<Campaign>("/api/campaigns", { method: "POST", body: JSON.stringify(data) }),

  update: (id: string, data: { name?: string; description?: string; status?: string; notionDbId?: string; notionDatabaseId?: string; n8nWebhookUrl?: string; groupId?: string; materialId?: string; scheduleConfig?: any; useAi?: boolean | number; useRandom?: boolean | number; aiPrompt?: string; aiModel?: string; sourceId?: string; instanceName?: string; }) =>
    apiClient<Campaign>(`/api/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  delete: (id: string) => apiClient<{ success: boolean }>(`/api/campaigns/${id}`, { method: "DELETE" }),

  // Maps to backend /trigger, not /send
  trigger: (id: string, groupId?: string, batchRound?: number, batchSize?: number) =>
    apiClient<{ success: boolean; message: string; campaignId: string }>(`/api/campaigns/${id}/trigger`, {
      method: "POST",
      body: JSON.stringify({ groupId, batchRound, batchSize }),
    }),

  stats: (id: string) =>
    apiClient<{
      campaignId: string;
      total: number;
      sent: number;
      failed: number;
      pending: number;
      successRate: number;
      recentLogs: Array<{
        id: string;
        phone: string;
        message: string;
        status: string;
        sentAt: string | null;
        error: string | null;
        createdAt: string;
      }>;
    }>(`/api/campaigns/${id}/stats`),
};

// ─── Contacts ────────────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  phone: string;
  market?: string;
  relation?: string;
  sent: boolean;
  responded: boolean;
  lastSentAt?: string;
  properties?: any;
  updatedAt?: string;
  sendCount?: number;
  sourceId?: string;
  isHistoricallyBlacklisted?: boolean | number;
}

export const contactsApi = {
  list: (params?: {
    page?: number;
    limit?: number;
    campaignId?: string;
    market?: string;
    markets?: string;
    relation?: string;
    relations?: string;
    matchMode?: string;
    ruleMatchMode?: string;
    sent?: string;
    responded?: string;
    rules?: any[];
    sourceId?: string;
  }) => {
    const p = new URLSearchParams();
    if (params?.page) p.set("page", String(params.page));
    if (params?.limit) p.set("limit", String(params.limit));
    if (params?.campaignId) p.set("campaignId", params.campaignId);
    if (params?.market) p.set("market", params.market);
    if (params?.markets) p.set("markets", params.markets);
    if (params?.relation) p.set("relation", params.relation);
    if (params?.relations) p.set("relations", params.relations);
    if (params?.matchMode) p.set("matchMode", params.matchMode);
    if (params?.ruleMatchMode) p.set("ruleMatchMode", params.ruleMatchMode);
    if (params?.sent) p.set("sent", params.sent);
    if (params?.responded) p.set("responded", params.responded);
    if (params?.rules) p.set("rules", JSON.stringify(params.rules));
    if (params?.sourceId) p.set("sourceId", params.sourceId);
    const qs = p.toString();
    return apiClient<{ contacts: Contact[]; total: number; hasMore: boolean; nextCursor?: string }>(
      `/api/contacts${qs ? `?${qs}` : ""}`
    );
  },

  sync: (purge?: boolean, payload?: any) => apiClient<{ success: boolean; synced: number; updatedAt: string }>(`/api/contacts/sync${purge ? '?purge=true' : ''}`, { 
    method: "POST",
    timeout: 180000, // 同步接口允许 3 分钟超时
    body: payload ? JSON.stringify(payload) : undefined
  }),

  blacklist: (phone: string, reason: string) =>
    apiClient<{ success: boolean }>("/api/contacts/blacklist", {
      method: "POST",
      body: JSON.stringify({ phone, reason }),
    }),

  updateField: (contactIds: string[], field: string, value: any) =>
    apiClient<{ success: boolean }>("/api/contacts", {
      method: "PATCH",
      body: JSON.stringify({ contactIds, field, value }),
    }),

  bulkEdit: (payload: {
    field: string;
    value: any;
    editMode?: "OVERWRITE" | "APPEND" | "ADD_PREFIX" | "REMOVE_PREFIX";
    markets?: string[];
    relations?: string[];
    matchMode?: string;
    ruleMatchMode?: string;
    sent?: string;
    rules?: any[];
    sourceId?: string;
    targetValues?: string[];
  }) =>
    apiClient<{ success: boolean; updatedCount: number }>("/api/contacts/bulk-edit", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

// ─── Blacklist ───────────────────────────────────────────────────────────────

export interface BlacklistEntry {
  id: string;
  phone: string;
  name?: string;
  reason: string;
  addedBy: { id: string; name: string };
  createdAt: string;
}

export const blacklistApi = {
  list: () => apiClient<BlacklistEntry[]>("/api/contacts/blacklist"),

  add: (phone: string, reason: string, name?: string) =>
    apiClient<BlacklistEntry>("/api/contacts/blacklist", { method: "POST", body: JSON.stringify({ phone, reason, name }) }),

  addBatch: (contacts: Array<{ phone: string; name?: string; reason?: string }>) =>
    apiClient<{ success: boolean }>("/api/contacts/blacklist", { method: "POST", body: JSON.stringify({ contacts }) }),

  delete: (phone: string) => apiClient<{ success: boolean }>(`/api/contacts/blacklist?phone=${encodeURIComponent(phone)}`, { method: "DELETE" }),
  deleteById: (id: string) => apiClient<{ success: boolean }>(`/api/contacts/blacklist?id=${id}`, { method: "DELETE" }),

  deleteBatch: (ids: string[], permanent?: boolean) =>
    apiClient<{ success: boolean }>(`/api/contacts/blacklist?id=${ids.join(",")}${permanent ? "&permanent=true" : ""}`, { method: "DELETE" }),

  clearHistoryBatch: (ids: string[]) =>
    apiClient<{ success: boolean }>(`/api/contacts/blacklist?id=${ids.join(",")}&history=true`, { method: "DELETE" }),
};

// ─── Reports ────────────────────────────────────────────────────────────────

export interface DailyStats {
  date: string;
  sent: number;
  success: number;
  failed: number;
  responded: number;
}

export interface CampaignStats {
  campaignId: string;
  campaignName: string;
  sent: number;
  success: number;
  failed: number;
}

export interface HeatmapCell {
  dayOfWeek: number;
  hour: number;
  count: number;
}

export const reportsApi = {
  dailyStats: (days = 30) => apiClient<DailyStats[]>(`/api/reports/daily?days=${days}`),

  campaignComparison: () => apiClient<CampaignStats[]>("/api/reports/campaign-comparison"),

  successRate: () => apiClient<{ success: number; failed: number }>("/api/reports/success-rate"),

  heatmap: () => apiClient<HeatmapCell[]>("/api/reports/heatmap"),
};

// ─── Users ──────────────────────────────────────────────────────────────────

export interface SystemUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator";
  maxInstances?: number;
  kanbanEnabled?: boolean;
  automationsEnabled?: boolean;
  createdAt: string;
}

export const usersApi = {
  list: () => apiClient<SystemUser[]>("/api/users"),

  create: (data: { name: string; email: string; password: string; role: "admin" | "operator"; maxInstances?: number; kanbanEnabled?: boolean; automationsEnabled?: boolean }) =>
    apiClient<SystemUser>("/api/users", { method: "POST", body: JSON.stringify(data) }),

  update: (id: string, data: { name?: string; email?: string; password?: string; role?: "admin" | "operator"; maxInstances?: number; kanbanEnabled?: boolean; automationsEnabled?: boolean }) =>
    apiClient<SystemUser>(`/api/users?id=${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  delete: (id: string) => apiClient<{ success: boolean }>(`/api/users?id=${id}`, { method: "DELETE" }),
};

// ─── Settings ───────────────────────────────────────────────────────────────

export interface SystemSettings {
  scheduledTime: string;
  maxSendLimit: number;
  minDelay: number;
  maxDelay: number;
  n8nWebhookUrl: string;
  notionSecret: string;
  notionDatabaseId?: string;
  notionSyncWebhookUrl?: string;
  n8nAiRewriteWebhookUrl?: string;
  n8nAiAnalyzeWebhookUrl?: string;
  n8nBindInstanceWebhookUrl?: string;
  evolutionApiUrl?: string;
  evolutionApiKey?: string;
  evolutionWebhookUrl?: string;
  hubWebhookUrl?: string;
  hubWebhookToken?: string;
  whatsappSyncConfig?: string;
  whatsappSyncTime?: string;
  whatsappSyncEnabled?: number;
  whatsappAutoSyncInstances?: string;
  notificationPhone?: string;
  maxInstances?: number;
  apiKeys?: {
    openai?: string;
    deepseek?: string;
    gemini?: string;
  };
  aiSpeechToTextEnabled?: number;
  aiVisionEnabled?: number;
  aiVisionPrompt?: string;
  aiRoutingEnabled?: number;
  aiRoutingConfig?: string;
  aiNoiseFilterEnabled?: number;
  groupMonitorEnabled?: number;
  groupTargetStepId?: string;
  customHookUrl?: string;
}

export const settingsApi = {
  get: () => apiClient<SystemSettings>("/api/settings"),

  save: (data: SystemSettings) =>
    apiClient<{ success: boolean }>("/api/settings", { method: "POST", body: JSON.stringify(data) }),
};

// ─── Groups ──────────────────────────────────────────────────────────────────

export const groupsApi = {
  list: () => apiClient<any[]>("/api/groups"),
  create: (data: { name: string; filterConfig: any }) =>
    apiClient<{ success: boolean; id: string }>("/api/groups", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// ─── Dashboard ──────────────────────────────────────────────────────────────

export const dashboardApi = {
  overview: () =>
    apiClient<{
      todaySent: number;
      totalSent: number;
      activeCampaigns: number;
      onlineAccounts: number;
      recentActivity: Array<{
        id: string;
        type: "sent" | "failed" | "responded";
        contactName: string;
        campaignName: string;
        message: string;
        timestamp: string;
      }>;
      activeJob?: {
        campaignId: string;
        campaignName: string;
        total: number;
        sent: number;
        remaining: number;
        failed?: number;
        responded?: number;
      } | undefined;
    }>("/api/dashboard/overview"),
};

// ─── Materials ──────────────────────────────────────────────────────────────

export interface Material {
  id: string;
  name: string;
  type: "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT" | "RANDOM_GROUP";
  content: string | null;
  url: string | null;
  folderId?: string | null;
  createdAt: string;
}

export interface MaterialFolder {
  id: string;
  name: string;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const materialFoldersApi = {
  list: () => apiClient<MaterialFolder[]>("/api/material-folders"),
  create: (data: { name: string, parentId?: string | null }) => apiClient<MaterialFolder>("/api/material-folders", { method: "POST", body: JSON.stringify(data) }),
  update: (id: string, data: { name: string, parentId?: string | null }) => apiClient<MaterialFolder>(`/api/material-folders/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  delete: (id: string) => apiClient<{ success: boolean }>(`/api/material-folders/${id}`, { method: "DELETE" }),
};

export const materialsApi = {
  list: () => apiClient<Material[]>("/api/materials"),
  create: (data: Partial<Material>) =>
    apiClient<{ success: boolean; id: string }>("/api/materials", { method: "POST", body: JSON.stringify(data) }),
  delete: (id: string) => apiClient<{ success: boolean }>(`/api/materials/${id}`, { method: "DELETE" }),
};

export { ApiError };