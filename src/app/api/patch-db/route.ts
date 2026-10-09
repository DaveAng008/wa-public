import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { safeEqual } from "@/lib/authToken";
import { auth } from "@/auth";

if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("charset=")) {
  const url = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.includes("?") ? `${url}&charset=utf8mb4` : `${url}?charset=utf8mb4`;
}

function generateId() {
  return "cmc" + Math.random().toString(36).slice(2, 22);
}

export async function GET(req: Request) {
  // 安全权限检查
  const session = await auth();
  const url = new URL(req.url);
  const tokenParam = url.searchParams.get("token");
  
  // 必须是管理员，或者带上合法的 DB_PATCH_TOKEN
  // 未配置 DB_PATCH_TOKEN 时，token 通道一律关闭（源码中不留任何默认值）
  const isAdmin = session?.user?.role?.toUpperCase() === "ADMIN";
  const expectedPatchToken = (process.env.DB_PATCH_TOKEN || "").trim();
  const isValidToken = !!expectedPatchToken && !!tokenParam && safeEqual(tokenParam, expectedPatchToken);

  if (!isAdmin && !isValidToken) {
    return NextResponse.json({ error: "Unauthorized: Admin access required or invalid token" }, { status: 401 });
  }

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const results: string[] = [];

    // ─── 诊断：显示当前连接的数据库及已存在的表 ───────────────────
    try {
      const [dbRow]: any = await conn.execute("SELECT DATABASE() as currentDb");
      const currentDb = dbRow[0]?.currentDb || "(null)";
      results.push(`🔍 当前连接数据库: ${currentDb}`);

      const [tableRows]: any = await conn.execute("SHOW TABLES");
      const tableKey = `Tables_in_${currentDb}`;
      const existingTables = tableRows.map((r: any) => Object.values(r)[0]);
      results.push(`🔍 已存在的表: ${existingTables.join(", ") || "(无)"}`);
    } catch (e: any) {
      results.push(`🔍 诊断失败: ${e.message}`);
    }
    // ──────────────────────────────────────────────────────────────

    // 0. 创建 User 表 (确保先于其他可能有关联的表存在)
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS User (
          id VARCHAR(191) PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          email VARCHAR(191) UNIQUE NOT NULL,
          passwordHash VARCHAR(191) NOT NULL,
          role VARCHAR(50) NOT NULL DEFAULT 'OPERATOR',
          apiKeys JSON DEFAULT NULL,
          maxInstances INT DEFAULT 1,
          kanbanEnabled TINYINT(1) DEFAULT 0,
          automationsEnabled TINYINT(1) DEFAULT 0,
          createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created User table ✅");
    } catch (e: any) { results.push(`User table failed: ${e.message}`); }

    // 0.1 创建 AppSettings 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS AppSettings (
          id VARCHAR(191) PRIMARY KEY DEFAULT 'default',
          scheduledTime VARCHAR(191) NOT NULL DEFAULT '09:35',
          maxSendLimit INT NOT NULL DEFAULT 150,
          minDelay INT NOT NULL DEFAULT 140,
          maxDelay INT NOT NULL DEFAULT 190,
          n8nWebhookUrl VARCHAR(191) DEFAULT NULL,
          notionSecret VARCHAR(191) NOT NULL DEFAULT '',
          notionDatabaseId VARCHAR(191) NOT NULL DEFAULT '',
          userId VARCHAR(191) DEFAULT NULL,
          notionSyncWebhookUrl VARCHAR(255) DEFAULT NULL,
          lastReverseSyncAt DATETIME DEFAULT NULL,
          n8nAiRewriteWebhookUrl VARCHAR(255) DEFAULT NULL,
          n8nAiAnalyzeWebhookUrl VARCHAR(255) DEFAULT NULL,
          latestAiAnalysis LONGTEXT DEFAULT NULL,
          latestAiAnalysisTime DATETIME DEFAULT NULL,
          n8nBindInstanceWebhookUrl VARCHAR(255) DEFAULT NULL,
          evolutionApiUrl VARCHAR(255) DEFAULT NULL,
          evolutionApiKey VARCHAR(255) DEFAULT NULL,
          whatsappSyncConfig TEXT DEFAULT NULL,
          whatsappSyncTime VARCHAR(191) DEFAULT '03:00',
          whatsappSyncEnabled TINYINT(1) DEFAULT 0,
          whatsappAutoSyncInstances TEXT DEFAULT NULL,
          notificationPhone VARCHAR(50) DEFAULT NULL,
          updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created AppSettings table ✅");

      // 插入默认数据
      await conn.execute(`
        INSERT IGNORE INTO AppSettings (id, scheduledTime, maxSendLimit, minDelay, maxDelay, notionSecret, notionDatabaseId)
        VALUES ('default', '09:35', 150, 140, 190, '', '')
      `);
      results.push("Initialized default AppSettings row ✅");
    } catch (e: any) { results.push(`AppSettings table failed: ${e.message}`); }

    // 0.2 创建 Blacklist 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS Blacklist (
          id VARCHAR(191) PRIMARY KEY,
          phone VARCHAR(191) NOT NULL,
          name VARCHAR(191) DEFAULT NULL,
          reason VARCHAR(191) DEFAULT NULL,
          addedById VARCHAR(191) NOT NULL,
          userId VARCHAR(191) DEFAULT NULL,
          createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created Blacklist table ✅");
      
      // 为存量数据增加 name 字段
      try {
        await conn.execute("ALTER TABLE Blacklist ADD COLUMN name VARCHAR(191) DEFAULT NULL AFTER phone");
        results.push("Added name column to Blacklist ✅");
      } catch (alterErr) {
        // Ignored if column already exists
      }
    } catch (e: any) { results.push(`Blacklist table failed: ${e.message}`); }

    // 0.3 创建 Campaign 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS Campaign (
          id VARCHAR(191) PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          description VARCHAR(191) DEFAULT NULL,
          groupId VARCHAR(191) DEFAULT NULL,
          materialId VARCHAR(191) DEFAULT NULL,
          sourceId VARCHAR(191) DEFAULT NULL,
          scheduleConfig JSON DEFAULT NULL,
          useAi TINYINT(1) DEFAULT 0,
          useRandom TINYINT(1) DEFAULT 0,
          aiPrompt TEXT DEFAULT NULL,
          aiModel VARCHAR(50) DEFAULT 'gpt-4o-mini',
          contactCount INT DEFAULT 0,
          notionDatabaseId VARCHAR(191) DEFAULT NULL,
          n8nWebhookUrl VARCHAR(191) DEFAULT NULL,
          status ENUM('DRAFT','ACTIVE','PAUSED') NOT NULL DEFAULT 'DRAFT',
          ownerId VARCHAR(191) NOT NULL,
          userId VARCHAR(191) DEFAULT NULL,
          createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created Campaign table ✅");
    } catch (e: any) { results.push(`Campaign table failed: ${e.message}`); }

    // 0.4 创建 CampaignGroup 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS CampaignGroup (
          campaignId VARCHAR(191) NOT NULL,
          groupId VARCHAR(191) NOT NULL,
          PRIMARY KEY (campaignId, groupId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created CampaignGroup table ✅");
    } catch (e: any) { results.push(`CampaignGroup table failed: ${e.message}`); }

    // 0.5 创建 Contact 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS Contact (
          id VARCHAR(191) NOT NULL,
          name VARCHAR(191) NOT NULL,
          phone VARCHAR(191) NOT NULL,
          market VARCHAR(191) DEFAULT NULL,
          relation VARCHAR(191) DEFAULT NULL,
          properties LONGTEXT DEFAULT NULL,
          sent TINYINT(1) DEFAULT 0,
          responded TINYINT(1) DEFAULT 0,
          sendCount INT DEFAULT 0,
          lastSentAt DATETIME(3) DEFAULT NULL,
          groupId VARCHAR(191) DEFAULT NULL,
          sourceId VARCHAR(191) DEFAULT NULL,
          userId VARCHAR(191) NOT NULL,
          createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          PRIMARY KEY (id, userId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created Contact table ✅");
    } catch (e: any) { results.push(`Contact table failed: ${e.message}`); }

    // 0.6 创建 Group 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS \`Group\` (
          id VARCHAR(191) PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          description VARCHAR(191) DEFAULT NULL,
          filterConfig LONGTEXT DEFAULT NULL,
          campaignId VARCHAR(191) NOT NULL,
          contactIds VARCHAR(191) NOT NULL,
          userId VARCHAR(191) DEFAULT NULL,
          createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          updatedAt DATETIME(3) DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created Group table ✅");
    } catch (e: any) { results.push(`Group table failed: ${e.message}`); }

    // 0.7 创建 SendLog 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS SendLog (
          id VARCHAR(191) PRIMARY KEY,
          campaignId VARCHAR(191) NOT NULL,
          phone VARCHAR(191) NOT NULL,
          message TEXT DEFAULT NULL,
          status ENUM('PENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
          sentAt DATETIME(3) DEFAULT NULL,
          response VARCHAR(191) DEFAULT NULL,
          error VARCHAR(191) DEFAULT NULL,
          userId VARCHAR(191) DEFAULT NULL,
          createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created SendLog table ✅");
    } catch (e: any) { results.push(`SendLog table failed: ${e.message}`); }

    // 0.7.1 创建 ContactStep 表 (看板阶段表)
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS ContactStep (
          id VARCHAR(191) PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          color VARCHAR(50) DEFAULT '#3b82f6',
          orderIndex DOUBLE DEFAULT 0,
          automationConfig JSON DEFAULT NULL,
          userId VARCHAR(191) NOT NULL,
          createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created ContactStep table ✅");
    } catch (e: any) { results.push(`ContactStep table failed: ${e.message}`); }

    // 0.8 创建 Session 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS Session (
          id VARCHAR(191) PRIMARY KEY,
          sessionToken VARCHAR(191) NOT NULL,
          userId VARCHAR(191) NOT NULL,
          expires DATETIME(3) NOT NULL,
          UNIQUE KEY Session_sessionToken_key (sessionToken)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created Session table ✅");
    } catch (e: any) { results.push(`Session table failed: ${e.message}`); }

    // 1. 创建 Material 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS Material (
          id VARCHAR(191) PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          type VARCHAR(50) NOT NULL,
          content TEXT,
          url VARCHAR(1000),
          folderId VARCHAR(191) DEFAULT NULL,
          userId VARCHAR(191) DEFAULT NULL,
          sharedType VARCHAR(50) DEFAULT 'NONE',
          sharedTo TEXT DEFAULT NULL,
          createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created Material table ✅");
    } catch (e: any) { results.push(`Material table failed: ${e.message}`); }

    // 1.1 创建 MaterialFolder 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS MaterialFolder (
          id VARCHAR(191) PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          userId VARCHAR(191) NOT NULL,
          parentId VARCHAR(191) DEFAULT NULL,
          sharedType VARCHAR(50) DEFAULT 'NONE',
          sharedTo TEXT DEFAULT NULL,
          createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created MaterialFolder table ✅");
    } catch (e: any) { results.push(`MaterialFolder table failed: ${e.message}`); }

    // 1.1.1 为已有 MaterialFolder 表增加 parentId (嵌套文件夹)
    try {
      await conn.execute("ALTER TABLE MaterialFolder ADD COLUMN parentId VARCHAR(191) DEFAULT NULL AFTER userId");
      results.push("Added parentId to MaterialFolder ✅");
    } catch (e: any) { results.push(`MaterialFolder parentId skipped or already exists`); }

    // 1.1.2 为已有 MaterialFolder 表增加 sharedType 和 sharedTo (共享目录)
    try {
      await conn.execute("ALTER TABLE MaterialFolder ADD COLUMN sharedType VARCHAR(50) DEFAULT 'NONE' AFTER parentId");
      await conn.execute("ALTER TABLE MaterialFolder ADD COLUMN sharedTo TEXT DEFAULT NULL AFTER sharedType");
      results.push("Added sharedType and sharedTo to MaterialFolder ✅");
    } catch (e: any) { results.push(`MaterialFolder shared columns skipped or already exist`); }

    // 1.2 为已有 Material 表增加 folderId
    try {
      await conn.execute("ALTER TABLE Material ADD COLUMN folderId VARCHAR(191) DEFAULT NULL AFTER url");
      results.push("Added folderId to Material ✅");
    } catch (e: any) { results.push(`Material folderId skipped or already exists`); }

    // 1.2.1 为已有 Material 表增加 sharedType 和 sharedTo (共享素材)
    try {
      await conn.execute("ALTER TABLE Material ADD COLUMN sharedType VARCHAR(50) DEFAULT 'NONE' AFTER userId");
      await conn.execute("ALTER TABLE Material ADD COLUMN sharedTo TEXT DEFAULT NULL AFTER sharedType");
      results.push("Added sharedType and sharedTo to Material ✅");
    } catch (e: any) { results.push(`Material shared columns skipped or already exist`); }

    // 2. 为 Campaign 表增加 materialId 字段
    try {
      await conn.execute("ALTER TABLE Campaign ADD COLUMN materialId VARCHAR(191) AFTER groupId");
      results.push("Added materialId to Campaign ✅");
    } catch (e: any) { results.push(`Campaign materialId skipped or already exists`); }

    // 3. 为 Campaign 表增加 scheduleConfig 字段 (自动化方案)
    try {
      await conn.execute("ALTER TABLE Campaign ADD COLUMN scheduleConfig JSON AFTER materialId");
      results.push("Added scheduleConfig to Campaign ✅");
    } catch (e: any) { results.push(`Campaign scheduleConfig skipped or already exists`); }

    // 3.5 创建 SyncLog 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS SyncLog (
          id INT AUTO_INCREMENT PRIMARY KEY,
          syncType VARCHAR(50) NOT NULL DEFAULT 'REVERSE_SYNC',
          status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
          summary VARCHAR(255) DEFAULT NULL,
          details LONGTEXT DEFAULT NULL,
          userId VARCHAR(191) DEFAULT NULL,
          createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created SyncLog table ✅");
    } catch (e: any) { results.push(`SyncLog table failed: ${e.message}`); }

    // 3.6 确保 SyncLog.id 拥有 AUTO_INCREMENT 属性，解决 n8n 写入报错 Duplicate entry '0' for key 'PRIMARY'
    try {
      await conn.execute("ALTER TABLE SyncLog MODIFY COLUMN id INT AUTO_INCREMENT");
      results.push("Ensured SyncLog.id is AUTO_INCREMENT ✅");
    } catch (e: any) { results.push(`SyncLog AUTO_INCREMENT patch failed: ${e.message}`); }

    // 4. 多用户隔离系统：为所有核心表增加 userId

    const tablesToPatch = ["Campaign", "Material", "Contact", "Group", "SendLog", "Blacklist", "AppSettings", "SyncLog", "ContactStep"];
    for (const table of tablesToPatch) {
      try {
        await conn.execute(`ALTER TABLE \`${table}\` ADD COLUMN userId VARCHAR(191)`);
        await conn.execute(`CREATE INDEX idx_${table}_userId ON \`${table}\`(userId)`);
        results.push(`Added userId to ${table} ✅`);
      } catch (e: any) { results.push(`${table} userId skipped or already exists`); }
    }

    // 4.1 统一所有表中 userId 字段及主键的字符集和校对集，防止字符集不匹配导致 500 错误
    const columnsToAlign = [
      { table: "User", column: "id", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL" },
      { table: "User", column: "role", def: "VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPERATOR'" },
      { table: "User", column: "email", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL" },
      { table: "User", column: "name", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL" },
      { table: "Campaign", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL" },
      { table: "Campaign", column: "ownerId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL" },
      { table: "Campaign", column: "groupId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL" },
      { table: "Campaign", column: "sourceId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL" },
      { table: "Material", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL" },
      { table: "Contact", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL" },
      { table: "Contact", column: "sourceId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''" },
      { table: "Group", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL" },
      { table: "SendLog", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL" },
      { table: "Blacklist", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL" },
      { table: "AppSettings", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL" },
      { table: "SyncLog", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL" },
      { table: "ContactStep", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL" },
      { table: "MaterialFolder", column: "id", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL" },
      { table: "MaterialFolder", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL" },
      { table: "MaterialFolder", column: "parentId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL" },
      { table: "Material", column: "folderId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL" },
      { table: "KanbanView", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL" },
      { table: "InstanceConfig", column: "userId", def: "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL" }
    ];
    for (const item of columnsToAlign) {
      try {
        await conn.execute(`ALTER TABLE \`${item.table}\` MODIFY COLUMN \`${item.column}\` ${item.def}`);
        results.push(`Aligned collation for ${item.table}.${item.column} to utf8mb4_unicode_ci ✅`);
      } catch (e: any) {
        results.push(`Collation alignment failed for ${item.table}.${item.column}: ${e.message}`);
      }
    }


    // 5. 修复黑名单唯一索引：允许不同用户添加同一个号码到各自黑名单
    try {
      const possibleIndexNames = ["phone", "phone_UNIQUE", "Blacklist_phone_key"];
      for (const name of possibleIndexNames) {
        try { await conn.execute(`ALTER TABLE Blacklist DROP INDEX ${name}`); } catch(e) {}
      }
      await conn.execute(`ALTER TABLE Blacklist ADD UNIQUE INDEX idx_phone_userId (phone, userId)`);
      results.push("Fixed Blacklist unique index (phone, userId) ✅");
    } catch (e: any) { results.push(`Blacklist index fix skipped: ${e.message}`); }

    // 6. 修复联系人唯一索引：允许不同用户拥有同一个号码的联系人
    try {
      // a. 处理主键：将 (id) 改为 (id, userId) 复合主键，防止跨用户数据覆盖
      try { await conn.execute("ALTER TABLE Contact DROP PRIMARY KEY"); } catch(e) {}
      await conn.execute("ALTER TABLE Contact ADD PRIMARY KEY (id, userId)");
      results.push("Upgraded Contact table to composite primary key (id, userId) ✅");

      // b. 处理电话唯一索引：改为 (phone, userId) 复合索引，解决 500 报错
      const possibleIndexNames = ["phone", "phone_UNIQUE", "Contact_phone_key", "idx_contact_phone_userId"];
      for (const name of possibleIndexNames) {
        try { await conn.execute(`ALTER TABLE Contact DROP INDEX ${name}`); } catch(e) {}
      }
      await conn.execute(`ALTER TABLE Contact ADD UNIQUE INDEX idx_contact_phone_userId (phone, userId)`);
      results.push("Fixed Contact unique index (phone, userId) ✅");
    } catch (e: any) { results.push(`Contact index/PK fix failed: ${e.message}`); }

    // 7. 新增：为 Contact 表增加 sendCount (发送次数) 字段
    try {
      await conn.execute("ALTER TABLE Contact ADD COLUMN sendCount INT DEFAULT 0 AFTER responded");
      results.push("Added sendCount to Contact ✅");
    } catch (e: any) { results.push(`Contact sendCount skipped or already exists`); }

    // 7.1 看板系统字段扩展：为 Contact 表增加 stepId, priority, lastActivityAt, dueDate, note, orderIndex 字段
    try {
      await conn.execute("ALTER TABLE Contact ADD COLUMN stepId VARCHAR(191) DEFAULT NULL AFTER sourceId");
      results.push("Added stepId to Contact ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE Contact ADD COLUMN priority VARCHAR(50) DEFAULT 'medium' AFTER stepId");
      results.push("Added priority to Contact ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE Contact ADD COLUMN lastActivityAt DATETIME(3) DEFAULT NULL AFTER priority");
      results.push("Added lastActivityAt to Contact ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE Contact ADD COLUMN dueDate DATETIME(3) DEFAULT NULL AFTER lastActivityAt");
      results.push("Added dueDate to Contact ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE Contact ADD COLUMN note TEXT DEFAULT NULL AFTER dueDate");
      results.push("Added note to Contact ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE Contact ADD COLUMN orderIndex DOUBLE DEFAULT 0 AFTER note");
      results.push("Added orderIndex to Contact ✅");
    } catch (e: any) {}

    // 7.2 初始化存量数据的 lastActivityAt 和 默认步骤
    try {
      await conn.execute("UPDATE Contact SET lastActivityAt = createdAt WHERE lastActivityAt IS NULL");
      results.push("Initialized lastActivityAt for existing contacts ✅");
    } catch (e: any) {}

    try {
      const [users]: any = await conn.execute("SELECT id FROM User");
      for (const u of users) {
        const [steps]: any = await conn.execute("SELECT COUNT(*) as count FROM ContactStep WHERE userId = ?", [u.id]);
        if (steps[0].count === 0) {
          const defaultSteps = [
            { id: "step_new_" + u.id, name: "新线索", color: "#3b82f6", order: 1000 },
            { id: "step_follow_" + u.id, name: "跟进中", color: "#f59e0b", order: 2000 },
            { id: "step_won_" + u.id, name: "已成单", color: "#10b981", order: 3000 },
            { id: "step_idle_" + u.id, name: "已闲置", color: "#64748b", order: 4000 },
            { id: "step_lost_" + u.id, name: "已流失", color: "#ef4444", order: 5000 }
          ];
          for (const s of defaultSteps) {
            await conn.execute(
              "INSERT INTO ContactStep (id, name, color, orderIndex, userId) VALUES (?, ?, ?, ?, ?)",
              [s.id, s.name, s.color, s.order, u.id]
            );
          }
          results.push(`Seeded default ContactSteps for user ${u.id} ✅`);
        }
      }
    } catch (e: any) {
      results.push(`Seeding default ContactSteps failed: ${e.message}`);
    }

    // 8. 新增：智能文案与随机词组系统
    // 8.1 为 Campaign 表增加 AI 和随机选词相关字段
    try {
      await conn.execute("ALTER TABLE Campaign ADD COLUMN useAi BOOLEAN DEFAULT FALSE AFTER scheduleConfig");
      await conn.execute("ALTER TABLE Campaign ADD COLUMN useRandom BOOLEAN DEFAULT FALSE AFTER useAi");
      await conn.execute("ALTER TABLE Campaign ADD COLUMN aiPrompt TEXT AFTER useRandom");
      await conn.execute("ALTER TABLE Campaign ADD COLUMN aiModel VARCHAR(50) DEFAULT 'gpt-4o-mini' AFTER aiPrompt");
      results.push("Added useAi, useRandom, aiPrompt, aiModel to Campaign ✅");
    } catch (e: any) { results.push(`Campaign AI fields failed or already exists: ${e.message}`); }

    // 8.2 为 User 表增加 apiKeys 字段 (存储加密的 API Keys)
    try {
      await conn.execute("ALTER TABLE User ADD COLUMN apiKeys JSON DEFAULT NULL");
      results.push("Added apiKeys to User ✅");
    } catch (e: any) { results.push(`User apiKeys failed or already exists: ${e.message}`); }

    // 8.3 为 User 表增加 maxInstances 字段 (存储允许的最大实例数量)
    try {
      await conn.execute("ALTER TABLE User ADD COLUMN maxInstances INT DEFAULT 1");
      results.push("Added maxInstances to User ✅");
    } catch (e: any) { results.push(`User maxInstances failed or already exists: ${e.message}`); }

    // 8.4 为 AppSettings 表增加 n8nBindInstanceWebhookUrl, evolutionApiUrl, evolutionApiKey 字段
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN n8nBindInstanceWebhookUrl VARCHAR(255) DEFAULT NULL");
      results.push("Added n8nBindInstanceWebhookUrl to AppSettings ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN whatsappSyncConfig TEXT DEFAULT NULL");
      results.push("Added whatsappSyncConfig to AppSettings ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN whatsappSyncTime VARCHAR(191) DEFAULT '03:00'");
      results.push("Added whatsappSyncTime to AppSettings ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN whatsappSyncEnabled TINYINT(1) DEFAULT 0");
      results.push("Added whatsappSyncEnabled to AppSettings ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN whatsappAutoSyncInstances TEXT DEFAULT NULL");
      results.push("Added whatsappAutoSyncInstances to AppSettings ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN slaIdleHours INT DEFAULT 24");
      results.push("Added slaIdleHours to AppSettings ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN slaExpiringHours INT DEFAULT 2");
      results.push("Added slaExpiringHours to AppSettings ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN slaOverdueLabel VARCHAR(191) DEFAULT '已逾期'");
      results.push("Added slaOverdueLabel to AppSettings ✅");
    } catch (e: any) {}
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN automationConfig JSON DEFAULT NULL");
      results.push("Added automationConfig to AppSettings ✅");
    } catch (e: any) {}




    // 9. 智能初始化管理员账户 (全新部署、空用户表时自动创建)
    try {
      // 确保 User 表结构存在
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS User (
          id VARCHAR(191) PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          email VARCHAR(191) UNIQUE NOT NULL,
          passwordHash VARCHAR(191) NOT NULL,
          role VARCHAR(50) NOT NULL DEFAULT 'OPERATOR',
          createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        )
      `);

      // 查询当前用户总数
      const [userRows]: any = await conn.execute("SELECT COUNT(*) as count FROM User");
      const userCount = userRows[0]?.count || 0;

      if (userCount === 0) {
        // 初始化管理员必须由部署环境提供密码，源码中不留任何默认密码
        const initialPassword = (process.env.INITIAL_ADMIN_PASSWORD || "").trim();
        const initialEmail = (process.env.INITIAL_ADMIN_EMAIL || "admin@example.com").trim();

        if (initialPassword.length < 8) {
          results.push(
            "⏭ 跳过管理员初始化：User 表为空，但未配置 INITIAL_ADMIN_PASSWORD（至少 8 位）。" +
            " 请在部署环境变量里设置 INITIAL_ADMIN_PASSWORD（可顺便设置 INITIAL_ADMIN_EMAIL）后，重新访问本接口。"
          );
        } else {
          const adminId = generateId();
          const passwordHash = await bcrypt.hash(initialPassword, 10);
          const now = new Date();

          await conn.execute(
            "INSERT INTO User (id, name, email, passwordHash, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [adminId, "Administrator", initialEmail, passwordHash, "ADMIN", now, now]
          );
          results.push(`初始化管理员完成 ✅ (Email: ${initialEmail})。请立即登录并修改密码。`);
        }
      } else {
        results.push("User table already has users, skipped initialization ✅");
      }
    } catch (e: any) {
      results.push(`Failed to initialize administrator: ${e.message}`);
    }

    // 将现有数据归属给第一个管理员，并同步 ownerId 和 userId
    try {
      const [users]: any = await conn.execute("SELECT id FROM User LIMIT 1");
      if (users.length > 0) {
        const adminId = users[0].id;
        for (const table of tablesToPatch) {
          // a. 填补缺失的 userId
          await conn.execute(`UPDATE \`${table}\` SET userId = ? WHERE userId IS NULL`, [adminId]);
          
          // b. 填补缺失的 ownerId (针对像 Campaign 这样原本就有 ownerId 字段的表)
          try {
            await conn.execute(`UPDATE \`${table}\` SET ownerId = userId WHERE ownerId IS NULL AND userId IS NOT NULL`);
            await conn.execute(`UPDATE \`${table}\` SET userId = ownerId WHERE userId IS NULL AND ownerId IS NOT NULL`);
          } catch (e) {}
        }
        results.push(`Initial data ownership and ownerId/userId sync completed ✅`);
      }
    } catch (e: any) { results.push(`Ownership sync failed: ${e.message}`); }

    // ==========================================
    // 10. 多数据库源及 Excel 导入模块升级
    // ==========================================
    // 10.1 创建 DataSource 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS DataSource (
          id VARCHAR(191) PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          type VARCHAR(50) NOT NULL DEFAULT 'NOTION',
          notionSecret VARCHAR(191) DEFAULT NULL,
          notionDatabaseId VARCHAR(191) DEFAULT NULL,
          notionSyncWebhookUrl VARCHAR(255) DEFAULT NULL,
          description TEXT DEFAULT NULL,
          userId VARCHAR(191) NOT NULL,
          createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created DataSource table ✅");
    } catch (e: any) { results.push(`DataSource table failed: ${e.message}`); }

    // 10.2 为 Contact 表增加 sourceId
    try {
      await conn.execute("ALTER TABLE Contact ADD COLUMN sourceId VARCHAR(191) DEFAULT NULL AFTER groupId");
      results.push("Added sourceId to Contact ✅");
    } catch (e: any) { results.push(`Contact sourceId skipped or already exists`); }

    // 10.3 为 Campaign 表增加 sourceId
    try {
      await conn.execute("ALTER TABLE Campaign ADD COLUMN sourceId VARCHAR(191) DEFAULT NULL AFTER groupId");
      results.push("Added sourceId to Campaign ✅");
    } catch (e: any) { results.push(`Campaign sourceId skipped or already exists`); }

    // 10.4 升级 Contact 唯一索引，允许同一个号码在不同数据源中共存
    try {
      // a. 将 sourceId 列修改为 NOT NULL DEFAULT '' (确保 NULL 转换为 '' 从而支持唯一性索引的严格限制)
      await conn.execute("ALTER TABLE Contact MODIFY COLUMN sourceId VARCHAR(191) NOT NULL DEFAULT ''");
      results.push("Modified Contact sourceId column to NOT NULL DEFAULT '' ✅");

      // b. 删除旧的 (phone, userId) 唯一索引
      const oldIndices = ["idx_contact_phone_userId", "phone", "phone_UNIQUE", "Contact_phone_key"];
      for (const name of oldIndices) {
        try { await conn.execute(`ALTER TABLE Contact DROP INDEX \`${name}\``); } catch(e) {}
      }
      
      // c. 创建包含 sourceId 的新唯一索引
      await conn.execute("ALTER TABLE Contact ADD UNIQUE INDEX idx_contact_phone_userId_sourceId (phone, userId, sourceId)");
      results.push("Upgraded Contact unique index to (phone, userId, sourceId) ✅");
    } catch (e: any) {
      results.push(`Contact unique index upgrade failed: ${e.message}`);
    }

    // 10.5 优化 Group 表结构，允许 campaignId 和 contactIds 为空 (符合动态人群包的筛选机制)
    try {
      await conn.execute("ALTER TABLE `Group` MODIFY COLUMN campaignId VARCHAR(191) DEFAULT NULL");
      await conn.execute("ALTER TABLE `Group` MODIFY COLUMN contactIds VARCHAR(191) DEFAULT NULL");
      results.push("Upgraded Group table columns campaignId and contactIds to be nullable ✅");
    } catch (e: any) {
      results.push(`Group table columns upgrade failed: ${e.message}`);
    }

    // 11. 创建 KanbanView 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS KanbanView (
          id VARCHAR(191) PRIMARY KEY,
          name VARCHAR(191) NOT NULL,
          userId VARCHAR(191) NOT NULL,
          sourceId VARCHAR(191) DEFAULT NULL,
          groupId VARCHAR(191) DEFAULT NULL,
          hiddenStepIds TEXT DEFAULT NULL,
          slaConfig TEXT DEFAULT NULL,
          stepsConfig TEXT DEFAULT NULL,
          cardLayout TEXT DEFAULT NULL,
          isDefault TINYINT(1) DEFAULT 0,
          isShared TINYINT(1) DEFAULT 0,
          createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created KanbanView table ✅");
    } catch (e: any) { results.push(`KanbanView table failed: ${e.message}`); }

    // 11.1 为 KanbanView 增加 cardLayout 字段以支持定制化卡片布局
    try {
      await conn.execute("ALTER TABLE KanbanView ADD COLUMN cardLayout TEXT DEFAULT NULL AFTER stepsConfig");
      results.push("Added cardLayout column to KanbanView ✅");
    } catch (e: any) {
      results.push(`KanbanView cardLayout column patch skipped: ${e.message}`);
    }

    // 11.2 为 KanbanView 增加 instances 字段以支持根据实例筛选
    try {
      await conn.execute("ALTER TABLE KanbanView ADD COLUMN instances TEXT DEFAULT NULL AFTER cardLayout");
      results.push("Added instances column to KanbanView ✅");
    } catch (e: any) {
      results.push(`KanbanView instances column patch skipped: ${e.message}`);
    }

    // 11.3 升级 KanbanView.sourceId 和 KanbanView.groupId 为 TEXT，支持存储多选 JSON 数组
    try {
      await conn.execute("ALTER TABLE KanbanView MODIFY COLUMN sourceId TEXT DEFAULT NULL");
      await conn.execute("ALTER TABLE KanbanView MODIFY COLUMN groupId TEXT DEFAULT NULL");
      results.push("Upgraded KanbanView sourceId/groupId columns to TEXT ✅");
    } catch (e: any) {
      results.push(`KanbanView sourceId/groupId columns upgrade failed: ${e.message}`);
    }

    // 12. 为 AppSettings 表增加 evolutionWebhookUrl 字段，用于全局注册 n8n Webhook
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN evolutionWebhookUrl VARCHAR(255) DEFAULT NULL AFTER evolutionApiKey");
      results.push("Added evolutionWebhookUrl column to AppSettings ✅");
    } catch (e: any) {
      results.push(`AppSettings evolutionWebhookUrl column patch skipped: ${e.message}`);
    }

    // 13. 为 AppSettings 表增加 customSchema 字段，用于在网页端管理自定义列
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN customSchema JSON DEFAULT NULL");
      results.push("Added customSchema column to AppSettings ✅");
    } catch (e: any) {
      results.push(`AppSettings customSchema column patch skipped: ${e.message}`);
    }

    // 14. 为 User 表增加 kanbanEnabled 字段，用于控制是否开启看板功能
    try {
      await conn.execute("ALTER TABLE User ADD COLUMN kanbanEnabled TINYINT(1) DEFAULT 0");
      results.push("Added kanbanEnabled column to User table ✅");
    } catch (e: any) {
      results.push(`User kanbanEnabled column patch skipped: ${e.message}`);
    }

    // 14.2 为 User 表增加 automationsEnabled 字段，用于控制是否开启自动规则功能
    try {
      await conn.execute("ALTER TABLE User ADD COLUMN automationsEnabled TINYINT(1) DEFAULT 0");
      results.push("Added automationsEnabled column to User table ✅");
    } catch (e: any) {
      results.push(`User automationsEnabled column patch skipped: ${e.message}`);
    }

    // 15. 为 AppSettings 表增加 hubWebhookUrl 与 hubWebhookToken 字段，用于直连推送最新 Hub
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN hubWebhookUrl VARCHAR(255) DEFAULT NULL");
      results.push("Added hubWebhookUrl column to AppSettings ✅");
    } catch (e: any) {
      results.push(`AppSettings hubWebhookUrl column patch skipped: ${e.message}`);
    }
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN hubWebhookToken VARCHAR(255) DEFAULT NULL");
      results.push("Added hubWebhookToken column to AppSettings ✅");
    } catch (e: any) {
      results.push(`AppSettings hubWebhookToken column patch skipped: ${e.message}`);
    }
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN notificationPhone VARCHAR(50) DEFAULT NULL");
      results.push("Added notificationPhone column to AppSettings ✅");
    } catch (e: any) {
      results.push(`AppSettings notificationPhone column patch skipped: ${e.message}`);
    }

    // 16. 创建 InstanceConfig 表 (实例流入规则管理表)
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS InstanceConfig (
          id VARCHAR(191) PRIMARY KEY,
          instanceName VARCHAR(191) NOT NULL,
          allowKanban TINYINT(1) DEFAULT 1,
          allowHub TINYINT(1) DEFAULT 1,
          allowSync TINYINT(1) DEFAULT 1,
          userId VARCHAR(191) NOT NULL,
          createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
          UNIQUE KEY idx_instance_user (instanceName, userId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created InstanceConfig table ✅");
    } catch (e: any) { results.push(`InstanceConfig table failed: ${e.message}`); }

    // 16.11 为 InstanceConfig 增加 alias 别名字段
    try {
      await conn.execute("ALTER TABLE InstanceConfig ADD COLUMN alias VARCHAR(191) DEFAULT NULL");
      results.push("Added alias column to InstanceConfig ✅");
    } catch (e: any) { results.push(`InstanceConfig alias patch skipped: ${e.message}`); }

    // 16.2 创建 AutomationLog 表 (自动规则运行日志表)
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS AutomationLog (
          id VARCHAR(191) PRIMARY KEY,
          userId VARCHAR(191) NOT NULL,
          contactId VARCHAR(191) DEFAULT NULL,
          contactName VARCHAR(191) DEFAULT NULL,
          phone VARCHAR(191) DEFAULT NULL,
          ruleName VARCHAR(191) NOT NULL,
          messageText TEXT DEFAULT NULL,
          status VARCHAR(50) NOT NULL,
          steps JSON DEFAULT NULL,
          duration INT DEFAULT 0,
          createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
          KEY idx_auto_log_user (userId),
          KEY idx_auto_log_created (createdAt)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created AutomationLog table ✅");
    } catch (e: any) { results.push(`AutomationLog table failed: ${e.message}`); }

    // 17. 诊断：读取 MaterialFolder 和 User 记录
    try {
      const [foldersList]: any = await conn.execute("SELECT id, name, userId, parentId, sharedType FROM MaterialFolder");
      const [usersList]: any = await conn.execute("SELECT id, name, role FROM User");
      results.push(`📁 MaterialFolder 记录总数: ${foldersList.length}`);
      foldersList.forEach((f: any) => {
        results.push(`  - Folder: id=${f.id}, name=${f.name}, userId=${f.userId}, parentId=${f.parentId}, sharedType=${f.sharedType}`);
      });
      results.push(`👤 User 记录总数: ${usersList.length}`);
      usersList.forEach((u: any) => {
        results.push(`  - User: id=${u.id}, name=${u.name}, role=${u.role}`);
      });
    } catch (e: any) {
      results.push(`Failed to fetch MaterialFolder/User diagnostic info: ${e.message}`);
    }

    // 18. Webhook 同步：将所有实例的 Webhook 地址更新为当前 AppSettings 中配置的最新地址
    try {
      const [settingsRows]: any = await conn.execute(
        "SELECT id, userId, evolutionApiUrl, evolutionApiKey, evolutionWebhookUrl FROM AppSettings"
      );
      // 查出所有管理员用户的 id
      const [adminUsers]: any = await conn.execute("SELECT id FROM User WHERE role = 'ADMIN'");
      const adminIds = new Set<string>(adminUsers.map((u: any) => u.id));

      results.push(`🔗 AppSettings 记录总数: ${settingsRows.length}，准备同步 Webhook`);
      
      for (const settings of settingsRows) {
        const url = (settings.evolutionApiUrl || "").trim().replace(/\/+$/, "");
        const apikey = (settings.evolutionApiKey || "").trim();
        const webhookUrl = (settings.evolutionWebhookUrl || "").trim();
        
        if (!url || !apikey) {
          results.push(`⚠️ Settings ID ${settings.id} (User: ${settings.userId || "default"}): Evolution API 地址或密钥为空，跳过。`);
          continue;
        }
        if (!webhookUrl) {
          results.push(`⚠️ Settings ID ${settings.id} (User: ${settings.userId || "default"}): Webhook URL 为空，跳过。`);
          continue;
        }

        results.push(`🔄 正在连接 Evolution API: ${url} (User: ${settings.userId || "default"}) ...`);
        
        // 获取所有实例
        const fetchRes = await fetch(`${url}/instance/fetchInstances`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "apikey": apikey
          }
        });
        
        if (!fetchRes.ok) {
          results.push(`❌ 获取实例列表失败: status=${fetchRes.status} (User: ${settings.userId || "default"})`);
          continue;
        }
        
        const allInstances = await fetchRes.json();
        if (!Array.isArray(allInstances)) {
          results.push(`❌ 获取的实例列表格式不正确 (User: ${settings.userId || "default"})`);
          continue;
        }
        
        results.push(`📋 Evolution API 共有 ${allInstances.length} 个实例`);
        
        for (const item of allInstances) {
          const inst = item.instance ? { ...item.instance, ...item } : item;
          const name = inst.instanceName || inst.name || "";
          
          // 判断这个实例是否属于当前 settings 的所有者
          const userPrefix = settings.userId ? `usr_${settings.userId}_` : "";
          const isBelongsToUser = settings.userId 
            ? (name.startsWith(userPrefix) || (!name.startsWith("usr_") && adminIds.has(settings.userId)))
            : !name.startsWith("usr_");
            
          if (isBelongsToUser) {
            results.push(`📡 正在为实例 [${name}] 设置 Webhook 链接为 [${webhookUrl}] ...`);
            const setRes = await fetch(`${url}/webhook/set/${name}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": apikey
              },
              body: JSON.stringify({
                enabled: true,
                url: webhookUrl,
                webhookByEvents: false,
                events: ["MESSAGES_UPSERT"],
                webhook: {
                  enabled: true,
                  url: webhookUrl,
                  webhookByEvents: false,
                  events: ["MESSAGES_UPSERT"]
                }
              })
            });
            if (setRes.ok) {
              results.push(`✅ 实例 [${name}] Webhook 更新成功!`);
            } else {
              const errTxt = await setRes.text();
              results.push(`❌ 实例 [${name}] Webhook 更新失败: status=${setRes.status}, error=${errTxt}`);
            }
          }
        }
      }
    } catch (e: any) {
      results.push(`❌ Webhook 同步过程发生异常: ${e.message}`);
    }

    // 19. 为 AppSettings 表增加 groupMonitorEnabled, groupTargetStepId, customHookUrl 字段
    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN groupMonitorEnabled TINYINT(1) DEFAULT 0");
      results.push("Added groupMonitorEnabled column to AppSettings ✅");
    } catch (e: any) { results.push(`AppSettings groupMonitorEnabled column patch skipped: ${e.message}`); }

    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN groupTargetStepId VARCHAR(191) DEFAULT NULL");
      results.push("Added groupTargetStepId column to AppSettings ✅");
    } catch (e: any) { results.push(`AppSettings groupTargetStepId column patch skipped: ${e.message}`); }

    try {
      await conn.execute("ALTER TABLE AppSettings ADD COLUMN customHookUrl VARCHAR(255) DEFAULT NULL");
      results.push("Added customHookUrl column to AppSettings ✅");
    } catch (e: any) { results.push(`AppSettings customHookUrl column patch skipped: ${e.message}`); }

    // 20. 创建 BlacklistHistory 表
    try {
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS BlacklistHistory (
          id VARCHAR(191) PRIMARY KEY,
          phone VARCHAR(191) NOT NULL,
          userId VARCHAR(191) NOT NULL,
          reason VARCHAR(191) DEFAULT NULL,
          createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          UNIQUE KEY idx_blh_phone_userId (phone, userId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      results.push("Created BlacklistHistory table ✅");
    } catch (e: any) { results.push(`BlacklistHistory table failed: ${e.message}`); }

    // 20. 为 Campaign 表增加 instanceName 字段（指定发送实例）
    try {
      await conn.execute("ALTER TABLE Campaign ADD COLUMN instanceName VARCHAR(191) DEFAULT NULL");
      results.push("Added instanceName column to Campaign ✅");
    } catch (e: any) { results.push(`Campaign instanceName patch skipped: ${e.message}`); }

    return NextResponse.json({ 
      status: "多用户架构与多源导入升级完成",
      details: results
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, results: "failed" });
  } finally {
    await conn.end();
  }
}
