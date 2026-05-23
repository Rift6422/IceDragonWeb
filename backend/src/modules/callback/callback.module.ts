import { Module } from '@nestjs/common';
import { MyCardCallbackController } from './mycard-callback.controller';
import { MyCardTradeReturnController } from './mycard-trade-return.controller';
import { MyCardCallbackService } from './mycard-callback.service';
import { MyCardSourceGuard } from './guards/mycard-source.guard';
import { OrdersModule } from '../orders/orders.module';
import { MyCardModule } from '../mycard/mycard.module';
import { DispatchModule } from '../dispatch/dispatch.module';

@Module({
  imports: [OrdersModule, MyCardModule, DispatchModule],
  controllers: [MyCardCallbackController, MyCardTradeReturnController],
  providers: [MyCardCallbackService, MyCardSourceGuard],
  exports: [MyCardCallbackService],
})
export class CallbackModule {}
