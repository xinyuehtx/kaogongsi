# 考功司 API —— 自包含全栈的后端服务
# 用 tsx 直接运行 TS（解析整个 workspace .ts 图），无需预编译。
# 启动时若配了 DATABASE_URL，先 prisma db push 同步 schema（Postgres/Prisma 防腐层）。
FROM node:22-slim
WORKDIR /app
# Prisma 在 slim 镜像需 openssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ENV PORT=3001
ENV KAOGONGSI_DATA_DIR=/data
EXPOSE 3001
VOLUME ["/data"]
# 有 DB 则先同步 schema（db push），再启动
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then pnpm --filter @tengxiaohtx/persistence prisma:push; fi; pnpm --filter @tengxiaohtx/api start"]
