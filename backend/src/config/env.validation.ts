import { plainToInstance, Type } from 'class-transformer';
import {
  IsBooleanString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

/**
 * 環境變數型別 + 驗證
 *
 * 規則:
 * - boot 時驗證,**啟動失敗就直接 crash**(don't run with bad env)
 * - 任何敏感欄位都 throw 但不在錯誤訊息洩漏值
 */
export class EnvSchema {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  // ============================================================
  // 資料庫
  // ============================================================

  @IsString()
  @Matches(/^postgres(ql)?:\/\//, { message: 'DATABASE_URL must start with postgres:// or postgresql://' })
  DATABASE_URL!: string;

  // ============================================================
  // 佇列(reserved)
  //
  // MVP 不使用獨立 queue:dispatch 由 callback 路徑同步觸發,
  // 重試靠 MyCard §3.6 補儲機制(最多 5 次)driven。
  // 若未來要主動排程重試(1m → 5m → 30m),導入 pg-boss(Postgres-backed),
  // 不需要額外的 Redis 服務,讓部署維持「1 個 app + 1 個 DB」的最小組合。
  // ============================================================
  @IsOptional()
  @IsString()
  @Matches(/^redis(s)?:\/\//, { message: 'REDIS_URL must start with redis:// or rediss:// (only set if explicitly using BullMQ — MVP does not need this)' })
  REDIS_URL?: string;

  // ============================================================
  // 玩家前台 URL(CORS / OAuth callback 用)
  // ============================================================

  @IsUrl({ require_tld: false, require_protocol: true })
  PLAYER_FRONTEND_URL: string = 'http://localhost:5173';

  /**
   * 玩家商城 base path(遊戲命名空間前綴),例:/shindai-record。
   * MyCard 付款完的返回會導到 `{PLAYER_STORE_BASE_PATH}/?paid=...`,讓玩家停在
   * 帶前綴的商城(與 root 強制轉入一致)。留空 = root(維持現況)。
   */
  @IsOptional()
  @IsString()
  PLAYER_STORE_BASE_PATH?: string;

  // ============================================================
  // JWT(Admin 登入用)
  // ============================================================

  /** ≥ 32 字元高熵字串;正式環境必填 */
  @IsString()
  @MaxLength(256)
  @Matches(/.{32,}/, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET!: string;

  /** JWT 有效期間;預設 8h(一個工作天) */
  @IsString()
  JWT_EXPIRES_IN: string = '8h';

  // ============================================================
  // 後台預設帳號(開機時 bootstrap 同步進 DB)
  //
  // AdminBootstrapService 開機讀這兩個值 upsert 進 admin_users:
  //   - 改密碼 = 改 ADMIN_PASSWORD env → Redeploy(不用碰 DB / 不重 build)
  //   - env 是密碼的唯一來源:每次開機都會把 DB 密碼同步成這個值
  //   - 不填 → 預設 admin / admin123(僅 dev 方便,正式務必改)
  // ============================================================

  @IsString()
  ADMIN_USERNAME: string = 'admin';

  @IsString()
  ADMIN_PASSWORD: string = 'admin123';

  // ============================================================
  // 後台 IP 白名單(reserved,預設 OFF)
  // ============================================================

  /** 'true' / 'false'。`true` 時所有 /api/admin/* 走 IP 白名單檢查 */
  @IsBooleanString()
  ADMIN_IP_WHITELIST_ENABLED: string = 'false';

  /** 逗號分隔 IP 清單,例:`1.2.3.4,5.6.7.8`。空 = 全擋(避免誤啟用) */
  @IsOptional()
  @IsString()
  ADMIN_IP_WHITELIST_LIST?: string;

  // ============================================================
  // Google OAuth(Part 2 用,Part 1 可不填)
  // ============================================================

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_ID?: string;

  @IsOptional()
  @IsString()
  GOOGLE_OAUTH_CLIENT_SECRET?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  GOOGLE_OAUTH_CALLBACK_URL?: string;

  // ============================================================
  // MyCard(Part 3 用,Part 1 可不填)
  // ============================================================

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[0-9a-zA-Z]+$/, { message: 'MYCARD_HASH_KEY must be alphanumeric' })
  MYCARD_HASH_KEY?: string;

  @IsOptional()
  @IsString()
  MYCARD_FAC_SERVICE_ID?: string;

  @IsOptional()
  @IsString()
  MYCARD_FAC_GAME_ID?: string;

  @IsString()
  MYCARD_FAC_GAME_NAME: string = 'icedragon';

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  MYCARD_API_BASE_TEST?: string;

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  MYCARD_API_BASE_PROD?: string;

  @IsBooleanString()
  MYCARD_SANDBOX_MODE: string = 'true';

  /**
   * Mock mode:不打真實 MyCard API,回 stub 資料
   * - 沒 MYCARD_FAC_SERVICE_ID / FAC_GAME_ID 時必須 true(否則必 crash)
   * - 正式環境須改 false
   */
  @IsBooleanString()
  MYCARD_MOCK_MODE: string = 'true';

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  MYCARD_FAC_RETURN_URL?: string;

  /**
   * 允許動態返回的玩家網域白名單(逗號分隔完整 origin)。
   * 同一部署同時服務 pay / pay-test 時,兩個都列上,玩家付款完就回原網域。
   * 例:https://pay.icedragon-games.com,https://pay-test.icedragon-games.com
   * 未列到的來源會 fallback 到 MYCARD_FAC_RETURN_URL(防偽造 Origin 開放轉址)。
   * localhost / 127.0.0.1 一律允許(本機開發)。
   */
  @IsOptional()
  @IsString()
  PLAYER_RETURN_ORIGINS?: string;

  @IsOptional()
  @IsString()
  MYCARD_INBOUND_IP_TEST?: string;

  @IsOptional()
  @IsString()
  MYCARD_INBOUND_IP_PROD?: string;

  @IsString()
  MYCARD_USER_AGENT: string = 'MyCardGlobalBilling/1.0';

  // ============================================================
  // MyCard Model B 直接儲值(v1.3.0)— SHA-1 hash 用兩支 key
  //
  // 由 MyCard 在合約時提供。若不開 Model B,留空即可,Module 啟動時會偵測
  // 兩支都空 → 不掛載 mycard-direct module。
  // ============================================================

  @IsOptional()
  @IsString()
  @MaxLength(64)
  MYCARD_DIRECT_KEY1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  MYCARD_DIRECT_KEY2?: string;

  // ============================================================
  // PlayFab 派發(MailDispatcher 真實實作)
  //
  // 由 Unity team / PlayFab admin 提供。三個 KEY:
  //   - PLAYFAB_TITLE_ID:公開識別字串
  //   - PLAYFAB_SECRET_KEY:Server API 用,**機密程度等同 MYCARD_HASH_KEY**
  //   - PLAYFAB_CLOUD_SCRIPT_FN:若走 Pattern 2(ExecuteCloudScript),填函式名
  //
  // 留空時:MailDispatcher fallback 到 MockMailDispatcher(僅 dev 用,
  // 訂單照樣標 DELIVERED 但不真送 PlayFab,正式環境**必填**)
  // ============================================================

  @IsOptional()
  @IsString()
  @MaxLength(64)
  PLAYFAB_TITLE_ID?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  PLAYFAB_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  PLAYFAB_CLOUD_SCRIPT_FN?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(60000)
  PLAYFAB_API_TIMEOUT_MS: number = 10000;

  // ============================================================
  // Game Backend(遊戲端 Azure Functions / PlayFab CloudScript proxy)
  //
  // 由遊戲端提供:
  //   - GAME_BACKEND_BASE_URL:                   例 https://shindai-record-function-app.azurewebsites.net
  //   - GAME_BACKEND_STOREITEMS_FUNCTION_CODE:   /api/getstoreitems 的 access key(query `?code=`)
  //   - GAME_BACKEND_GRANT_FUNCTION_CODE:        /api/grantrmproduct 的 access key(派發專用)
  //   - GAME_BACKEND_STORE_ID:                   web 端對應的 storeID,例 RMPacksStore
  //
  // 留空 → GameBackendService 進入 stub 模式(限購查詢回空,派發走 mock),不擋現有流程。
  //
  // 注意:舊 /api/getstorelimitations(v1)已於 2026-05-26 從遊戲端下架,
  //       環境變數 GAME_BACKEND_FUNCTION_CODE 已不再使用。
  // ============================================================

  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  GAME_BACKEND_BASE_URL?: string;

  /** Azure Function access key for /api/grantrmproduct(派發) */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  GAME_BACKEND_GRANT_FUNCTION_CODE?: string;

  /** Azure Function access key for /api/getstoreitems(批次商品/限購查詢) */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  GAME_BACKEND_STOREITEMS_FUNCTION_CODE?: string;

  /**
   * Azure Function access key for /api/redeemmycoupon(序號兌換)
   * 沒設 → 序號兌換頁回「功能尚未開通」,不擋現有流程
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  GAME_BACKEND_COUPON_FUNCTION_CODE?: string;

  /**
   * Azure Function access key for /api/getneworderavailable(建單前鎖商品)
   * 沒設 → 跳過 lock pre-check,沿用既有限購檢查
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  GAME_BACKEND_LOCK_FUNCTION_CODE?: string;

  /**
   * Azure Function access key for /api/updateorderstatus(付款完成/失敗後解鎖)
   * 沒設 → 跳過 unlock(若有設 LOCK 但沒設 UNLOCK,鎖會殭屍化,務必兩個一起設)
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  GAME_BACKEND_UNLOCK_FUNCTION_CODE?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  GAME_BACKEND_STORE_ID?: string;

  /**
   * PlayFab CatalogVersion — 派發 grantrmproduct 時帶入。
   * 由遊戲端提供;空字串會原樣送出(若遊戲端必填,務必設值)
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  GAME_BACKEND_CATALOG?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(30000)
  GAME_BACKEND_TIMEOUT_MS: number = 5000;

  // ============================================================
  // 訂單對帳 sweep(OrderReconciliationService,每 5 分鐘跑一次)
  // ============================================================

  /** 對帳 sweep 開關(預設開;設 'false' 完全不跑排程)*/
  @IsOptional()
  @IsBooleanString()
  ORDER_SWEEP_ENABLED?: string;

  /** 卡單多久(分)才進對帳:太新的單還在正常付款流程中,先別碰。預設 10 分 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1440)
  ORDER_SWEEP_DELIVER_GRACE_MIN: number = 10;

  /**
   * PENDING / 未付 AUTHED 卡多久(分)沒進展就取消 + 解鎖。
   * **必須 > MyCard 補儲窗(~20 分)**,否則可能取消到「其實付了只是補儲還沒到」的單。預設 60 分
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(20)
  @Max(10080)
  ORDER_SWEEP_CANCEL_GRACE_MIN: number = 60;

  /** sweep 只 TradeQuery 這時數內的卡單;更舊的 AUTHED 直接取消(auth 早失效)。預設 48 小時 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  ORDER_SWEEP_MAX_AGE_HOURS: number = 48;

  // ============================================================
  // Facebook Pixel + CAPI(廣告歸因)
  //
  // - FB_PIXEL_ID:Pixel 數字 ID(Events Manager → Data Sources → Pixel 設定)
  //   同一個值給後端 runtime + Dockerfile build ARG(自動 map 成 VITE_FB_PIXEL_ID 給前端)
  // - FB_TOKEN:Pixel 設定 → Conversions API → Generate Access Token
  //   ⚠️ 等同 MyCard Hash Key 的機密程度,絕不可進前端 bundle / commit / log
  // - FB_EVENT_CODE:測試期間用,Events Manager → Test Events 看
  //   上線前清空(否則事件不會計入廣告優化)
  //
  // FB_PIXEL_ID + FB_TOKEN 任一空 → FbCapiService.disabled=true,DispatchService 自動 skip(不會 crash)
  // ============================================================

  @IsOptional()
  @IsString()
  @MaxLength(64)
  FB_PIXEL_ID?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  FB_TOKEN?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  FB_EVENT_CODE?: string;

  // ============================================================
  // 媒體上傳(圖庫)
  //
  // 圖檔存「持久化路徑」,讓 Docker 重建 / Zeabur redeploy 不會遺失。
  // 上 Zeabur:Service → Storage → 加 Volume,mount path 設為這個值。
  // 預設 /app/uploads:Dockerfile 會 mkdir 並開放 app user 寫權限。
  // ============================================================

  @IsString()
  UPLOAD_DIR: string = '/app/uploads';

  /**
   * 媒體補檔來源站(選填)。設了才會在開機時偵測 Volume 缺哪些 media 檔,
   * 從此站 `/uploads/<filename>` 補齊(idempotent,補完即不再動作)。
   * 用於「新開正式 service、Volume 是空的」情境:值填有檔的來源站 origin。
   * 例:https://pay-test.icedragon-games.com。沒設 → 完全略過。
   */
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  MEDIA_BACKFILL_SOURCE_URL?: string;

  // ============================================================
  // 觀測
  // ============================================================

  @IsOptional()
  @IsString()
  SENTRY_DSN?: string;

  @IsString()
  LOG_LEVEL: string = 'info';
}

export function validateEnv(rawConfig: Record<string, unknown>): EnvSchema {
  const config = plainToInstance(EnvSchema, rawConfig, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(config, {
    skipMissingProperties: false,
    whitelist: false,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    const messages = errors
      .map((err) => {
        const constraints = err.constraints
          ? Object.values(err.constraints).join(', ')
          : 'unknown';
        return `  - ${err.property}: ${constraints}`;
      })
      .join('\n');
    throw new Error(
      `\n\n❌ Invalid environment variables — boot aborted:\n${messages}\n\n` +
        `Check your .env.local against .env.example.\n`,
    );
  }

  return config;
}
