# 🚀 V36 全新一键部署指南（Coolify + 内置 Evolution API）

> 目标：在一台 VPS 上新建一个**全新域名、全新数据库、内网自带 Evolution API** 的站点。
> 只有你的网站对公网开放，Evolution / Postgres / Redis 全部藏在 Docker 内网。
> 全程一次点击部署；别人拿到你的 GitHub 仓库也能照此一键起一套。

---

## 第 0 步：仓库里需要先就位的东西

我已经替你在仓库里放好/改好了下面这些（**这就是"一键部署"的地基**）：

| 文件 | 状态 | 作用 |
| :--- | :--- | :--- |
| [docker-compose.yml](docker-compose.yml) | 🆕 新建 | 全套服务定义：web + Evolution + Postgres + Redis，只有 web 开公网端口 |
| [.env.example](.env.example) | 🆕 新建 | 环境变量模板，值全部留空，由部署者生成 |
| [src/lib/authToken.ts](src/lib/authToken.ts) | 🆕 新建 | 内部令牌校验（常量时间比较、fail-closed） |
| [src/lib/evolutionConfig.ts](src/lib/evolutionConfig.ts) | 🆕 新建 | Evolution 配置解析：**环境变量优先**，收敛原来 4 份重复实现 |
| [src/lib/mediaSig.ts](src/lib/mediaSig.ts) | 🆕 新建 | 媒体中转的 HMAC 签名（Evolution 无会话也能安全取文件） |
| [src/app/api/health/route.ts](src/app/api/health/route.ts) | 🆕 新建 | 健康检查端点，容器/反代用 |
| [Dockerfile](Dockerfile) | ✏️ 已改 | `node:18 → node:20`；`public` 补 `--chown`；预建 `uploads` 与 `/app/data` |
| [src/lib/db.ts](src/lib/db.ts) | ✏️ 已改 | 支持 `DATA_DIR` 指向持久卷（否则 `data.json` 每次重部署都丢） |
| [next.config.ts](next.config.ts) | ✏️ 已改 | 恢复构建期类型检查（当前 0 错误） |
| [.gitignore](.gitignore) | ✏️ 已改 | 放行 `.env.example`；屏蔽 `data.json` 等含密钥文件与内部文档 |
| `scratch/`、`crm/`、调试接口、含密钥文件 | 🗑️ 已删除 | 见第 0.5 步；`crm/` 的三份说明手册已保留到 [docs/legacy-crm/](docs/legacy-crm/) |

**你需要做的 git 操作**（含密钥的文件已被删除，直接提交即可）：

```bash
git add -A
git commit -m "chore: 安全清理 + 一键部署栈（Coolify + 内置 Evolution API）"
git push
```

### ⚠️ 强烈建议：用一个全新的仓库，而不是在旧仓库上覆盖

原因：`.gitignore` 只能阻止**未来**的提交，**旧仓库的历史提交里那些密钥依然存在**（任何人 clone 后用 `git log -p` 就能翻出来）。

**推荐做法（零历史，最干净）**：
```bash
# 在 GitHub 上新建一个空仓库（例如 wa-pro-v2），不要勾选 README
git init
git add -A
git commit -m "init: Omniflow CRM v2（安全清理版）"
git branch -M main
git remote add origin https://github.com/你的用户名/wa-pro-v2.git
git push -u origin main
```

无论选哪种方式，下面这些**都必须轮换**（它们已经出现在旧仓库历史里）：
GitHub PAT、Notion 集成密钥、Cloudflare R2 的 AccessKey/SecretKey、VPS 上的 MySQL 密码、
以及**旧站 Evolution 的全局 API Key**（旧站若还在运行，尤其重要）。

---

## 第 0.5 步：安全加固（✅ 已完成，无需你操作）

仓库已经过一轮安全清理，新站上线即为"干净态"：

