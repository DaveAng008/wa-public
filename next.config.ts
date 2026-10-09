import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // 构建时跳过 lint（lint 单独跑，避免拖慢镜像构建）
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 类型检查必须通过，避免漏写鉴权、少 await 这类错误直接上线
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        // 对所有路径生效
        source: '/(.*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
          { key: 'Surrogate-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;
