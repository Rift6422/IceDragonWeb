# 神代紀事 官方儲值站

NestJS + React + Prisma + MyCard + PlayFab 整合的玩家儲值網站。
Web 站獨立於 Unity App,玩家透過瀏覽器付款,商品入 PlayFab 庫存。

---

## 部署到 Railway(2 個 Service)

1. Railway 新增 Project
2. **+ New → Database → PostgreSQL**
3. **+ New → GitHub Repo** → 選本 repo
   - Build:Railway 自動偵測根目錄 `Dockerfile`(無需手動設定)
   - Settings → Networking → Generate Domain / 綁自訂 domain,Port 填 `3000`
   - Settings → Deploy → Healthcheck Path 填 `/healthz`
4. 本 service 右鍵 **Attach Volume**,Mount path 填 `/app/uploads`(圖庫圖片存這裡,沒掛的話重新部署圖片會遺失)
5. 設定環境變數(見下方),`DATABASE_URL` 填 `${{Postgres.DATABASE_URL}}`(Railway reference variable)
6. 開啟 **Static Outbound IPs**(Settings → Networking,需 Pro 方案),把 IP 交給 MyCard 加白名單
7. 綁定自訂 domain(建議走 Cloudflare,強制 HTTPS)
8. 部署完成

> 啟動時會自動跑 `prisma migrate deploy` 建立 / 升級資料表,不需手動 migrate。

---

## 必填環境變數

| Key | 用途 |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`;可在後面加 `?connection_limit=5&pool_timeout=10` |
| `NODE_ENV` | `production` |
| `RAILWAY_RUN_UID` | `0` — Railway Volume 以 root 掛載,不設的話容器內非 root 使用者寫不進圖庫 |
| `JWT_SECRET` | Admin 後台 JWT 簽章,**≥ 32 字元高熵**;產生:`openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | JWT 有效時間,例:`8h` |
| `ADMIN_USERNAME` | 後台帳號。**開機時會以此為唯一管理員**(其他舊帳號會被移除)|
| `ADMIN_PASSWORD` | 後台密碼,**務必設強密碼**(不設 = `admin123`)。改密碼 = 改這個值再 Redeploy |
| `PLAYER_FRONTEND_URL` | 玩家前台 base URL,例:`https://pay.icedragon-games.com` |
| `PLAYER_STORE_BASE_PATH` | `/shindai-record` |
| `PLAYER_RETURN_ORIGINS` | 允許付款完返回的網域(逗號分隔完整 origin)|
| `MYCARD_HASH_KEY` | MyCard 計算 Hash 用的 Key |
| `MYCARD_FAC_SERVICE_ID` | MyCard 廠商代碼 |
| `MYCARD_FAC_GAME_ID` | MyCard 遊戲代碼 |
| `MYCARD_FAC_GAME_NAME` | 顯示在 MyCard 付款頁的遊戲名稱,例:`神代紀事` |
| `MYCARD_API_BASE_PROD` | `https://b2b.mycard520.com.tw/MyBillingPay/v1.6` |
| `MYCARD_API_BASE_TEST` | `https://testb2b.mycard520.com.tw/MyBillingPay/v1.6` |
| `MYCARD_SANDBOX_MODE` | 上線設 `false` |
| `MYCARD_MOCK_MODE` | **上線必設 `false`**(不設預設為 `true`,不會真的打 MyCard)|
| `MYCARD_FAC_RETURN_URL` | 例:`https://pay.icedragon-games.com/api/mycard/trade-result` |
| `MYCARD_INBOUND_IP_PROD` / `MYCARD_INBOUND_IP_TEST` | MyCard 推 callback 的合法 IP(逗號分隔,見 `.env.example`)|

### 遊戲端(派發 / 限購 / 鎖單 / 序號兌換)

由遊戲端提供;全部留空會進 stub 模式(**派發不會真的送進遊戲**,正式環境必填):

| Key | 用途 |
|---|---|
| `GAME_BACKEND_BASE_URL` | 遊戲端 Azure Functions base URL |
| `GAME_BACKEND_GRANT_FUNCTION_CODE` | `/api/grantrmproduct` 派發 |
| `GAME_BACKEND_STOREITEMS_FUNCTION_CODE` | `/api/getstoreitems` 限購查詢 |
| `GAME_BACKEND_LOCK_FUNCTION_CODE` | `/api/getneworderavailable` 建單鎖商品 |
| `GAME_BACKEND_UNLOCK_FUNCTION_CODE` | `/api/updateorderstatus` 解鎖(**必須跟 LOCK 一起設**)|
| `GAME_BACKEND_COUPON_FUNCTION_CODE` | `/api/redeemmycoupon` 序號兌換 |
| `GAME_BACKEND_STORE_ID` | 例:`RMPacksStore` |
| `GAME_BACKEND_CATALOG` | PlayFab CatalogVersion |

### 選填

| Key | 用途 |
|---|---|
| `FB_PIXEL_ID` / `FB_TOKEN` / `FB_EVENT_CODE` | FB Pixel + Conversions API(`FB_PIXEL_ID` 改了要重新 build)|
| `MEDIA_BACKFILL_SOURCE_URL` | 新 Volume 是空的時,開機自動從此站補齊圖庫圖片(例:舊站 origin)|
| `ADMIN_IP_WHITELIST_ENABLED` / `ADMIN_IP_WHITELIST_LIST` | 後台 IP 白名單 |
| `ORDER_SWEEP_*` | 訂單對帳排程參數(預設值即可)|
| `MYCARD_DIRECT_KEY1` / `MYCARD_DIRECT_KEY2` | MyCard Model B 直接儲值 |

