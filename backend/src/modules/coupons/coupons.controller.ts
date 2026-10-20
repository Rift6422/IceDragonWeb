import { Body, Controller, Post } from '@nestjs/common';
import { GameBackendService } from '../game-backend/game-backend.service';
import { RedeemCouponDto } from './dto/redeem-coupon.dto';

/**
 * 玩家序號兌換 API(無需登入,前台公開)。
 *
 * 路由(prefix `/api`):
 *   POST /api/coupons/redeem   ← 玩家輸入 UID + 序號,轉呼遊戲端 /api/redeemmycoupon
 *
 * 設計:
 *   - 序號兌換邏輯全在遊戲端,我方只做 proxy(帶上 env 的 function code)
 *   - 一律把遊戲端訊息原樣帶回前端顯示(成功 / 失敗都顯示)
 *   - function code 是金鑰,只在後端持有,不進前端 bundle
 */
@Controller('coupons')
export class CouponsController {
  constructor(private readonly gameBackend: GameBackendService) {}

  @Post('redeem')
  redeem(@Body() dto: RedeemCouponDto): Promise<{ success: boolean; message: string }> {
    return this.gameBackend.redeemCoupon(dto.uid, dto.couponCode);
  }
}
