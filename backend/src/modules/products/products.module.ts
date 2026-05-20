import { Module } from '@nestjs/common';
import { PublicProductsController } from './public-products.controller';
import { PublicProductsService } from './public-products.service';

/**
 * 玩家公開商品 API(無需登入)
 *
 * 路由(prefix `/api`):
 *   GET /api/products           ← 列 ACTIVE 商品(供前台儲值頁)
 *   GET /api/products/:code     ← 用 code 查單品
 *
 * 與 AdminProductsController 區隔:
 *   - 不暴露 INACTIVE
 *   - 不暴露 admin 內部欄位(後台才看得到的時間戳/audit)
 *   - 無 JWT、無 IP 白名單
 */
@Module({
  controllers: [PublicProductsController],
  providers: [PublicProductsService],
})
export class ProductsModule {}
