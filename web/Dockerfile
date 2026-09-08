# syntax=docker/dockerfile:1
# ---- 构建阶段：vite build 出静态站点 ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY bff/package.json ./bff/
COPY web/package.json ./web/
RUN --mount=type=cache,target=/root/.npm npm ci

COPY web ./web
RUN npm run --workspace web build

# ---- 运行阶段：nginx 托管静态资源 + 反代 /api 到 BFF ----
FROM nginx:1.27-alpine AS runtime
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/web/dist /usr/share/nginx/html
EXPOSE 80
