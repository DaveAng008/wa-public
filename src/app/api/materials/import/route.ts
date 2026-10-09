import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import * as XLSX from "xlsx";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const mode = (formData.get("mode") as string) || "append"; // "append" | "overwrite"

    if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

    const fileName = file.name.toLowerCase();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let rows: Array<{ name: string; type: string; content?: string; url?: string; folderName?: string }> = [];

    if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      // --- Excel 解析 ---
      const wb = XLSX.read(buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]]; // 第一个 sheet
      const data: any[] = XLSX.utils.sheet_to_json(ws);

      rows = data.map((row: any) => ({
        name: String(row["名称"] || row["name"] || "").trim(),
        type: String(row["类型"] || row["type"] || "TEXT").trim().toUpperCase(),
        content: String(row["文本内容"] || row["content"] || "").trim() || undefined,
        url: String(row["链接URL"] || row["url"] || "").trim() || undefined,
        folderName: String(row["所属文件夹"] || row["folderName"] || "").trim() || undefined,
      })).filter(r => r.name); // 过滤掉没有名字的行

    } else if (fileName.endsWith(".txt")) {
      // --- TXT 解析 (支持多行内容) ---
      const text = buffer.toString("utf-8");
      const blocks = text.split("---").map(b => b.trim()).filter(Boolean);

      for (const block of blocks) {
        const item: any = {};
        const lines = block.split("\n");
        let currentKey: string | null = null;
        let currentValLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const colonIdx = line.indexOf(":");
          
          let isNewKey = false;
          let key = "";
          let val = "";
          
          if (colonIdx !== -1) {
            const possibleKey = line.substring(0, colonIdx).trim();
            if (["名称", "类型", "内容", "链接", "文件夹"].includes(possibleKey)) {
              isNewKey = true;
              key = possibleKey;
              val = line.substring(colonIdx + 1).trim();
            }
          }

          if (isNewKey) {
            if (currentKey) {
              const fullVal = currentValLines.join("\n").trim();
              if (currentKey === "名称") item.name = fullVal;
              else if (currentKey === "类型") item.type = fullVal.toUpperCase();
              else if (currentKey === "内容") item.content = fullVal;
              else if (currentKey === "链接") item.url = fullVal;
              else if (currentKey === "文件夹") item.folderName = fullVal === "未分类" ? undefined : fullVal;
            }
            currentKey = key;
            currentValLines = [val];
          } else {
            if (currentKey) {
              currentValLines.push(line);
            }
          }
        }
        
        if (currentKey) {
          const fullVal = currentValLines.join("\n").trim();
          if (currentKey === "名称") item.name = fullVal;
          else if (currentKey === "类型") item.type = fullVal.toUpperCase();
          else if (currentKey === "内容") item.content = fullVal;
          else if (currentKey === "链接") item.url = fullVal;
          else if (currentKey === "文件夹") item.folderName = fullVal === "未分类" ? undefined : fullVal;
        }

        if (item.name) rows.push(item);
      }
    } else {
      return NextResponse.json({ error: "仅支持 .xlsx 或 .txt 格式" }, { status: 400 });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: "文件中没有找到有效的素材数据" }, { status: 400 });
    }

    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    const results = { imported: 0, skipped: 0, overwritten: 0 };

    try {
      // 如果是覆盖模式，先清空当前用户的所有素材
      if (mode === "overwrite") {
        const [deleted]: any = await conn.execute("DELETE FROM Material WHERE userId = ?", [userId]);
        results.overwritten = deleted.affectedRows || 0;
      }

      // 预加载所有文件夹 (用于名称 -> ID 的映射)
      const [folders]: any = await conn.execute(
        "SELECT id, name FROM MaterialFolder WHERE userId = ?",
        [userId]
      );
      const folderMap: Record<string, string> = {};
      for (const f of folders) folderMap[f.name] = f.id;

      const validTypes = ["TEXT", "IMAGE", "VIDEO", "AUDIO", "DOCUMENT", "RANDOM_GROUP"];

      for (const row of rows) {
        if (!row.name) { results.skipped++; continue; }

        const type = validTypes.includes(row.type) ? row.type : "TEXT";
        const folderId = row.folderName ? (folderMap[row.folderName] || null) : null;
        const id = "mat_" + crypto.randomBytes(5).toString("hex");

        try {
          await conn.execute(
            "INSERT INTO Material (id, name, type, content, url, folderId, userId) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [id, row.name, type, row.content || null, row.url || null, folderId, userId]
          );
          results.imported++;
        } catch (e: any) {
          // 如果是追加模式，遇到重名则跳过
          results.skipped++;
        }
      }

      return NextResponse.json({
        success: true,
        mode,
        ...results,
        message: `导入完成：成功 ${results.imported} 条，跳过 ${results.skipped} 条${mode === "overwrite" ? `，原有素材已清除 ${results.overwritten} 条` : ""}`,
      });
    } finally {
      await conn.end();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
