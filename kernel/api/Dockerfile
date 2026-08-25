# 考功司 API —— 自包含全栈的后端服务
# 用 tsx 直接运行 TS（解析整个 workspace .ts 图），无需预编译；账号存 JSON 文件卷。
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ENV PORT=3001
ENV KAOGONGSI_DATA_DIR=/data
EXPOSE 3001
VOLUME ["/data"]
CMD ["pnpm", "--filter", "@tengxiaohtx/api", "start"]
