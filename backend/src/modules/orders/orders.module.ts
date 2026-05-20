import { Module } from '@nestjs/common';
import { PlayerOrdersController } from './player-orders.controller';
import { OrdersService } from './orders.service';
import { OrderStateService } from './order-state.service';
import { MyCardModule } from '../mycard/mycard.module';

@Module({
  imports: [MyCardModule],
  controllers: [PlayerOrdersController],
  providers: [OrdersService, OrderStateService],
  exports: [OrdersService, OrderStateService],
})
export class OrdersModule {}
