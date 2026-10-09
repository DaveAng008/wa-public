import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import path from "path";
import fs from "fs";
import { auth } from "@/auth";
import { safeEqual } from "@/lib/authToken";
import { signMediaId } from "@/lib/mediaSig";

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

function getGoogleDriveId(url: string): string | null {
  const reg1 = /\/file\/d\/([^/]+)/;
  const reg2 = /[?&]id=([^&]+)/;
  const match1 = url.match(reg1);
  if (match1) return match1[1];
  const match2 = url.match(reg2);
  if (match2) return match2[1];
  return null;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".gif": return "image/gif";
    case ".mp4": return "video/mp4";
    case ".mp3": return "audio/mpeg";
    case ".wav": return "audio/wav";
    case ".ogg": return "audio/ogg";
    case ".pdf": return "application/pdf";
    default: return "application/octet-stream";
  }
}

function getMimeTypeFromBuffer(buffer: Buffer, filePath: string): string {
  if (buffer.length >= 4) {
    const hex = buffer.toString("hex", 0, 4);
    if (hex.startsWith("ffd8ff")) return "image/jpeg";
    if (hex.startsWith("89504e47")) return "image/png";
    if (hex.startsWith("47494638")) return "image/gif";
    if (hex.startsWith("25504446")) return "application/pdf";
  }
  return getMimeType(filePath);
}

