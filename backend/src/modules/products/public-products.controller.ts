import { Controller, Get, Param } from '@nestjs/common';
import { PublicProduct, PublicProductsService } from './public-products.service';

/**
 * 玩家前台公開商品 API。
 *
 * 沒有 JWT,沒有 IP 白名單 — 任何人都能讀。
 * 只回 ACTIVE 商品,避免下架商品還被前台快取。
 */
@Controller('products')
export class PublicProductsController {
  constructor(private readonly products: PublicProductsService) {}

  @Get()
  list(): Promise<{ total: number; items: PublicProduct[] }> {
    return this.products.list();
  }

  @Get(':code')
  byCode(@Param('code') code: string): Promise<PublicProduct> {
    return this.products.findByCode(code);
  }
}
