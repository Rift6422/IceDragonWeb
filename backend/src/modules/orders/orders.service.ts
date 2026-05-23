import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MyCardApiService } from '../mycard/api-client/mycard-api.service';
import { GameBackendService } from '../game-backend/game-backend.service';
import { generateFacTradeSeq } from './fac-trade-seq.util';
import { OrderStateService } from './order-state.service';
import type { CreateOrderDto } from './dto/create-order.dto';

export interface CreateOrderResult {
  order_id: string;
  fac_trade_seq: string;
  redirect_url: string;
  status: OrderStatus;
}

export interface PlayerOrderListItem {
  fac_trade_seq: string;
  status: OrderStatus;
  amount: string;
  currency: string;
  product_code: string;
  product_name: string;
  created_at: string;
  paid_at: string | null;
  delivered_at: string | null;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mycard: MyCardApiService,
    private readonly state: OrderStateService,
    private readonly config: ConfigService,
    private readonly gameBackend: GameBackendService,
  ) {}

  // ============================================================
  // 玩家:建單
  // ============================================================

  /**
   * 完整流程:
   *   1. 驗證 GameUser 存在(read-only,UID 必須先在 users 表)
   *   2. 找 ACTIVE 商品
   *   3. 產 FacTradeSeq → INSERT order (PENDING)
   *   4. 呼叫 MyCard AuthGlobal
   *   5. 成功 → state.transition(PENDING → AUTHED)+ 存 auth_code
   *   6. 回前端 TransactionUrl(導頁去 MyCard)
   */
  async create(dto: CreateOrderDto): Promise<CreateOrderResult> {
    const uid = dto.uid.toUpperCase();

    // (1) 找 GameUser,沒有就自動建立
    //
    // 設計變更(2026-05-23):原本決議 #A5「Web 不主動建 GameUser」要求遊戲端
    // 推 UID 給我們,但實務上遊戲端在 PlayFab 維護玩家,我們這邊 users 表
    // 只是訂單 FK / 對帳用。玩家 UID 真偽改由下游 GetStoreLimitations /
    // grantrmproduct 把關;我們這邊不主動擋,讓玩家流程順暢。
    //
    // UID 格式驗證(16 碼大寫 hex)在 DTO 已做,亂打的進不到這裡。
    const user = await this.prisma.user.upsert({
      where: { uid },
      update: {},
      create: { uid, isActive: true },
    });
    if (!user.isActive) {
      throw new BadRequestException(`UID ${uid} 帳號已停用`);
    }

    // (2) 找商品
    const product = await this.prisma.product.findUnique({
      where: { code: dto.productCode },
    });
    if (!product) {
      throw new NotFoundException(`商品不存在:${dto.productCode}`);
    }
    if (product.status !== 'ACTIVE') {
      throw new BadRequestException(`商品已下架:${dto.productCode}`);
    }

    // (2.5) 限購 pre-check(若該商品有 PlayFab itemId)
    //
    // 找不到 itemID(回 null)= 沒在 GameBackend 設限 → 允許購買
    // left_quantity <= 0 → 拒絕,前端顯示已達上限
    // GameBackend 失敗時 service 內部會 swallow + 回空 → 不擋主流程,信任派發端最後再擋
    if (product.playfabItemId) {
      const limit = await this.gameBackend.getItemLimitation(
        uid,
        product.playfabItemId,
        product.playfabStoreId ?? undefined,
      );
      if (limit && limit.left_quantity <= 0) {
        throw new BadRequestException(
          `此商品已達購買上限(${limit.max_quantity}/${limit.max_quantity})`,
        );
      }
    }

    // (3) 產 FacTradeSeq + 建單(PENDING)
    const facTradeSeq = generateFacTradeSeq();
    const order = await this.prisma.order.create({
      data: {
        facTradeSeq,
        userId: user.id,
        productId: product.id,
        productSnapshot: this.snapshotProduct(product) as Prisma.InputJsonValue,
        amount: product.amount,
        currency: product.currency,
        status: OrderStatus.PENDING,
        transaction: {
          create: {}, // 預建 1:1 transaction row(後續更新欄位)
        },
      },
      include: { product: true, user: { select: { uid: true } } },
    });

    // 寫 history (initial state)
    await this.prisma.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: null,
        toStatus: OrderStatus.PENDING,
        triggeredBy: 'system',
        reason: 'order created',
      },
    });

    // (4) 呼叫 AuthGlobal
    const facReturnURL = this.buildFacReturnURL();
    const result = await this.mycard.authGlobal({
      facTradeSeq,
      customerId: uid,
      productName: product.nameDisplay,
      amount: product.amount.toString(),
      currency: product.currency,
      paymentType: product.mycardItemCode ? '' : '', // MyCard 無指定品項時可留空
      itemCode: product.mycardItemCode ?? '',
      facReturnURL,
      orderId: order.id,
    });

    if (!result.ok || !result.data.AuthCode || !result.data.TransactionUrl) {
      // AuthGlobal 失敗 → 訂單轉 FAILED
      await this.state.transition({
        orderId: order.id,
        toStatus: OrderStatus.FAILED,
        reason: `AuthGlobal failed: ${result.returnCode} ${result.returnMsg}`,
        triggeredBy: 'system',
      });
      throw new ServiceUnavailableException(`MyCard 授權失敗:${result.returnMsg}`);
    }

    // (5) 更新 transaction 存 AuthCode,訂單轉 AUTHED
    await this.prisma.transaction.update({
      where: { orderId: order.id },
      data: {
        authCode: result.data.AuthCode,
        tradeSeq: result.data.TradeSeq ?? null,
        authRawResponse: result.data as unknown as Prisma.InputJsonValue,
      },
    });
    await this.state.transition({
      orderId: order.id,
      toStatus: OrderStatus.AUTHED,
      triggeredBy: 'system',
      reason: 'AuthGlobal success',
    });

    // (6) 回前端
    return {
      order_id: order.id,
      fac_trade_seq: facTradeSeq,
      redirect_url: result.data.TransactionUrl,
      status: OrderStatus.AUTHED,
    };
  }

  // ============================================================
  // 玩家:訂單列表(by UID)
  // ============================================================

  /**
   * MVP 認證模型:玩家側無 OAuth,UID 自帶作為 query param(類似弱認證)。
   * v1.1 接 Google OAuth 後改成從 session 拿 UID,不接受 client 傳入。
   *
   * 只回 player-safe 欄位:fac_trade_seq、status、amount、商品名、時間戳。
   * 絕對不回 authCode、mycardTradeNo、raw callback payload。
   */
  async findByUid(
    uid: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ total: number; items: PlayerOrderListItem[] }> {
    const normalized = uid.toUpperCase();
    const user = await this.prisma.user.findUnique({ where: { uid: normalized } });
    if (!user) {
      // 與 build 流程一致的訊息(避免洩漏「UID 不存在」vs「沒訂單」差異不大,
      // 但這裡是 read,直接回空表也行;先沿用 build 流程的訊息便於 debug)
      return { total: 0, items: [] };
    }

    const [total, items] = await Promise.all([
      this.prisma.order.count({ where: { userId: user.id } }),
      this.prisma.order.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: Math.min(opts.limit ?? 20, 100),
        skip: opts.offset ?? 0,
        include: {
          product: { select: { code: true, nameDisplay: true } },
        },
      }),
    ]);

    return {
      total,
      items: items.map((o) => ({
        fac_trade_seq: o.facTradeSeq,
        status: o.status,
        amount: o.amount.toString(),
        currency: o.currency,
        product_code: o.product.code,
        product_name: o.product.nameDisplay,
        created_at: o.createdAt.toISOString(),
        paid_at: o.paidAt ? o.paidAt.toISOString() : null,
        delivered_at: o.deliveredAt ? o.deliveredAt.toISOString() : null,
      })),
    };
  }

  // ============================================================
  // 玩家:查單(by FacTradeSeq)
  // ============================================================

  async findByFacTradeSeq(facTradeSeq: string): Promise<unknown> {
    const order = await this.prisma.order.findUnique({
      where: { facTradeSeq },
      include: {
        product: { select: { code: true, nameDisplay: true } },
        transaction: {
          select: { mycardTradeNo: true, paymentType: true, payResult: true },
        },
      },
    });
    if (!order) throw new NotFoundException(`訂單不存在`);
    return {
      fac_trade_seq: order.facTradeSeq,
      status: order.status,
      amount: order.amount.toString(),
      currency: order.currency,
      product_code: order.product.code,
      product_name: order.product.nameDisplay,
      payment_type: order.transaction?.paymentType,
      pay_result: order.transaction?.payResult,
      created_at: order.createdAt,
      paid_at: order.paidAt,
      delivered_at: order.deliveredAt,
    };
  }

  // ============================================================
  // 私有工具
  // ============================================================

  private buildFacReturnURL(): string {
    return this.config.get<string>(
      'MYCARD_FAC_RETURN_URL',
      'http://localhost:3000/api/mycard/trade-result',
    );
  }

  private snapshotProduct(product: {
    code: string;
    nameDisplay: string;
    nameInternal: string;
    amount: { toString(): string };
    currency: string;
    effects: unknown;
    playfabItemId: string | null;
    playfabStoreId: string | null;
  }): Record<string, unknown> {
    return {
      code: product.code,
      name_display: product.nameDisplay,
      name_internal: product.nameInternal,
      amount: product.amount.toString(),
      currency: product.currency,
      effects: product.effects,
      playfab_item_id: product.playfabItemId,
      playfab_store_id: product.playfabStoreId,
      snapshot_at: new Date().toISOString(),
    };
  }
}
