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
}