| 项目 | 状态 |
| :--- | :--- |
| 硬编码万能令牌（原 14 处） | ✅ 全部改为读 `process.env.CRON_TOKEN`，未配置即拒绝 |
| 入站 Webhook「不带 token 就放行」 | ✅ 改为严格校验，未配置 `WEBHOOK_TOKEN` 直接 500 |
| `AUTH_SECRET` 源码兜底值 | ✅ 移除，未配置时生产环境启动即报错 |
| `patch-db` 默认令牌 + 默认管理员密码 | ✅ 移除；管理员改由 `INITIAL_ADMIN_PASSWORD` 提供 |
| 无鉴权的调试/诊断/测试接口 | ✅ 全部删除（`debug*`、`diagnostic*`、`test-*`、`db-inspect`、旧 `trigger`） |
| 日志 / 受众 / Notion 缓存接口无鉴权 | ✅ 补登录校验 |
| 素材、文件夹越权删改（IDOR） | ✅ 全部加归属校验 |
| 实例 token 明文下发前端 | ✅ 只返回掩码，明文永不出服务端 |
| 媒体代理无鉴权 + 路径穿越 | ✅ 加签名/会话双通道鉴权 + 路径归一化 |
| `bulk-edit` SQL 注入 | ✅ JSON 路径改为绑定参数 |
| 上传 ffmpeg 命令注入 | ✅ `exec` → `execFile` + 扩展名白名单 |
| 含密钥的文件（PAT / Notion / R2 / 数据库密码 / 调试脚本） | ✅ 已从仓库删除 |
| 构建期类型检查被关闭 | ✅ 重新开启（`ignoreBuildErrors: false`，当前 **0 错误**） |

---

## 第 1 步：域名与 DNS

1. 准备一个新域名，例如 `wa2.yourdomain.com`（可以是你现有域名下的子域）。
2. 到域名商添加 **A 记录** 指向你的 VPS 公网 IP。
3. 等 1~5 分钟，确认解析生效：
   ```bash
   nslookup wa2.yourdomain.com
   ```
4. **先解析成功再去 Coolify 配域名**，否则自动签发 HTTPS 证书会失败。

---

## 第 2 步：Coolify 里新建 Project

1. 登录 Coolify → 左侧 **Projects** → **+ Add**
2. Name：`omniflow`（随便取）→ **Create**
3. 进入这个 Project，后面所有东西都建在它里面（**同一个 Project 才能走内网互通**）。

---

## 第 3 步：建一个全新的 MySQL（推荐用 Coolify 托管）

1. 在 Project 页面点 **+ New Resource** → **Database** → **MySQL**
2. Name：`omniflow-mysql`；版本选 **8.0**；设置 root 密码（点 🎲 生成）
3. **Deploy**，等状态变绿
4. 打开它的 **General / Connection** 面板，复制 **Internal** 连接串，形如：
   ```
   mysql://mysql:密码@omniflow-mysql:3306/default
   ```
5. 改造成你的 `DATABASE_URL`（**必须带 `?charset=utf8mb4`**，否则中文和 emoji 会出错）：
   ```
   mysql://mysql:密码@omniflow-mysql:3306/default?charset=utf8mb4
   ```
6. 顺手在这个 MySQL 的 **Backups** 页开启定时备份（这是你全部客户数据）。

> 如果你想让"任何人拿到代码包都能一键起"，就改用 [docker-compose.yml](docker-compose.yml) 里注释掉的 `db` 服务，把 `DATABASE_URL` 指向 `db:3306`。

---

## 第 4 步：建 Docker Compose 资源（网站 + Evolution）

1. 同一个 Project → **+ New Resource** → **Docker Compose**
2. **Source**：选 **GitHub App**（你之前绑过 GitHub，直接用）→ Repository：`DaveAng008/wa-pro`
3. **Branch**：`main`（或你实际的分支）
4. **Docker Compose Location**：`/docker-compose.yml` ← 必须对，这是仓库根目录
5. **Save**

Coolify 会自动识别出 4 个服务（web / evolution / evolution-db / evolution-redis）以及 5 个卷。

---

## 第 5 步：填环境变量

