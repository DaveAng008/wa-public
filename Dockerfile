FROM node:20-alpine AS base
RUN apk add --no-cache ffmpeg

# 1. 安装依赖
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
# vendor/ 里是本地依赖（SheetJS 官方 tarball），必须在 npm ci 之前拷进来
COPY vendor ./vendor
RUN npm ci

# 2. 构建阶段
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 禁用 Next.js 遥测
ENV NEXT_TELEMETRY_DISABLED 1
RUN npm run build

# 3. 运行阶段
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# 创建非 root 用户提高安全性
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# public 必须归 nextjs 所有，否则运行时无法写入 public/uploads（上传素材会 EACCES）
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# 预建运行时目录并授权（配合 compose 的 uploads / appdata 持久卷）
RUN mkdir -p /app/public/uploads /app/data && chown -R nextjs:nodejs /app/public /app/data

USER nextjs
EXPOSE 3000
ENV PORT 3000

CMD ["npm", "start"]
