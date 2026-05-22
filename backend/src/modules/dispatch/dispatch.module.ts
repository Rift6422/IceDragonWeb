import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { DispatchService } from './dispatch.service';
import { MockMailDispatcher } from './mock-mail-dispatcher.service';
import { GameBackendMailDispatcher } from './game-backend-mail-dispatcher.service';
import { MAIL_DISPATCHER } from './mail-dispatcher.interface';

/**
 * Dispatch 模組
 *
 * MAIL_DISPATCHER 用 GameBackendMailDispatcher,它內部自動 fallback 到 mock 行為:
 *   - product 有 playfabItemId + grant 功能已啟用 → 打遊戲端 grantrmproduct
 *   - 否則 → 回 mock 成功(讓本地 / 未對接環境流程不卡住)
 *
 * MockMailDispatcher 保留作 provider,測試或手動切換時用。
 */
@Module({
  imports: [OrdersModule],
  providers: [
    DispatchService,
    MockMailDispatcher,
    GameBackendMailDispatcher,
    {
      provide: MAIL_DISPATCHER,
      useExisting: GameBackendMailDispatcher,
    },
  ],
  exports: [DispatchService],
})
export class DispatchModule {}