在 Compose 资源的 **Environment Variables** 页面，把 [.env.example](.env.example) 的内容整段粘进去（Coolify 支持 bulk paste / Developer view），然后逐个填：

| 变量 | 怎么填 |
| :--- | :--- |
| `APP_URL` | `https://wa2.yourdomain.com` |
| `DATABASE_URL` | 第 3 步拿到的内网连接串（带 `charset=utf8mb4`） |
| `AUTH_SECRET` | 点 🎲 生成（≥32 位）。**设定后永远不要改**，否则所有人被登出 |
| `EVOLUTION_API_KEY` | 点 🎲 生成 64 位十六进制。这是 Evolution 的全局 key |
| `EVO_DB_PASSWORD` | 点 🎲 生成（Evolution 自己 Postgres 的密码） |
| `WEBHOOK_TOKEN` | 点 🎲 生成（Evolution 回调本站的凭证，**必填**，不配就收不到消息） |
| `CRON_TOKEN` | 点 🎲 生成（定时任务与内部调用，**必填**，不配 cron 全部拒绝） |
| `DB_PATCH_TOKEN` | 点 🎲 生成（初始化数据库时要用，**记下来**） |
| `INITIAL_ADMIN_PASSWORD` | 自己设一个 ≥8 位的强密码（**首次初始化时创建管理员用**） |
| `INITIAL_ADMIN_EMAIL` | 你的登录邮箱（不改则默认 `admin@example.com`） |
| `ENCRYPTION_KEY` | 点 🎲 生成（媒体签名与后续实例 token 加密用） |
| `INTERNAL_BASE_URL` | 留空即可（自动用 `http://127.0.0.1:3000`） |
| `TZ` | `Asia/Kuala_Lumpur` |
| `WEB_PORT` | `3000`（不改也行） |

**把这 5 个值抄到一个安全的地方**：`AUTH_SECRET`、`EVOLUTION_API_KEY`、`EVO_DB_PASSWORD`、`DB_PATCH_TOKEN`、`CRON_TOKEN`。

---

## 第 6 步：只给 web 服务配域名

1. 在 Compose 资源里找到 **web** 服务 → **Domains** 输入框
2. 填 `https://wa2.yourdomain.com`，端口填 `3000`
3. **其他服务（evolution / evolution-db / evolution-redis）一律不要配域名** ← 这就是"藏进内网"的关键
4. 保存

> 如果 Coolify 提示 compose 服务需要加入反代网络才能被访问，就在 [docker-compose.yml](docker-compose.yml) 末尾追加：
> ```yaml
>   coolify:
>     external: true
> ```
> 并给 `web` 服务的 `networks` 加上 `coolify`。这是 502 的常见原因，见第 12 步排错。

---

## 第 7 步：部署

1. 点 **Deploy**
2. 看 **Logs**：
   * `evolution` 应该打印数据库连接成功、Redis 连接成功、监听 8080
   * `web` 应该打印 `Ready in ...`、`Local: http://localhost:3000`
3. 若失败，先看是不是 `evoapicloud/evolution-api:latest` 拉取失败（网络/Docker Hub 限速），重试一次。

**首次跑通后立刻做一件事**：把 compose 里的 `evoapicloud/evolution-api:latest` 改成具体版本号（去 Docker Hub 查当前可用 tag），避免以后被 `latest` 意外升级搞挂。

---

## 第 8 步：初始化数据库

浏览器访问（把 token 换成你的 `DB_PATCH_TOKEN`）：

```
https://wa2.yourdomain.com/api/patch-db?token=你的DB_PATCH_TOKEN
```

返回一段中文初始化报告（创建表、创建 `InstanceConfig`、初始化默认 AppSettings 行…）。

> 如果返回 `Unauthorized`：token 不对（要用你设置的 `DB_PATCH_TOKEN`）。
> 如果提示"跳过管理员初始化"：说明 `INITIAL_ADMIN_PASSWORD` 没配或少于 8 位，配好后重新访问一次本接口即可。

---

## 第 9 步：登录并立刻改密码

