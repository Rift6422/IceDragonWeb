import { Global, Module } from '@nestjs/common';
import { GameBackendService } from './game-backend.service';

/**
 * 遊戲端 Azure Function / PlayFab proxy 模組。
 *
 * 目前提供:
 *   - GameBackendService.getStoreLimitations(uid, storeID?)
 *   - GameBackendService.getItemLimitation(uid, itemID, storeID?)
 *
 * 將來補上:
 *   - DeliverPurchase(派發)
 *   - GetCatalog(商品目錄)
 *
 * 設為 @Global,讓 OrdersModule / ProductsModule 都能 inject 不用重複 import。
 */
@Global()
@Module({
  providers: [GameBackendService],
  exports: [GameBackendService],
})
export class GameBackendModule {}
