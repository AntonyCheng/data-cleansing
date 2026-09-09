# syntax=docker/dockerfile:1
# ---- 构建阶段：装全量依赖 + 编译 TS ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# 先只拷 manifest，命中依赖层缓存
COPY package.json package-lock.json ./
COPY bff/package.json ./bff/
COPY web/package.json ./web/
RUN --mount=type=cache,target=/root/.npm npm ci

# 再拷 BFF 源码并编译到 bff/dist
COPY bff ./bff
RUN npm run --workspace bff build

# 裁掉 devDependencies，只留运行时依赖
RUN npm prune --omit=dev

# ---- 运行阶段：精简镜像 + 系统 ffmpeg ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# 国内网络直连 deb.debian.org 不稳，换清华镜像源
RUN sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g; s|security.debian.org|mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    BFF_PORT=8787

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bff/package.json ./bff/package.json
COPY --from=builder /app/bff/dist ./bff/dist

# exports/ 与 telemetry/ 由 appendJsonl 自建，容器里挂卷持久化
EXPOSE 8787
CMD ["node", "bff/dist/index.js"]
