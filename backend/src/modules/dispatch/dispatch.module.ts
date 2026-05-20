import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { DispatchService } from './dispatch.service';
import { MockMailDispatcher } from './mock-mail-dispatcher.service';
import { MAIL_DISPATCHER } from './mail-dispatcher.interface';

/**
 * Dispatch 模組
 *
 * 切換實作:把 MAIL_DISPATCHER 的 useClass 從 MockMailDispatcher 換成
 * HttpMailDispatcher(等遊戲端 API 規格出來再寫)
 */
@Module({
  imports: [OrdersModule],
  providers: [
    DispatchService,
    {
      provide: MAIL_DISPATCHER,
      useClass: MockMailDispatcher,
    },
  ],
  exports: [DispatchService],
})
export class DispatchModule {}
