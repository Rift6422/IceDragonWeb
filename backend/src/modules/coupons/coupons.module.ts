import { Module } from '@nestjs/common';
import { CouponsController } from './coupons.controller';

/**
 * 玩家序號兌換模組。
 *
 * GameBackendService 是 @Global,直接 inject 不必 import。
 * 序號兌換邏輯在遊戲端,本模組只負責驗 DTO + proxy。
 */
@Module({
  controllers: [CouponsController],
})
export class CouponsModule {}
