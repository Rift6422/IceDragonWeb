import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * 第 3-7 步:帳密驗證頁面提交 DTO(玩家在前端表單填,POST 進來)。
 *
 * MVP 認證模型 — 玩家無密碼(GameUser 表沒 password 欄)。Risk #1 走 a)
 * 選項:只驗 UID 存在 + 有效。等 MyCard 業務確認接受,若不接受,改成 b) 加密碼系統。
 */
export class BAccountVerifyDto {
  /** 第 2 步產生的一次性 token,verify 用 */
  @IsString()
  @MaxLength(64)
  verifyToken!: string;

  /** 玩家輸入的 16 碼 hex UID */
  @IsString()
  @Matches(/^[0-9A-Fa-f]{16}$/, { message: 'uid must be 16-char hex' })
  uid!: string;
}
