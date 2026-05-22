# =================================================================
# icedragon-pay — 統一 Docker image(backend + frontend dist)
#
# Build context:repo 根目錄(不是 backend/ 也不是 frontend/)
#   docker build -f docker/Dockerfile -t icedragon-pay .
#
# Run:
#   docker run -p 3000:3000 --env-file .env.local icedragon-pay
#
# 設計重點:
#   - 一個 image、一個 process、一個 port(同源,無 CORS 議題)
#   - Backend (NestJS) 同時 serve API (`/api/*`, `/healthz`) 與 前端 SPA(其餘)
#   - Frontend 由 Vite build → /app/public 由 backend `ServeStaticModule` 接管
#   - 啟動時自動跑 `prisma migrate deploy`(idempotent,migration 對齊就是 no-op)
#   - 非 root user,tini 處理 PID 1
# =================================================================

# ---------- Stage 1: Frontend (Vite) ----------
FROM node:20-alpine AS frontend-builder

# Zeabur / 其他 PaaS 會把 NODE_ENV=production 帶進 build context,
# 導致 npm ci 自動 omit devDependencies(typescript / vite 都 build 階段需要)
# → 顯式 override 成 development 確保 build 階段 devDeps 一定裝
ENV NODE_ENV=development

WORKDIR /app/frontend

# Build-time 環境變數(VITE_* 會 inline 到 bundle,啟動後改不了)
ARG VITE_API_BASE_URL=""
ARG VITE_SENTRY_DSN=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SENTRY_DSN=$VITE_SENTRY_DSN

# 先 copy package files 利用 layer cache
# --include=dev 雙保險:就算上游 NODE_ENV 又被覆寫,也仍裝 devDeps
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --include=dev --no-audit --no-fund || npm install --include=dev --no-audit --no-fund

COPY frontend/ ./
RUN npm run build
# 輸出:/app/frontend/dist

# ---------- Stage 2: Backend (Nest) ----------
FROM node:20-alpine AS backend-builder

# 同上,build 階段需要 devDeps(nest cli / typescript / @types/*)
ENV NODE_ENV=development

# Prisma 在 Alpine 需要 libssl
RUN apk add --no-cache openssl

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json* ./
COPY backend/prisma ./prisma
RUN npm ci --include=dev --no-audit --no-fund || npm install --include=dev --no-audit --no-fund
RUN npx prisma generate

COPY backend/ ./
RUN npm run build

# 移除 devDeps,保留 prisma(CLI 啟動 migrate 用)
RUN npm prune --omit=dev

# ---------- Stage 3: Runtime ----------
FROM node:20-alpine AS runner

RUN apk add --no-cache tini openssl

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

# Backend 產物
COPY --from=backend-builder --chown=app:app /app/backend/node_modules ./node_modules
COPY --from=backend-builder --chown=app:app /app/backend/dist ./dist
COPY --from=backend-builder --chown=app:app /app/backend/prisma ./prisma
COPY --from=backend-builder --chown=app:app /app/backend/package.json ./package.json

# Frontend 產物 → backend 由 ServeStaticModule 接管 /app/public
COPY --from=frontend-builder --chown=app:app /app/frontend/dist ./public

USER app
EXPOSE 3000

# tini 處理 signals(SIGTERM → graceful shutdown)
ENTRYPOINT ["/sbin/tini", "--"]

# 啟動順序:
#   1. prisma migrate deploy — 套 pending migration(idempotent,沒新 migration 就秒過)
#   2. node dist/main.js     — NestJS 啟動,同時提供 API + 靜態 SPA
#
# 注意:不在此跑 seed。seed 只有首次部署手動跑一次:
#   docker exec <container> npx ts-node prisma/seed.ts  ← ts-node 在 prod image 已被 prune
# 推薦做法:首次部署用 Zeabur shell,或先 npm run prisma:seed 在 staging DB 跑,
# 接著用 pg_dump 灌進 prod DB。詳見 docs/11_部署架構_Zeabur.md。
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/main.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/healthz || exit 1
