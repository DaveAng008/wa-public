import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const fileType = formData.get("type") as string | null; // "image" | "audio"
    
    if (!file) {
      return NextResponse.json({ error: "未上传文件" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 确保上传目录存在
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    const imagesDir = path.join(uploadsDir, "images");
    const audioDir = path.join(uploadsDir, "audio");
    const tempDir = path.join(uploadsDir, "temp");

    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const originalName = file.name || "";
    const rawExt = path.extname(originalName).toLowerCase();

    // 扩展名白名单：扩展名来自用户可控的文件名，绝不能直接拼进路径或命令行
    const ALLOWED_IMAGE_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp"];
    const ALLOWED_AUDIO_EXT = [".ogg", ".opus", ".mp3", ".m4a", ".aac", ".wav", ".webm"];
    const allowedExt = fileType === "image" ? ALLOWED_IMAGE_EXT : ALLOWED_AUDIO_EXT;
    const ext = allowedExt.includes(rawExt) ? rawExt : (fileType === "image" ? ".jpg" : ".webm");
    const randomName = crypto.randomUUID();

    if (fileType === "image") {
      // 限制 10MB
      if (buffer.length > 10 * 1024 * 1024) {
        return NextResponse.json({ error: "图片文件大小不能超过 10MB" }, { status: 400 });
      }

      const filename = `${randomName}${ext}`;
      const filepath = path.join(imagesDir, filename);
      fs.writeFileSync(filepath, buffer);
      
      return NextResponse.json({
        success: true,
        url: `/uploads/images/${filename}`
      });
    } else if (fileType === "audio") {
      // 限制 20MB
      if (buffer.length > 20 * 1024 * 1024) {
        return NextResponse.json({ error: "音频文件大小不能超过 20MB" }, { status: 400 });
      }

      // 先写入临时目录
      const tempFilename = `${randomName}${ext}`;
      const tempFilepath = path.join(tempDir, tempFilename);
      fs.writeFileSync(tempFilepath, buffer);

      const oggFilename = `${randomName}.ogg`;
      const oggFilepath = path.join(audioDir, oggFilename);

      // 使用 execFile + 参数数组（不经过 shell），彻底消除命令注入面
      return new Promise<NextResponse>((resolve) => {
        execFile(
          "ffmpeg",
          ["-y", "-i", tempFilepath, "-vn", "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", "-ac", "1", oggFilepath],
          (error, stdout, stderr) => {
          // 清理临时文件
          try {
            if (fs.existsSync(tempFilepath)) {
              fs.unlinkSync(tempFilepath);
            }
          } catch (e) {
            console.error("Failed to delete temp file:", e);
          }

          if (error) {
            console.warn("ffmpeg transcoding failed, falling back to native file:", stderr || error.message);
            // 降级策略：直接存入原始格式文件
            const fallbackFilename = `${randomName}${ext}`;
            const fallbackFilepath = path.join(audioDir, fallbackFilename);
            try {
              fs.writeFileSync(fallbackFilepath, buffer);
              resolve(NextResponse.json({
                success: true,
                url: `/uploads/audio/${fallbackFilename}`,
                converted: false,
                warning: "ffmpeg 转换失败，已保存为原始格式"
              }));
            } catch (writeErr: any) {
              resolve(NextResponse.json({
                error: `保存音频失败: ${writeErr.message}`
              }, { status: 500 }));
            }
          } else {
            resolve(NextResponse.json({
              success: true,
              url: `/uploads/audio/${oggFilename}`,
              converted: true
            }));
          }
        });
      });
    }

    return NextResponse.json({ error: "不支持的上传类型" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
