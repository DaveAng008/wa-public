# Omniflow CRM · WhatsApp 自动化营销与客服平台

多租户的 WhatsApp 群发 + CRM 系统：联系人管理、可视化看板、自动回复规则、多轮群发调度、
素材库、数据报表，全部跑在 Next.js 上，自带 Evolution API（内网），**一条命令即可部署**。

---

## 一键部署（Coolify / Docker）

```bash
cp .env.example .env    # 填入你自己的密钥（全部由你生成）
docker compose up -d
```

只有 `web` 服务对公网暴露端口，Evolution / Postgres / Redis 全部在 Docker 内网，
网站通过 `http://evolution:8080` 访问 WhatsApp 引擎，外部无法直达。

**在 Coolify 上部署**：新建资源 → **Docker Compose** → 选择本仓库 → Compose 路径 `/docker-compose.yml`。
完整图文步骤见 **[V36_一键部署指南_Coolify.md](V36_一键部署指南_Coolify.md)**。

首次部署后访问 `https://你的域名/api/patch-db?token=你的DB_PATCH_TOKEN` 初始化数据库结构，
再用 `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` 登录（**登录后请立即改密码**）。

---

## 必备环境变量

| 变量 | 说明 |
| :--- | :--- |
| `DATABASE_URL` | MySQL 连接串，**必须带 `?charset=utf8mb4`** |
| `AUTH_SECRET` | 登录会话密钥，≥32 位随机串，**设定后不要再改** |
| `EVOLUTION_API_KEY` | Evolution 全局 API Key（网站与 Evolution 共用同一个值） |
| `EVO_DB_PASSWORD` | Evolution 自带 Postgres 的密码 |
| `WEBHOOK_TOKEN` | Evolution 回调本站的凭证（**必填**，否则收不到消息） |
| `CRON_TOKEN` | 定时任务与内部调用令牌（**必填**，否则 cron 全部拒绝） |
| `DB_PATCH_TOKEN` | 数据库初始化接口的令牌 |
| `INITIAL_ADMIN_PASSWORD` | 首次初始化时创建管理员的密码（不配则不创建任何账号） |
| `ENCRYPTION_KEY` | 媒体签名 / 实例凭证加密密钥 |

其余可选变量见 [.env.example](.env.example)。

> 所有密钥都必须由部署环境生成，仓库里**没有任何默认值**：
> 未配置 `WEBHOOK_TOKEN` / `CRON_TOKEN` 时相关接口一律拒绝请求（fail closed）。

---

## 功能概览

| 模块 | 能力 |
| :--- | :--- |
| 联系人中心 | 多条件 + 自定义 JSON 字段规则筛选、内联编辑、批量改字段、Excel 导入导出、WhatsApp 实例同步、Notion 双向同步、多源智能去重合并 |
| CRM 看板 | 拖拽流转、多视图（数据源 / 流入实例 / SLA / 共享）、AI 选人建活动 |
| 自动规则 | When-If-Then 规则引擎、11 种动作节点、AI 意图分流、Whisper 语音转写、GPT-4o Vision 图片解读、客服轮询分配、外部 Webhook 双向指令 |
| 营销活动 | 多轮次调度、星期顺延、排程预测大盘、素材连招 + 随机延迟、随机选词、AI 改写、24 小时限额 |
| 素材库 | 6 种素材类型（含随机文本组）、多级文件夹、在线录音、ffmpeg 转 OGG/Opus 语音条、审核与共享、导入导出 |
| 数据报表 | 每日趋势、活动对比、成功率、发送时段热力图 |
| 系统设置 | WhatsApp 实例管理（扫码 / 8 位配对码 / 就地重连）、实例流向策略、AI 开关与个人密钥、通知模板 |

---

## 技术栈

* Next.js 15（App Router）+ React 19 + TypeScript
* MySQL 8（业务数据）+ PostgreSQL 16 / Redis 7（Evolution 专用，随 compose 提供）
* NextAuth v5（Credentials + JWT）
* Evolution API（WhatsApp 引擎，内网部署）
* Tailwind CSS 4

---

## 本地开发

```bash
npm install                 # 或 npm ci
cp .env.example .env        # 至少填 DATABASE_URL、AUTH_SECRET、WEBHOOK_TOKEN、CRON_TOKEN
npm run dev                 # http://localhost:3000
```

类型检查：`npx tsc --noEmit`

---

## 数据持久化（重要）

容器化的部署有三个必须挂持久卷的目录，否则重新部署会丢数据：

| 卷 | 内容 | 丢了会怎样 |
| :--- | :--- | :--- |
| `uploads` → `/app/public/uploads` | 素材图片 / 语音 | 素材文件永久丢失 |
| `appdata` → `/app/data` | `data.json`（受众配置、日志、Notion 缓存） | 配置重置 |
| `evolution_instances` → `/evolution/instances` | 每个号码的登录态 | **所有号码掉线，需要重新扫码** |

`docker-compose.yml` 已全部配置好，请勿删除这些卷。

---

## 目录结构

```
src/app/            App Router 页面与 API
src/lib/            公共库（数据库、令牌校验、Evolution 配置、媒体签名）
docs/internal/      内部审计与设计文档（已 gitignore，不随仓库发布）
docs/legacy-crm/    旧版 CRM 的说明手册（代码已移除）
docker-compose.yml  一键部署栈
```

---

## 关于 vendor/ 目录（供应链安全）

`vendor/xlsx-0.20.3.tgz` 是 **SheetJS 官方发布**的 xlsx 0.20.3 包。

npm 官方源上的 `xlsx` 包停留在 **0.18.5**（带已知原型污染漏洞），SheetJS 已把发布渠道迁移到自家 CDN，
官方文档明确建议把 tarball **vendoring**（放进仓库）以降低供应链风险、并支持离线构建：

* `package.json`：`"xlsx": "file:vendor/xlsx-0.20.3.tgz"`
* SHA-256：`8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
* 来源：https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz

> ⚠️ `Dockerfile` 中 `COPY vendor ./vendor` 必须位于 `npm ci` **之前**，否则构建会因为找不到本地依赖而失败。

---

## 安全说明

* 所有内部令牌来自环境变量，源码中**不存在任何默认令牌或默认密码**
* 多租户隔离基于实例名前缀 `usr_<userId>_<别名>` 与数据库归属双重校验
* 实例 token、Notion 密钥、Hub 令牌等**只存服务端**，接口只返回掩码
* 上传经过扩展名白名单 + `execFile` 调用，无命令注入面
* 媒体中转需 HMAC 签名或登录会话，且做了路径穿越防护