1. 访问 `https://wa2.yourdomain.com` → 用你设置的 `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` 登录
2. **马上**去 **用户管理** 改掉密码
3. 顺便创建你自己的运营账号，把 `maxInstances` 设为你要的号码数上限

---

## 第 10 步：确认三个内网地址（现在已自动生效）⭐

进入 **系统设置 → 通信 / Evolution 配置**，你会看到这三项。**它们现在由环境变量自动提供，正常情况无需手工填写**：

| 字段 | 值 | 说明 |
| :--- | :--- | :--- |
| Evolution API 地址 | `http://evolution:8080` | 由 `EVOLUTION_API_URL` 环境变量提供（compose 里已设） |
| Evolution API Key | `************` | 由 `EVOLUTION_API_KEY` 提供，**页面只显示掩码，保存时不会覆盖真实值** |
| Evolution Webhook 地址 | `http://web:3000/api/webhooks/whatsapp-incoming` | Evolution 回调本站，走内网 |

> 如果这三项是空的：说明 compose 里的 `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` 没注入成功，去检查环境变量即可。
> 只有当你对接的是**外部独立部署的 Evolution**（不在这个 compose 里）时，才需要手工在这里覆盖。

---

## 第 11 步：绑定第一个 WhatsApp 号码

1. **系统设置 → WhatsApp 实例管理 → 新增号码**
2. 填号码（例如 `60123456789`）→ 生成二维码
3. 手机 WhatsApp → **已关联的设备 → 关联设备** → 扫码
4. 弹窗会自动侦测到连接成功并关闭（5 秒轮询），卡片变成"已连接"

绑定成功后，实例的真实名字会形如 `usr_<你的用户ID>_<你输入的别名>` —— 这个前缀是多租户隔离的关键，别手动改。

---

## 第 12 步：端到端验收（6 条，全过才算成功）

| # | 验证 | 期望 |
| :--- | :--- | :--- |
| 1 | 访问 `/api/health` | `{"ok":true,...}` |
| 2 | 实例卡片 | 显示"已连接" |
| 3 | **手机向这个号码发一条消息** | CRM 看板出现一张新卡片，备注里有这条消息 |
| 4 | 素材库上传一张图片 | 上传成功、能预览（验证卷与权限） |
| 5 | **在 Coolify 点一次 Redeploy** | 重部署后：号码仍"已连接"、素材还在、受众配置还在 ← **这条最关键**，验证持久卷正确 |
| 6 | 从外部扫描 Evolution 端口 | 公网**无法**访问 Evolution（`curl http://VPS_IP:8080` 应超时/拒连） |

第 5 条如果失败（号码掉线），99% 是 `evolution_instances` 卷没生效 —— 检查它是挂在 `/evolution/instances`（**复数，很关键**）。

---

## 第 13 步：定时任务（群发调度）

Coolify → 该资源 → **Scheduled Tasks**，新增：

* **Command**：
  ```bash
  curl -fsS "http://web:3000/api/cron/campaigns" -H "Authorization: Bearer 你的CRON_TOKEN"
  ```
* **Frequency**：每分钟 `* * * * *`

> 令牌必须与你设置的 `CRON_TOKEN` 一致；未配置 `CRON_TOKEN` 时这些接口一律返回 401（设计如此）。

---

## 第 14 步：备份（别跳）

| 备份对象 | 怎么做 | 丢了会怎样 |
| :--- | :--- | :--- |
| MySQL | Coolify → 该数据库 → **Backups** → 开启定时备份 | 客户数据、活动、素材记录全没 |
| `evolution_instances` 卷 | 手动/脚本打包（见下） | **所有号码掉线，要重新扫码** |
| `uploads` 卷 | 同上 | 素材图片/语音全没 |
| `appdata` 卷 | 同上 | 受众配置、日志丢失 |

卷备份命令（先 `docker volume ls` 找到真实卷名，Coolify 通常带项目前缀）：

```bash
docker run --rm -v <卷名>:/data -v $(pwd):/backup alpine \
  tar czf /backup/$(date +%F)-<卷名>.tgz -C /data .
```

---

