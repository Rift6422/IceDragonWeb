import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CreateOrderResult, OrdersService, PlayerOrderListItem } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListPlayerOrdersDto } from './dto/list-orders-by-uid.dto';

/**
 * 從進站 request 推玩家所在的網域 origin(scheme://host)。
 *   1. 優先用瀏覽器自帶的 `Origin` header(同源 fetch 一定有)
 *   2. 退回 Cloudflare/Zeabur 代理的 `X-Forwarded-Proto` + `X-Forwarded-Host`
 *   3. 再退回 `Host`
 * 取不到回 null(service 端會 fallback 到固定 env)。
 */
function resolveRequestOrigin(req: Request): string | null {
  const originHeader = req.headers['origin']?.toString().trim();
  if (originHeader && /^https?:\/\//i.test(originHeader)) return originHeader;

  const xfHost = req.headers['x-forwarded-host']?.toString().split(',')[0]?.trim();
  const host = xfHost || req.headers['host']?.toString().trim();
  if (!host) return null;

  const xfProto = req.headers['x-forwarded-proto']?.toString().split(',')[0]?.trim();
  const proto = xfProto || 'https';
  return `${proto}://${host}`;
}

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
  create(@Body() dto: CreateOrderDto, @Req() req: Request): Promise<CreateOrderResult> {
    // Cloudflare → Zeabur LB → app:用 CF-Connecting-IP 拿真實 client IP
    // 沒有 CF header 時 fallback 到 req.ip(trust proxy 已啟用)
    const cfIp = req.headers['cf-connecting-ip']?.toString();
    const clientIp = (cfIp && cfIp.trim()) || req.ip || null;
    const clientUserAgent = req.headers['user-agent']?.toString() ?? null;
    // 玩家實際所在網域(pay / pay-test)→ 決定 MyCard 付款完回哪個網域
    const origin = resolveRequestOrigin(req);
    return this.orders.create(dto, { clientIp, clientUserAgent, origin });
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

  /**
   * 玩家離開 MyCard 付款頁(按上一頁 / 關閉)時前端主動呼叫,釋放未完成單的鎖。
   * best-effort:已付款的單(TradeQuery 確認)不會被取消。
   */
  @Post(':facTradeSeq/abandon')
  @HttpCode(HttpStatus.OK)
  abandon(@Param('facTradeSeq') seq: string): Promise<{ released: boolean; reason: string }> {
    return this.orders.releaseAbandonedOrder(seq);
  }
}
