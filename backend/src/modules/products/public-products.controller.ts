import { Controller, Get, Param, Query } from '@nestjs/common';
import { PublicProduct, PublicProductsService } from './public-products.service';

/**
 * 玩家前台公開商品 API。
 *
 * 沒有 JWT,沒有 IP 白名單 — 任何人都能讀。
 * 只回 ACTIVE 商品,避免下架商品還被前台快取。
 *
 * 帶 `?uid=XXXX` 時會多打 GameBackend 拿限購剩餘 — 失敗會降級為「未對接狀態」,不擋主流程。
 */
@Controller('products')
export class PublicProductsController {
  constructor(private readonly products: PublicProductsService) {}

  @Get()
  list(@Query('uid') uid?: string): Promise<{ total: number; items: PublicProduct[] }> {
    return this.products.list(uid?.trim() || undefined);
  }

  @Get(':code')
  byCode(
    @Param('code') code: string,
    @Query('uid') uid?: string,
  ): Promise<PublicProduct> {
    return this.products.findByCode(code, uid?.trim() || undefined);
  }
}
