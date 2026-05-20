import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface DashboardStats {
  today: {
    /** 今日訂單(by status,只列關鍵狀態) */
    by_status: Record<string, number>;
    /** 今日成功(DELIVERED)總金額(TWD) */
    revenue_twd: number;
    /** 今日成功訂單數 */
    delivered_count: number;
  };
  totals: {
    delivered_count: number;
    delivered_revenue_twd: number;
    game_user_count: number;
    product_active_count: number;
    product_total_count: number;
  };
  attention: {
    /** 需要關注的訂單(DELIVERY_FAILED + 異常)*/
    delivery_failed_count: number;
    /** 過去 24 小時 callback 失敗筆數 */
    callback_failed_24h: number;
    /** AUTHED 超過 30 分鐘未轉 PAID 的訂單(玩家放棄?)*/
    stale_authed_count: number;
  };
  recent_orders: Array<{
    id: string;
    fac_trade_seq: string;
    status: OrderStatus;
    amount: string;
    created_at: Date;
  }>;
}

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<DashboardStats> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const halfHourAgo = new Date(now.getTime() - 30 * 60 * 1000);

    const [
      todayByStatusRaw,
      todayDeliveredAgg,
      totalDeliveredAgg,
      gameUserCount,
      productActiveCount,
      productTotalCount,
      deliveryFailedCount,
      callbackFailed24h,
      staleAuthedCount,
      recentOrders,
    ] = await Promise.all([
      // 今日訂單分狀態
      this.prisma.order.groupBy({
        by: ['status'],
        where: { createdAt: { gte: todayStart } },
        _count: { _all: true },
      }),
      // 今日成功金額
      this.prisma.order.aggregate({
        where: {
          createdAt: { gte: todayStart },
          status: OrderStatus.DELIVERED,
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // 累積成功金額 + 筆數
      this.prisma.order.aggregate({
        where: { status: OrderStatus.DELIVERED },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.user.count(),
      this.prisma.product.count({ where: { status: 'ACTIVE' } }),
      this.prisma.product.count(),
      this.prisma.order.count({ where: { status: OrderStatus.DELIVERY_FAILED } }),
      this.prisma.callbackLog.count({
        where: {
          createdAt: { gte: yesterday },
          OR: [{ hashValid: false }, { processed: false, errorMessage: { not: null } }],
        },
      }),
      this.prisma.order.count({
        where: {
          status: OrderStatus.AUTHED,
          authedAt: { lt: halfHourAgo },
        },
      }),
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          facTradeSeq: true,
          status: true,
          amount: true,
          createdAt: true,
        },
      }),
    ]);

    const todayByStatus: Record<string, number> = {};
    for (const row of todayByStatusRaw) {
      todayByStatus[row.status] = row._count._all;
    }

    return {
      today: {
        by_status: todayByStatus,
        revenue_twd: Number(todayDeliveredAgg._sum.amount ?? 0),
        delivered_count: todayDeliveredAgg._count._all,
      },
      totals: {
        delivered_count: totalDeliveredAgg._count._all,
        delivered_revenue_twd: Number(totalDeliveredAgg._sum.amount ?? 0),
        game_user_count: gameUserCount,
        product_active_count: productActiveCount,
        product_total_count: productTotalCount,
      },
      attention: {
        delivery_failed_count: deliveryFailedCount,
        callback_failed_24h: callbackFailed24h,
        stale_authed_count: staleAuthedCount,
      },
      recent_orders: recentOrders.map((o) => ({
        id: o.id,
        fac_trade_seq: o.facTradeSeq,
        status: o.status,
        amount: o.amount.toString(),
        created_at: o.createdAt,
      })),
    };
  }
}
