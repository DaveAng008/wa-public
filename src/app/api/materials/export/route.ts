import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { auth } from "@/auth";
import * as XLSX from "xlsx";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.user.id;
  const { searchParams } = new URL(req.url);
  const format = searchParams.get("format") || "xlsx"; // "xlsx" | "txt"

  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [materials]: any = await conn.execute(
      `SELECT m.id, m.name, m.type, m.content, m.url, m.folderId, f.name as folderName
       FROM Material m
       LEFT JOIN MaterialFolder f ON m.folderId = f.id
       WHERE m.userId = ?
       ORDER BY f.name, m.type, m.name`,
      [userId]
    );

    if (format === "txt") {
      // --- TXT 格式输出 ---
      const lines: string[] = [
        "=== Omniflow CRM 素材库导出 ===",
        `导出时间: ${new Date().toLocaleString("zh-CN")}`,
        `总计素材: ${materials.length} 条`,
        "=".repeat(40),
        "",
      ];

      for (const m of materials) {
        lines.push(`名称: ${m.name}`);
        lines.push(`类型: ${m.type}`);
        lines.push(`文件夹: ${m.folderName || "未分类"}`);
        if (m.content) lines.push(`内容: ${m.content}`);
        if (m.url) lines.push(`链接: ${m.url}`);
        lines.push("---");
      }

      const txt = lines.join("\n");
      return new NextResponse(txt, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="materials_export_${Date.now()}.txt"`,
        },
      });
    } else {
      // --- Excel 格式输出 ---
      const rows = materials.map((m: any) => ({
        名称: m.name,
        类型: m.type,
        所属文件夹: m.folderName || "未分类",
        文件夹ID: m.folderId || "",
        文本内容: m.content || "",
        链接URL: m.url || "",
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);

      // 设置列宽
      ws["!cols"] = [
        { wch: 30 }, // 名称
        { wch: 12 }, // 类型
        { wch: 20 }, // 所属文件夹
        { wch: 25 }, // 文件夹ID
        { wch: 60 }, // 文本内容
        { wch: 80 }, // 链接URL
      ];

      XLSX.utils.book_append_sheet(wb, ws, "素材库");

      // 添加说明页
      const helpData = [
        { 说明: "导入时，类型(type)字段只能是以下值之一:" },
        { 说明: "TEXT  - 文案/文字" },
        { 说明: "IMAGE - 图片" },
        { 说明: "VIDEO - 视频" },
        { 说明: "AUDIO - 语音" },
        { 说明: "DOCUMENT - 文件(PDF/PPT等)" },
        { 说明: "---" },
        { 说明: "文件夹ID 列在导入时会被忽略，仅供参考" },
        { 说明: "如果所属文件夹名称对应系统中已有文件夹，导入时会自动关联" },
      ];
      const wsHelp = XLSX.utils.json_to_sheet(helpData);
      wsHelp["!cols"] = [{ wch: 60 }];
      XLSX.utils.book_append_sheet(wb, wsHelp, "使用说明");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="materials_export_${Date.now()}.xlsx"`,
        },
      });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    await conn.end();
  }
}
