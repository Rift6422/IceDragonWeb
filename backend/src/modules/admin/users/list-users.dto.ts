import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/**
 * 查 GameUser
 * ⚠️ Read-only — 本系統不主動建立 / 修改 GameUser(決議 #A5)
 */
export class ListUsersDto {
  /** UID(16 碼 hex)or 部分 UID 都接受(LIKE %query%) */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^[0-9A-Fa-f]*$/, { message: 'uid must be hex' })
  uid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
