import { Global, Module } from '@nestjs/common';
import { GameBackendService } from './game-backend.service';

/**
 * 遊戲端 Azure Function / PlayFab proxy 模組。
 *
 * 目前對接的 endpoint:
 *   - /api/getstoreitems   → getStoreItems()  / validatePlayer()
 *   - /api/grantrmproduct  → grantProduct()
 *
 * 設為 @Global,讓 OrdersModule / ProductsModule 都能 inject 不用重複 import。
 */
@Global()
@Module({
  providers: [GameBackendService],
  exports: [GameBackendService],
})
export class GameBackendModule {}
