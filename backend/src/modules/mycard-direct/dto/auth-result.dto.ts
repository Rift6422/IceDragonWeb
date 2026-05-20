import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 第 2 步:商家授權結果 — MyCard POST 進來的 payload。
 *
 * ⚠️ 欄位名稱以 MyCard 規格為準。實際拿到 sample 後若欄位名不同,
 *    需同步更新此 DTO 與 controller 接收邏輯。
 *
 *    本 DTO 採類別:從文件描述推斷,大致包含 TradeSeq + PreText + (可選)CustomerId。
 *    MyCard 文件用 `application/x-www-form-urlencoded` 送,但欄位名稱通常是
 *    PascalCase(同 Model A 的 §3.2.4 callback)。
 */
export class BAuthResultDto {
  @IsString()
  @MaxLength(50)
  TradeSeq!: string;

  @IsString()
  @MaxLength(500)
  PreText!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  CustomerId?: string;

  /** SHA-1 hash(hex,40 字)*/
  @IsString()
  @MaxLength(40)
  Hash!: string;
}
