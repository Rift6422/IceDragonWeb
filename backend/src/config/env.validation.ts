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
  // 後台 IP 白名單(reserved,預設 OFF)
  // ============================================================

  /** 'true' / 'false'。`true` 時所有 /api/admin/* 走 IP 白名單檢查 */
  @IsBooleanString()
  ADMIN_IP_WHITELIST_ENABLED: string = 'false';

  /** 逗號分隔 IP 清單,例:`1.2.3.4,5.6.7.8`。空 = 全擋(避免誤啟用) */
  @IsOptional()
  @IsString()
  ADMIN_IP_WHITELIST?: string;

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