function logProxyRequest(req: NextRequest, id: string, detail: string) {
  try {
    // 日志写到运行时数据目录，绝不能放在 public/ 下（否则会变成可公开下载的静态文件）
    const logDir = process.env.DATA_DIR || process.cwd();
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFilePath = path.join(logDir, "media-proxy.log");
    const timestamp = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Kuala_Lumpur", hour12: false });
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const ua = req.headers.get("user-agent") || "none";
    const logLine = `[${timestamp}] Request ID: ${id} | IP: ${ip} | UA: ${ua} | Result: ${detail}\n`;
    fs.appendFileSync(logFilePath, logLine);
  } catch (err) {
    console.error("Failed to write proxy request log:", err);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string[] }> }) {
  const { id: idArray } = await params;
  const id = idArray?.[0] || "";

  // ── 鉴权：两种合法来源 ────────────────────────────────────────────────────
  //  ① 服务端调用（Evolution 取媒体发消息）：URL 带 ?sig=<素材ID的HMAC签名>
  //  ② 浏览器调用：必须是已登录会话，且该素材属于自己 / 已共享给自己 / 自己是管理员
  const sig = req.nextUrl.searchParams.get("sig") || "";
  const expectedSig = signMediaId(id);
  const viaSignature = !!sig && !!expectedSig && safeEqual(sig, expectedSig);

  let ownerFilter = "";
  let ownerParams: any[] = [];
  if (!viaSignature) {
    const session = await auth();
    if (!session?.user?.id) {
      logProxyRequest(req, id, "401 - Unauthorized");
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const isAdmin = (session.user as any).role?.toUpperCase() === "ADMIN";
    if (!isAdmin) {
      ownerFilter = " AND (userId = ? OR sharedType = 'SYSTEM' OR sharedTo LIKE ?)";
      ownerParams = [session.user.id, `%"${session.user.id}"%`];
    }
  }

  let conn;
  try {
    conn = await getConn();
    const [rows]: any = await conn.execute(
      `SELECT name, type, url FROM Material WHERE id = ?${ownerFilter} LIMIT 1`,
      [id, ...ownerParams]
    );

    if (rows.length === 0) {
      logProxyRequest(req, id, "404 - Material not found in DB");
      return new NextResponse("Material not found", { status: 404 });
    }

    const material = rows[0];
    const url = (material.url || "").trim();

    if (!url) {
      logProxyRequest(req, id, "400 - Material has no media URL");
      return new NextResponse("Material has no media URL", { status: 400 });
    }

    // 1. 如果是 Google Drive 链接
    if (url.includes("drive.google.com")) {
      const fileId = getGoogleDriveId(url);
      if (!fileId) {
        logProxyRequest(req, id, "400 - Invalid Google Drive URL: " + url);
        return new NextResponse("Invalid Google Drive URL", { status: 400 });
      }

      const isImageMat = (material.type || "").toUpperCase() === "IMAGE";
      let response;

      if (isImageMat) {
        // 对于图片类型，优先使用谷歌缩略图缓存服务，不限速、不拦截，极度稳定
        const gdThumbnailUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`;
        response = await fetch(gdThumbnailUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });
      } else {
        // 请求下载链接，并附带浏览器 User-Agent 避免 503 拦截
        const gdDownloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
        response = await fetch(gdDownloadUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          }
        });

        // 如果返回 HTML，说明碰到了“文件过大无法扫描病毒”的确认警告页面
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/html")) {
          const html = await response.text();
          const confirmMatch = html.match(/confirm=([0-9a-zA-Z_-]+)/);
          if (confirmMatch) {
            const confirmToken = confirmMatch[1];
            const cookie = response.headers.get("set-cookie");
            const headers: Record<string, string> = {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            };
            if (cookie) {
              headers["Cookie"] = cookie;
            }
            // 携带确认 token 和 cookie 重新请求
            response = await fetch(
              `https://drive.google.com/uc?export=download&confirm=${confirmToken}&id=${fileId}`,
              { headers }
            );
          }
        }
      }

      if (!response.ok) {
        logProxyRequest(req, id, `Failed to download from Google Drive (status ${response.status})`);
        return new NextResponse(`Failed to download from Google Drive (status ${response.status})`, { status: response.status });
      }

      const resHeaders = new Headers();
      resHeaders.set("Content-Type", response.headers.get("content-type") || "application/octet-stream");
      const len = response.headers.get("content-length");
      if (len) {
        resHeaders.set("Content-Length", len);
      }
      resHeaders.set(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(material.name || "file")}"`
      );

      logProxyRequest(req, id, `200 - Google Drive stream success (Type: ${material.type}, Name: ${material.name})`);
      return new NextResponse(response.body, { headers: resHeaders });
    }

    // 2. 如果是本地上传的文件 (相对路径，如 /uploads/images/xxx.jpg)
    if (url.startsWith("/uploads/") || url.startsWith("uploads/")) {
      const cleanUrl = url.startsWith("/") ? url : "/" + url;
      const uploadsRoot = path.resolve(process.cwd(), "public", "uploads");
      const filePath = path.resolve(process.cwd(), "public", "." + cleanUrl);

      // 防路径穿越：解析后的真实路径必须仍在 public/uploads 之内
      if (filePath !== uploadsRoot && !filePath.startsWith(uploadsRoot + path.sep)) {
        logProxyRequest(req, id, "400 - Path traversal blocked: " + cleanUrl);
        return new NextResponse("Invalid media path", { status: 400 });
      }

      if (!fs.existsSync(filePath)) {
        logProxyRequest(req, id, "404 - Local file not found on disk: " + filePath);
        return new NextResponse("Local file not found", { status: 404 });
      }

      const fileBuffer = fs.readFileSync(filePath);
      const mimeType = getMimeTypeFromBuffer(fileBuffer, filePath);

      logProxyRequest(req, id, `200 - Local file serve success (Mime: ${mimeType}, Size: ${fileBuffer.length} bytes, Path: ${cleanUrl})`);
      return new NextResponse(fileBuffer, {
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(fileBuffer.length),
          "Content-Disposition": `inline; filename="${path.basename(filePath)}"`
        }
      });
    }

    // 3. 其它公网直链媒体中转
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const response = await fetch(url);
      if (!response.ok) {
        logProxyRequest(req, id, `Failed to download from remote server (status ${response.status}) for URL: ${url}`);
        return new NextResponse("Failed to download from remote server", { status: response.status });
      }

      const resHeaders = new Headers();
      resHeaders.set("Content-Type", response.headers.get("content-type") || "application/octet-stream");
      const len = response.headers.get("content-length");
      if (len) {
        resHeaders.set("Content-Length", len);
      }
      resHeaders.set(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(material.name || "file")}"`
      );

      logProxyRequest(req, id, `200 - Remote URL stream success (Mime: ${response.headers.get("content-type") || "unknown"}, URL: ${url})`);
      return new NextResponse(response.body, { headers: resHeaders });
    }

    logProxyRequest(req, id, "400 - Unsupported URL format: " + url);
    return new NextResponse("Unsupported URL format", { status: 400 });

  } catch (e: any) {
    console.error("[Media Proxy] Error:", e);
    logProxyRequest(req, id, "500 - Internal Error: " + e.message);
    return new NextResponse(e.message || "Internal Server Error", { status: 500 });
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}
