import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

/**
 * 玩家訂單列表查詢 DTO
 *
 * MVP 認證:UID 自帶當弱認證 — v1.1 接 OAuth 後改 session 拿,
 * 不再接受 client 傳入。
 */
export class ListPlayerOrdersDto {
  /** 16 碼 hex UID */
  @IsString()
  @Matches(/^[0-9A-Fa-f]{16}$/, { message: 'uid must be 16-char hex' })
  uid!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
