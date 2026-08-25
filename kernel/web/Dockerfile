# 考功司 Web —— 多阶段：vite 构建（api 模式）→ nginx 静态托管 + /api 反代
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
# 企业全栈：web 走真实后端鉴权，/api 由 nginx 反代到 api 服务
RUN VITE_DATA_MODE=api VITE_API_BASE=/api pnpm --filter @tengxiaohtx/web build

FROM nginx:alpine
COPY --from=build /app/kernel/web/dist /usr/share/nginx/html
COPY kernel/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
