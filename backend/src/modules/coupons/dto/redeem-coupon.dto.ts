import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * 玩家序號兌換請求。
 *   - uid:16 碼 hex(與遊戲端共用的玩家識別碼)
 *   - couponCode:序號,去頭尾空白後 1~64 字
 */
export class RedeemCouponDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[0-9A-F]{16}$/, { message: 'uid 必須是 16 碼大寫 hex' })
  uid!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1, { message: '請輸入序號' })
  @MaxLength(64, { message: '序號長度過長' })
  couponCode!: string;
}