---

## MyCard 介接資料表要交的 URL

把 `pay.icedragon-games.com` 換成你的 domain:

| 欄位 | URL |
|---|---|
| 交易結果回傳 URL | `https://pay.icedragon-games.com/api/mycard/trade-result` |
| 補儲通知 URL | `https://pay.icedragon-games.com/api/mycard/supplement` |
| 差異比對 URL | `https://pay.icedragon-games.com/api/mycard/topup-records` |
| 廠商儲值紀錄查詢 URL | `https://pay.icedragon-games.com/api/mycard/topup-records`(同上,GET method)|
| 商家授權結果網址 | `https://pay.icedragon-games.com/api/mycard/direct-topup/auth-result` |
| 帳密驗證結果網址 | `https://pay.icedragon-games.com/api/mycard/direct-topup/account-verify` |
| 儲值結果回覆網址 | `https://pay.icedragon-games.com/api/mycard/direct-topup/topup-result` |

---

## 首次部署 Checklist

```
□ Railway Postgres + 本 repo service 建好,Volume 掛 /app/uploads
□ 環境變數全部填(必填),尤其 ADMIN_PASSWORD / MYCARD_MOCK_MODE=false
□ 舊站資料搬到新 DB(pg_dump → pg_restore),否則商品 / 訂單 / 玩家紀錄都是空的
□ 自訂 domain DNS 指到 Railway(走 Cloudflare 強制 HTTPS)
□ Static Outbound IP 交給 MyCard 加白名單(IP 變更需提前 3 工作天通知)
□ 第一次部署完成後:
   - 開 https://<your domain>/healthz 確認 200
   - 開 https://<your domain>/admin/login 用 ADMIN_USERNAME / ADMIN_PASSWORD 登入
   - 後台圖庫確認圖片都在(可用 MEDIA_BACKFILL_SOURCE_URL 自動補)
□ 跑一筆真實交易:建單 → 付款 → 遊戲內收到商品
```

---

## 本機開發

```bash
# 1. clone repo
git clone <repo url>
cd icedragon-web

# 2. 複製環境變數
cp .env.example .env.local
# 編輯 .env.local 填入測試環境的 MyCard 資料 + 自己 Postgres 連線

# 3. 安裝
cd backend && npm install
cd ../frontend && npm install

# 4. DB migration
cd ../backend
npx prisma migrate deploy
npm run prisma:seed   # 建測試玩家 + 商品(admin 由 ADMIN_USERNAME / ADMIN_PASSWORD 開機自動建立)

# 5. 啟動
npm run start:dev      # backend → http://localhost:3000
# (另開 terminal)
cd ../frontend && npm run dev  # vite dev → http://localhost:5173
# (玩家前台會 proxy /api/* 給 backend)

# 或用統一 Docker 模擬 prod:
docker build -t icedragon-web .
docker run -p 3000:3000 --env-file .env.local icedragon-web
# 開 http://localhost:3000 直接看完整網站
```

---

## 架構概覽

```
       玩家瀏覽器
           ↓
   Cloudflare (HTTPS / WAF)
           ↓
   Railway service ← 本 repo
   (NestJS backend + React SPA 同源)
           ↓
   Railway PostgreSQL
           ↓
   ↓ Outbound:
   - MyCard B2B API (付款 + callback)
   - 遊戲端 Azure Functions (派發 / 限購 / 鎖單 / 序號兌換)
```

只有 2 個 Railway service。Redis / BullMQ 不需要(派發走同步 + MyCard 補儲機制)。

---

## 主要 API endpoint

| 路徑 | 用途 |
|---|---|
| `GET /` | 玩家儲值頁 SPA |
| `GET /products`, `/orders`, `/orders/:id` | SPA 路由 |
| `GET /admin/*` | 後台 SPA |
| `POST /api/orders` | 玩家建單 |
| `GET /api/orders?uid=...` | 玩家查訂單 |
| `GET /api/products` | 公開商品列表 |
| `POST /api/admin/auth/login` | 後台登入 |
| `GET /api/admin/*` | 後台 API(JWT required)|
| `POST /api/mycard/trade-result` | MyCard §3.2 callback |
| `POST /api/mycard/supplement` | MyCard §3.6 補儲 |
| `POST /api/mycard/topup-records` | MyCard §3.7 差異比對 |
| `GET /api/mycard/topup-records` | MyCard 拉 CSV 對帳 |
| `/api/mycard/direct-topup/*` | MyCard Model B 直接儲值 |
| `GET /healthz` | 健康檢查 |

---

## 技術棧

- **後端**:NestJS 10 + Prisma 5 + PostgreSQL 15 + class-validator
- **前端**:React 18 + Vite 5 + TailwindCSS 3 + React Router 6 + TanStack Query 5 + Zustand
- **金流**:MyCard(SHA-256 Model A + SHA-1 Model B)
- **遊戲後端**:PlayFab(玩家庫存 + 派發)
- **部署**:Docker(多階段 build)+ Railway

---

## 預設帳號

- **後台**:由 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 決定(未設 = admin / admin123,**上線必改**)
- **測試玩家 UID**:`E9E3E1A9071AF9DC`(seed 產生)

---

## 授權

私有專案,所有權歸 客戶 所有。
