import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * 玩家建單 DTO
 *
 * 注意 MVP 沒有 OAuth,玩家用「我已知 UID」當作 identity。
 * 後續 v1.1 加 Google OAuth 後,UID 從 session 自動帶,不需 client 傳
 */
export class CreateOrderDto {
  /** 16 碼 hex 遊戲 UID(必填) */
  @IsString()
  @Matches(/^[0-9A-Fa-f]{16}$/, { message: 'uid must be 16-char hex' })
  uid!: string;

  /** 內部商品 code,如 DIAMOND_150 */
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[A-Z0-9_]+$/, { message: 'productCode must be UPPER_SNAKE_CASE' })
  productCode!: string;

  /** 玩家 Email(可選,用於後續通知)*/
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  /**
   * FB Pixel cookie `_fbp` — 由前端 `document.cookie` 讀出後跟著 POST 過來
   * 用於 CAPI user_data.fbp,跨裝置 / iOS ATT 場景的歸因關鍵欄位
   * 沒帶就 null,CAPI 仍會送(降權重)
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fbp?: string;

  /**
   * FB Pixel cookie `_fbc`(從 fbclid 衍生) — 由前端 `document.cookie` 讀出後跟著 POST 過來
   * 廣告點擊歸因關鍵欄位,有 fbc 才能對應到具體廣告
   *
   * 注意 FB 新版 fbclid(`IwY2xj..._aem_...` 格式)衍生出的 fbc 可達 200+ 字元,
   * 舊的 MaxLength(200) 會讓「從 FB 貼文點進來」的訂單建不起來。fbc 是可選歸因欄位,
   * 絕不該擋建單 → 放寬到 512。
   */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  fbc?: string;
}
