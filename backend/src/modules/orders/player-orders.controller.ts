import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CreateOrderResult, OrdersService, PlayerOrderListItem } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListPlayerOrdersDto } from './dto/list-orders-by-uid.dto';

/**
 * 玩家側(public)訂單 API
 *
 * MVP 認證模型:
 *   - 建單時帶 UID(已存在的 GameUser)
 *   - 查單時用 FacTradeSeq(隨機字串作為弱認證 — 知道序號才能看)
 *   - 列表時用 UID(弱認證 — 16 hex,2^64 不易枚舉)
 *   - v1.1 加 Google OAuth 後改 session-based,不再接受 client 傳 UID
 */
@Controller('orders')
export class PlayerOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateOrderDto): Promise<CreateOrderResult> {
    return this.orders.create(dto);
  }

  /** 列表(by UID) — 路徑與 `/:facTradeSeq` 衝突,所以走 query param */
  @Get()
  listByUid(
    @Query() dto: ListPlayerOrdersDto,
  ): Promise<{ total: number; items: PlayerOrderListItem[] }> {
    return this.orders.findByUid(dto.uid, { limit: dto.limit, offset: dto.offset });
  }

  @Get(':facTradeSeq')
  findOne(@Param('facTradeSeq') seq: string): Promise<unknown> {
    return this.orders.findByFacTradeSeq(seq);
  }
}