## 第 15 步：排错速查

| 现象 | 原因 | 处理 |
| :--- | :--- | :--- |
| 502 Bad Gateway | web 没起来 / 域名端口不对 / 反代找不到容器 | 看 web 日志；域名端口确认 `3000`；给 web 加 `coolify` 外部网络（第 6 步） |
| 设置页保存后提示"Evolution API 未配置" | 地址填成公网或 key 不一致 | 必须 `http://evolution:8080`，key 与 `EVOLUTION_API_KEY` 逐字符一致 |
| 素材上传报错/失败 | `public/uploads` 权限 | 确认 [Dockerfile](Dockerfile) 的 `--chown` 与 `mkdir` 已生效、compose 的 `uploads` 卷挂在 `/app/public/uploads` |
| 收不到客户来信 | webhook 地址写成公网、或密钥不符 | 第 10 步改成 `http://web:3000/api/webhooks/whatsapp-incoming`，然后**重新保存一次实例卡片**触发重新注册 |
| 重部署后号码全掉线 | 登录态卷没挂对 | 卷必须挂 `/evolution/instances` |
| 日志里中文乱码 | `DATABASE_URL` 缺 charset | 加 `?charset=utf8mb4` |
| Coolify 日志报卷权限 | 卷由 root 创建 | 已由 Dockerfile 的 `mkdir + chown` 解决；若仍报错，重建卷 |
| Evolution 起不来 | `DATABASE_CONNECTION_URI` 里密码含特殊字符未转义 | 用纯十六进制密码（🎲 生成的即是） |

---

## 第 16 步：老站数据怎么搬（新站是全新库，不会自动过去）

| 数据 | 搬法 |
| :--- | :--- |
| 联系人 | 老站「联系人」→ 导出 Excel → 新站「导入 Excel」 |
| 素材文案 | 老站「素材库」→ 导出 xlsx/txt → 新站导入 |
| **素材的图片/语音文件** | 导出文件里**不含**媒体本体，要从老容器拷：<br>`docker cp <老web容器>:/app/public/uploads ./uploads_backup`<br>`docker run --rm -v <新uploads卷>:/data -v $(pwd)/uploads_backup:/src alpine cp -a /src/. /data/` |
| 受众配置 / 日志 | 老容器 `/app/data.json`（或仓库根目录的 `data.json`）→ 放进新 `appdata` 卷（可选） |
| 活动 / 自动规则 | **需要重建**（关联了素材 id 与数据源 id，直接导库会错位） |

**老站先别关**，等新站跑稳一周再下线。

---

## 一页速查：三个内网地址

```
网站  → Evolution :  http://evolution:8080
Evolution → 网站  :  http://web:3000/api/webhooks/whatsapp-incoming
网站  → MySQL     :  mysql://...@omniflow-mysql:3306/default?charset=utf8mb4
```

记住一个原则：**凡是 `http://服务名:端口` 形式的就是内网地址，永远不要换成公网域名。**

---

## 附：要不要走 Coolify 自带的 Evolution 一键服务？

Coolify 官方有 Evolution API 服务模板（会自动装 Evolution + Postgres + Redis + Manager），见 [Coolify Docs · Evolution API](https://next.coolify.io/docs/services/evolution-api)。

| | 自带模板 | 本指南的 compose（推荐） |
| :--- | :--- | :--- |
| 上手速度 | 最快（点一下就有） | 需要先提交 compose 文件 |
| 内网地址 | 由 Coolify 生成，可能随重建变化 | **服务名固定**：`evolution:8080`，永不变 |
| 是否暴露 Manager 公网页 | 模板默认给你一个 `/manager` 公网入口 | 没有任何公网入口 |
| 版本控制 | 跟 Coolify 模板走 | 钉在你自己仓库里 |
| 可交付给别人 | 需要对方也在 Coolify 点模板 | 仓库自带，`docker compose up -d` 即可 |

**建议**：想 5 分钟先验证链路，可以先用官方模板跑通；但**正式站和要交付的版本，用本指南的 compose**。
