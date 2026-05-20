import { Module } from '@nestjs/common';
import { MyCardCallbackController } from './mycard-callback.controller';
import { MyCardCallbackService } from './mycard-callback.service';
import { MyCardSourceGuard } from './guards/mycard-source.guard';
import { OrdersModule } from '../orders/orders.module';
import { MyCardModule } from '../mycard/mycard.module';
import { DispatchModule } from '../dispatch/dispatch.module';

@Module({
  imports: [OrdersModule, MyCardModule, DispatchModule],
  controllers: [MyCardCallbackController],
  providers: [MyCardCallbackService, MyCardSourceGuard],
})
export class CallbackModule {}
