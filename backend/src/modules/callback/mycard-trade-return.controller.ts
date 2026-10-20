import { Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
 * 行為:把玩家導回前台商城,帶 `?paid={FacTradeSeq}` 讓前端知道剛付完款,
 * 可以立刻 invalidate 商品 query 重撈最新限購狀態。
 *
 * 導回路徑帶遊戲命名空間前綴(PLAYER_STORE_BASE_PATH,例 /shindai-record),
 * 玩家才會停在帶前綴的商城,不會掉回 root(與前端 root 強制轉入一致)。
 */
@Controller('mycard')
export class MyCardTradeReturnController {
  constructor(private readonly config: ConfigService) {}

  @Get('trade-result')
  returnFromPayment(
    @Query('FacTradeSeq') facTradeSeq: string | undefined,
    @Res() res: Response,
  ): void {
    const seq = (facTradeSeq ?? '').trim();
    // 前綴正規化:去頭尾斜線後補前導斜線,留空 = root
    const raw = (this.config.get<string>('PLAYER_STORE_BASE_PATH') ?? '').trim();
    const base = raw ? `/${raw.replace(/^\/+|\/+$/g, '')}` : '';
    const target = seq ? `${base}/?paid=${encodeURIComponent(seq)}` : `${base}/`;
    res.redirect(302, target);
  }
}
