import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ folder: string; filename: string }> }
) {
  try {
    const { folder, filename } = await params;

    // 防止目录遍历攻击，只允许字母、数字、下划线和中划线
    const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, "");
    const safeFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, "");

    // 拼出磁盘上的物理路径
    const filePath = path.join(process.cwd(), "public", "uploads", safeFolder, safeFilename);

    if (!fs.existsSync(filePath)) {
      return new NextResponse("File Not Found", { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(safeFilename).toLowerCase();

    // 匹配对应 MIME 类型
    let contentType = "application/octet-stream";
    if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".png") contentType = "image/png";
    else if (ext === ".gif") contentType = "image/gif";
    else if (ext === ".svg") contentType = "image/svg+xml";
    else if (ext === ".ogg") contentType = "audio/ogg";
    else if (ext === ".mp3") contentType = "audio/mpeg";
    else if (ext === ".webm") contentType = "audio/webm";
    else if (ext === ".wav") contentType = "audio/wav";
    else if (ext === ".m4a") contentType = "audio/mp4";
    else if (ext === ".pdf") contentType = "application/pdf";

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });
  } catch (error: any) {
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
