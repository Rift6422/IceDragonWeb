import { Body, Controller, Post } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { GameBackendService } from '../game-backend/game-backend.service';

class VerifyUidDto {
  @IsString()
  @Matches(/^[0-9A-Fa-f]{16}$/, { message: 'uid must be 16-char hex' })
  uid!: string;
}

interface VerifyUidResponse {
  valid: boolean;
  /** OK = PlayFab 認得;NOT_FOUND = PlayFab 回不存在;BACKEND_DOWN = 遊戲端掛了(放行);STUB = 沒對接(放行) */
  reason: 'OK' | 'NOT_FOUND' | 'BACKEND_DOWN' | 'STUB';
}

/**
 * 玩家登入閘門 — 用 UID 透過遊戲端 GetStoreLimitations 反向驗證玩家存在性。
 *
 * 流程:
 *   1. 玩家在 LoginScreen 輸入 UID + 送出
 *   2. POST /api/players/verify { uid }
 *   3. 後端呼叫 GameBackendService.validatePlayer(uid)
 *      - PlayFab 認得 → 我方建檔(upsert users) + 回 valid:true
 *      - PlayFab 回 ResourceNotFound → 回 valid:false → 前端顯示錯誤
 *      - 遊戲端掛了 → fail open(允許登入,訂單流程會在派發階段擋假 UID)
 *
 * 跟「建單時 upsert」的差異:
 *   登入時驗證 = 阻擋假 UID 進到我們系統(更乾淨)
 *   建單時 upsert = 防禦性 fallback(玩家從 deep link 直接到商品頁的情況)
 */
@Controller('players')
export class PlayerAuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameBackend: GameBackendService,
  ) {}

  @Post('verify')
  async verify(@Body() dto: VerifyUidDto): Promise<VerifyUidResponse> {
    const uid = dto.uid.toUpperCase();
    const result = await this.gameBackend.validatePlayer(uid);

    if (result.valid) {
      // PlayFab 認得 或 遊戲端掛了(fail open)→ 都建檔
      // 之後建單就能用同一筆 user,而且歷史訂單也找得到
      await this.prisma.user.upsert({
        where: { uid },
        update: {},
        create: { uid, isActive: true },
      });
    }

    return result;
  }
}
