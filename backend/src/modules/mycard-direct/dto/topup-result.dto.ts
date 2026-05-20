import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 第 9-11 步:儲值結果回覆 — MyCard POST 進來的實際儲值請求。
 *
 * ⚠️ 欄位名稱以 MyCard 規格為準。
 *
 * 規格要點:
 *   - `Mycard_id` 是防重複儲值的閘門(DB UNIQUE)
 *   - 重複時必回 SRESULT=-2 + SMESSAGE 帶卡號
 *   - MyCardProjectNo + Mycardtype 決定面額 → 我方派發多少
 */
export class BTopupResultDto {
  @IsString()
  @MaxLength(50)
  TradeSeq!: string;

  /** MyCard 卡號 / Billing 號 / CGM 號 */
  @IsString()
  @MaxLength(32)
  Mycard_id!: string;

  @IsString()
  @MaxLength(32)
  MyCardProjectNo!: string;

  @IsString()
  @MaxLength(16)
  Mycardtype!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  CustomerId?: string;

  @IsOptional()
  @IsString()
  Amount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  Currency?: string;

  @IsOptional()
  @IsInt()
  CardPoint?: number;

  /** SHA-1 hash */
  @IsString()
  @MaxLength(40)
  Hash!: string;
}
