import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

/**
 * MyCard 付款完成後的「返回商家」按鈕導回。
 *
 * 跟 POST /api/mycard/trade-result 共用 URL,但:
 *   - POST 是 MyCard server-to-server 推結果(callback,IP/UA 白名單守)
 *   - GET 是玩家瀏覽器從 MyCard 點「返回商家」按鈕觸發
 *     → 沒有 MyCard 的 IP/UA,不能套 MyCardSourceGuard
 *     → 拆成獨立 controller,不掛 guard
 *
 * 行為:把玩家導回前台首頁,帶 `?paid={FacTradeSeq}` 讓前端知道剛付完款,
 * 可以立刻 invalidate 商品 query 重撈最新限購狀態。
 */
@Controller('mycard')
export class MyCardTradeReturnController {
  @Get('trade-result')
  returnFromPayment(
    @Query('FacTradeSeq') facTradeSeq: string | undefined,
    @Res() res: Response,
  ): void {
    const seq = (facTradeSeq ?? '').trim();
    const target = seq
      ? `/?paid=${encodeURIComponent(seq)}`
      : '/';
    res.redirect(302, target);
  }
}
