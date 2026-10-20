import {
  BadRequestException,
  ConflictException,
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
  async create(
    dto: CreateOrderDto,
    ctx: {
      clientIp: string | null;
      clientUserAgent: string | null;
      origin?: string | null;
    } = {
      clientIp: null,
      clientUserAgent: null,
    },
  ): Promise<CreateOrderResult> {
    const uid = dto.uid.toUpperCase();
    this.logger.log(`[order-flow] ① 收到建單請求 uid=${uid} product=${dto.productCode}`);

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
    this.logger.log(
      `[order-flow] ② 商品確認 code=${product.code} itemId=${product.playfabItemId ?? '(無 PlayFab itemId,跳過限購/鎖檢查)'} storeId=${product.playfabStoreId ?? this.config.get('GAME_BACKEND_STORE_ID') ?? '(預設)'}`,
    );

    // (2.5) 限購 pre-check(若該商品有 PlayFab itemId)
    //
    // 走 /api/getstoreitems 一次拿全 store,從中找對應 itemId:
    //   找不到 itemID = 沒在 GameBackend 設限 → 允許購買
    //   limitation = null = 該品項無限購 → 允許購買
    //   left_quantity <= 0 → 拒絕,前端顯示已達上限
    // GameBackend 失敗時 service 內部會 swallow + 回空 → 不擋主流程,信任派發端最後再擋
    if (product.playfabItemId) {
      const effectiveStoreId =
        product.playfabStoreId ?? this.config.get<string>('GAME_BACKEND_STORE_ID');
      if (effectiveStoreId) {
        const { storeItems, ownPremiums } = await this.gameBackend.getStoreItems(uid, [
          effectiveStoreId,
        ]);

        // (a) 月卡類 premium:已擁有 → 直接拒絕(優先於限購檢查)
        if (ownPremiums.includes(product.playfabItemId)) {
          this.logger.warn(
            `[order-flow] ✗ 擋下單(已擁有) uid=${uid} itemId=${product.playfabItemId}`,
          );
          throw new BadRequestException('您已擁有此商品,無法再次購買');
        }

        // (b) 一般限購:剩餘額度 <= 0 → 拒絕(下次重置後可再買)
        const items = storeItems.get(effectiveStoreId) ?? [];
        const item = items.find((i) => i.item_id === product.playfabItemId);
        const lim = item?.limitation ?? null;
        if (lim && lim.left_quantity <= 0) {
          this.logger.warn(
            `[order-flow] ✗ 擋下單(已達購買上限 ${lim.max_quantity}/${lim.max_quantity}) uid=${uid} itemId=${product.playfabItemId}`,
          );
          throw new BadRequestException(
            `此商品已達購買上限(${lim.max_quantity}/${lim.max_quantity})`,
          );
        }
        this.logger.log(
          `[order-flow] ②.5 限購檢查通過 itemId=${product.playfabItemId} left=${lim ? lim.left_quantity : '無限'}`,
        );
      }
    }

    // (2.6) 解自己的未完成單(resume)+ 遊戲端鎖預檢
    //   - 自己上一筆未付款單(AUTHED)→ **回同一個 AuthCode / 跳轉**(resume,不開新單)
    //       → 全程只有一個可付款 session,MyCard 最多收一次,防雙分頁/重複建單重複扣款
    //   - 自己未完成單但已付款 → 擋下,叫他去「我的訂單」
    //   - PENDING(沒 AuthCode 的半殘單)→ 取消+解鎖,往下重建
    //   - 鎖定中但不是自己的(其他端口 Google/Apple)→ 擋下
    //   - 遊戲端系統異常(success:false)→ 擋下
    const itemId = product.playfabItemId;
    const storeId = itemId
      ? product.playfabStoreId ?? this.config.get<string>('GAME_BACKEND_STORE_ID') ?? null
      : null;
    const resolved = await this.resolveOwnOrderAndLock({
      userId: user.id,
      productId: product.id,
      uid,
      itemId,
      storeId,
    });
    if (resolved.resume) {
      this.logger.log(
        `[order-flow] ②.6 resume 玩家未付款單 ${resolved.resume.fac_trade_seq} → 回同一個 AuthCode,不開新單`,
      );
      return resolved.resume;
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
        clientIp: ctx.clientIp,
        clientUserAgent: ctx.clientUserAgent?.slice(0, 500) ?? null,
        fbp: dto.fbp?.slice(0, 200) ?? null,
        fbc: dto.fbc?.slice(0, 512) ?? null,
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

    this.logger.log(
      `[order-flow] ③ 訂單已建立 facTradeSeq=${facTradeSeq} orderId=${order.id} status=PENDING`,
    );

    // 註:web 不再主動送 Lock。鎖的生命週期(上鎖 / 解鎖 / TTL 自清)全交由伺服器端自管,
    //   web 只在建單前用 checkOrderAvailable(getneworderavailable)查可否購買(見 2.6)。

    // (4) 呼叫 AuthGlobal
    const facReturnURL = this.buildFacReturnURL(ctx.origin);
    this.logger.log(`[order-flow] ④ 呼叫 MyCard AuthGlobal facTradeSeq=${facTradeSeq}`);
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
      this.logger.warn(
        `[order-flow] ✗ AuthGlobal 失敗 facTradeSeq=${facTradeSeq} code=${result.returnCode} msg=${result.returnMsg}`,
      );
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
        transactionUrl: result.data.TransactionUrl,
        authRawResponse: result.data as unknown as Prisma.InputJsonValue,
      },
    });
    await this.state.transition({
      orderId: order.id,
      toStatus: OrderStatus.AUTHED,
      triggeredBy: 'system',
      reason: 'AuthGlobal success',
    });
    this.logger.log(`[order-flow] ⑤ AUTHED facTradeSeq=${facTradeSeq} — 回傳前端跳轉 MyCard`);

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
        product: { select: { code: true, nameDisplay: true, playfabItemId: true } },
        transaction: {
          select: { mycardTradeNo: true, paymentType: true, payResult: true, resultRawBody: true },
        },
      },
    });
    if (!order) throw new NotFoundException(`訂單不存在`);
    // MyCard trade-result 的 ReturnCode(原始 body 留底)— 供前端顯示失敗代碼
    const raw = order.transaction?.resultRawBody as Record<string, unknown> | null;
    const returnCode =
      raw && typeof raw === 'object' && typeof raw.ReturnCode === 'string' ? raw.ReturnCode : null;
    return {
      fac_trade_seq: order.facTradeSeq,
      status: order.status,
      amount: order.amount.toString(),
      currency: order.currency,
      product_code: order.product.code,
      // 遊戲端 itemId(送 PlayFab / 遊戲端的識別碼),供 WebView 回傳 Unity 對應發放道具
      game_item_id: order.product.playfabItemId,
      product_name: order.product.nameDisplay,
      payment_type: order.transaction?.paymentType,
      pay_result: order.transaction?.payResult,
      // MyCard 交易失敗時回傳的 ReturnMsg(已 URL-decode);前端失敗畫面顯示
      failure_reason: order.failureReason,
      // MyCard trade-result 回傳的代碼/訊息(前端失敗畫面顯示 ReturnCode + ReturnMsg)
      return_code: returnCode,
      return_msg: order.failureReason,
      created_at: order.createdAt,
      paid_at: order.paidAt,
      delivered_at: order.deliveredAt,
    };
  }

  // ============================================================
  // 玩家:離開付款頁 → 主動取消未完成單(best-effort,給前端用)
  // ============================================================

  /**
   * 玩家從 MyCard 付款頁跳回商城(按上一頁 / 關閉)時,前端打這支主動把
   * 剛剛那筆未完成單取消掉,讓商品狀態收斂,不必等補儲 / 對帳。
   *
   * 安全閘:AUTHED 的單先 TradeQuery 問 MyCard 付了沒 —— 玩家可能其實付了
   * 只是跳回來,這種**絕不能**取消,交給 callback 正常派發。
   *
   * FacTradeSeq 為隨機字串(弱認證,同既有查單),MVP 可接受。
   */
  async releaseAbandonedOrder(
    facTradeSeq: string,
  ): Promise<{ released: boolean; reason: string }> {
    const order = await this.prisma.order.findUnique({
      where: { facTradeSeq },
      include: { transaction: true, user: { select: { uid: true } } },
    });
    if (!order) return { released: false, reason: 'not_found' };

    // 只處理未完成單;終態不動
    if (order.status !== OrderStatus.PENDING && order.status !== OrderStatus.AUTHED) {
      return { released: false, reason: 'not_pending' };
    }

    // AUTHED:先確認玩家是不是其實付了(避免取消已付款單)
    if (order.status === OrderStatus.AUTHED && order.transaction?.authCode) {
      const q = await this.mycard.tradeQuery(order.transaction.authCode, order.id);
      if (q.ok && q.data?.PayResult === '3') {
        this.logger.log(
          `[order-abandon] ${facTradeSeq} 其實已付款(PayResult=3)→ 不取消,交由 callback 派發`,
        );
        return { released: false, reason: 'paid' };
      }
    }

    this.logger.log(
      `[order-abandon] 玩家離開付款頁,取消未完成單 ${facTradeSeq}(${order.status})`,
    );
    await this.state.transition({
      orderId: order.id,
      toStatus: OrderStatus.CANCELLED,
      triggeredBy: 'player',
      reason: '玩家離開 MyCard 付款頁,主動取消',
    });
    return { released: true, reason: 'cancelled' };
  }

  // ============================================================
  // 私有工具
  // ============================================================

  /**
   * 建單前:解析玩家自己的未完成單(resume / 取消)+ 可購查詢。
   *
   * 註:web 不上鎖,鎖由伺服器端自管;這裡的「鎖檢查」只是 getneworderavailable
   *     查詢可否購買(只查不鎖)。
   *
   * 順序很重要 —— 先處理「自己的單」,再判斷是不是別人佔著:
   *   1. 找自己同商品的未完成單(PENDING/AUTHED)
   *      · AUTHED + 有 AuthCode:
   *          - TradeQuery 已付款 → 擋(叫他去「我的訂單」,不重開 session)
   *          - 沒付 + 有存 transactionUrl → **resume**:回同一個 AuthCode / 跳轉(不開新單)
   *          - 沒付 + 沒 transactionUrl(舊單)→ 取消,往下重建
   *      · PENDING(沒 AuthCode 的半殘單)→ 取消,往下重建
   *   2. 可購查詢(僅該商品有 playfabItemId + 有設 LOCK code 時)
   *      · 可購 → 放行建新單
   *      · 不可購(自己的單已在步驟 1 清掉)→ 其他端口(Google/Apple)佔著 → 擋
   *      · 系統異常(success:false)→ 擋
   *
   * resume 的意義:同一個 (玩家, 商品) 未付款期間永遠只有一個可付款的 AuthCode,
   * MyCard 端最多收一次 → 從根上消除雙分頁 / 重複建單的重複扣款窗口。
   *
   * @returns resume 非 null = 呼叫端直接 return 該跳轉,不再開新單。
   */
  private async resolveOwnOrderAndLock(input: {
    userId: string;
    productId: string;
    uid: string;
    itemId: string | null;
    storeId: string | null;
  }): Promise<{ resume: CreateOrderResult | null }> {
    const { userId, productId, uid, itemId, storeId } = input;

    // 1. 自己同商品的未完成單
    const own = await this.prisma.order.findFirst({
      where: {
        userId,
        productId,
        status: { in: [OrderStatus.PENDING, OrderStatus.AUTHED] },
      },
      orderBy: { createdAt: 'desc' },
      include: { transaction: true },
    });

    if (own) {
      if (own.status === OrderStatus.AUTHED && own.transaction?.authCode) {
        // 先問 MyCard 付了沒 —— 已付絕不能重開 session
        this.logger.log(
          `[order-flow] ②.6 偵測到自己未完成單 ${own.facTradeSeq}(AUTHED)→ TradeQuery 確認付款狀態`,
        );
        const q = await this.mycard.tradeQuery(own.transaction.authCode, own.id);
        if (q.ok && q.data?.PayResult === '3') {
          this.logger.warn(
            `[order-flow] ✗ 擋下單(自己上一筆已付款 ${own.facTradeSeq})→ 不重複建單`,
          );
          throw new ConflictException(
            '您這筆訂單已付款,正在為您處理,請至「我的訂單」查看,請勿重複付款',
          );
        }
        // 沒付 + 有跳轉網址 → resume 回同一個 AuthCode
        if (own.transaction.transactionUrl) {
          return {
            resume: {
              order_id: own.id,
              fac_trade_seq: own.facTradeSeq,
              redirect_url: own.transaction.transactionUrl,
              status: OrderStatus.AUTHED,
            },
          };
        }
        this.logger.warn(
          `[order-flow] ②.6 未付款單 ${own.facTradeSeq} 無 transactionUrl(舊單)→ 取消重建`,
        );
      }
      // PENDING 半殘單 / AUTHED 無跳轉網址 → 取消,往下重建
      await this.cancelOwnUnpaidOrder(own.id, own.facTradeSeq, own.status);
    }

    // 2. 遊戲端鎖檢查(沒 itemId/storeId = 該商品不走鎖,直接放行)
    if (!itemId || !storeId) {
      return { resume: null };
    }
    const check = await this.gameBackend.checkOrderAvailable({ playerId: uid, storeId, itemId });
    if (check.ok) {
      this.logger.log(
        `[order-flow] ②.6 遊戲端鎖狀態檢查通過(可購) itemId=${itemId} (${check.durationMs}ms)`,
      );
      return { resume: null };
    }
    if (!check.locked) {
      // 系統異常(success:false)
      this.logger.error(
        `[order-flow] ✗ 擋下單(遊戲端訂單系統異常) uid=${uid} itemId=${itemId} (${check.durationMs}ms)`,
      );
      throw new ServiceUnavailableException(
        check.errorMessage ?? '遊戲端確認訂單系統異常,請稍後再試',
      );
    }
    // 鎖定中 + 自己的單已在步驟 1 清掉 → 其他端口(Google/Apple)
    this.logger.warn(`[order-flow] ✗ 擋下單(其他端口鎖定中) uid=${uid} itemId=${itemId}`);
    throw new ConflictException('已由其他端口進行付款,訂單暫時鎖定,請稍後再試');
  }

  /** 取消玩家自己的未完成單(無 transactionUrl 可 resume 時,取消後重建)*/
  private async cancelOwnUnpaidOrder(
    orderId: string,
    facTradeSeq: string,
    status: OrderStatus,
  ): Promise<void> {
    this.logger.log(`[order-flow] ②.6 取消玩家自己的舊單 ${facTradeSeq}(${status})→ 重建`);
    await this.state.transition({
      orderId,
      toStatus: OrderStatus.CANCELLED,
      triggeredBy: 'system',
      reason: '玩家重新購買同商品,取消自身未完成單',
    });
  }

  /**
   * MyCard「返回商家 / 交易結果回傳」網址。
   *
   * 同一部署同時服務 pay / pay-test(和 localhost)多網域:玩家從哪個網域來,
   * 付款完就回哪個。origin 由 controller 從 request 的 Origin / X-Forwarded-Host 取得。
   *
   * origin 來自 client header,可被偽造 → 只接受白名單內的網域,否則 fallback
   * 到固定 env `MYCARD_FAC_RETURN_URL`(防開放轉址 / callback 被導去他站)。
   */
  private buildFacReturnURL(origin?: string | null): string {
    const normalized = this.normalizeAllowedOrigin(origin);
    if (normalized) {
      return `${normalized}/api/mycard/trade-result`;
    }
    return this.config.get<string>(
      'MYCARD_FAC_RETURN_URL',
      'http://localhost:3000/api/mycard/trade-result',
    );
  }

  /**
   * 驗證 client 傳來的 origin 是否在允許清單內。
   *   - 合法 http(s):// origin
   *   - host 命中 `PLAYER_RETURN_ORIGINS`(逗號分隔)清單,或 localhost/127.0.0.1
   * 命不中回 null(呼叫端 fallback 到固定 env)。
   */
  private normalizeAllowedOrigin(origin?: string | null): string | null {
    if (!origin) return null;
    const trimmed = origin.trim().replace(/\/+$/, '');
    let host: string;
    try {
      const u = new URL(trimmed);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      host = u.host.toLowerCase();
    } catch {
      return null;
    }

    const allowlist = (this.config.get<string>('PLAYER_RETURN_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, '').toLowerCase())
      .filter(Boolean)
      .map((o) => {
        try {
          return new URL(o).host;
        } catch {
          return o;
        }
      });

    const isLocalhost = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    if (isLocalhost || allowlist.includes(host)) {
      return trimmed;
    }
    return null;
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
    playfabCatalog: string | null;
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
      playfab_catalog: product.playfabCatalog,
      snapshot_at: new Date().toISOString(),
    };
  }
}
