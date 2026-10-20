import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListUsersDto } from './list-users.dto';

/**
 * 後台對 GameUser 的 read-only 服務
 *
 * ⚠️ 嚴禁加入 create / update / delete 方法(決議 #A5)
 *    GameUser source of truth = 遊戲端
 */
@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListUsersDto): Promise<{
    total: number;
    items: Array<{
      id: string;
      uid: string;
      email: string | null;
      display_name: string | null;
      created_at: Date;
      last_login_at: Date | null;
      is_active: boolean;
      delivered_order_count: number;
      total_spent_twd: string;
    }>;
  }> {
    const where: Prisma.UserWhereInput = {};

    if (query.uid) {
      where.uid = { contains: query.uid.toUpperCase() };
    }
    if (query.email) {
      where.email = { contains: query.email, mode: 'insensitive' };
    }

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit ?? 50,
        skip: query.offset ?? 0,
        select: {
          id: true,
          uid: true,
          email: true,
          displayName: true,
          createdAt: true,
          lastLoginAt: true,
          isActive: true,
        },
      }),
    ]);

    // 一次 groupBy 拿所有用戶的 DELIVERED 訂單統計,避免 N+1
    const userIds = rows.map((u) => u.id);
    const stats =
      userIds.length === 0
        ? []
        : await this.prisma.order.groupBy({
            by: ['userId'],
            where: { userId: { in: userIds }, status: OrderStatus.DELIVERED },
            _count: { _all: true },
            _sum: { amount: true },
          });
    const statsByUserId = new Map(
      stats.map((s) => [
        s.userId,
        {
          count: s._count._all,
          sum: s._sum.amount ? s._sum.amount.toString() : '0',
        },
      ]),
    );

    return {
      total,
      items: rows.map((u) => {
        const s = statsByUserId.get(u.id);
        return {
          id: u.id,
          uid: u.uid,
          email: u.email,
          display_name: u.displayName,
          created_at: u.createdAt,
          last_login_at: u.lastLoginAt,
          is_active: u.isActive,
          delivered_order_count: s?.count ?? 0,
          total_spent_twd: s?.sum ?? '0',
        };
      }),
    };
  }

  async detail(id: string): Promise<UserDetailResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { inventoryCurrencies: true },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return this.buildDetail(user);
  }

  async detailByUid(uid: string): Promise<UserDetailResponse> {
    const user = await this.prisma.user.findUnique({
      where: { uid: uid.toUpperCase() },
      include: { inventoryCurrencies: true },
    });
    if (!user) throw new NotFoundException(`User UID ${uid} not found`);
    return this.buildDetail(user);
  }

  /**
   * 詳情共用組裝:
   *   - 訂單清單只回 DELIVERED,最多 100 筆,依 deliveredAt desc(派發時間優先,跟玩家認知一致)
   *   - 累積消費 / 訂單數用獨立 aggregate 算 *全部* DELIVERED,不受 100 上限影響
   *     → 跟 list() 的 groupBy 統計口徑完全一致
   */
  private async buildDetail(
    user: Prisma.UserGetPayload<{ include: { inventoryCurrencies: true } }>,
  ): Promise<UserDetailResponse> {
    const [deliveredOrders, agg] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId: user.id, status: OrderStatus.DELIVERED },
        orderBy: { deliveredAt: 'desc' },
        take: 100,
        include: {
          product: { select: { code: true, nameDisplay: true, nameInternal: true } },
        },
      }),
      this.prisma.order.aggregate({
        where: { userId: user.id, status: OrderStatus.DELIVERED },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    return {
      id: user.id,
      uid: user.uid,
      email: user.email,
      display_name: user.displayName,
      created_at: user.createdAt.toISOString(),
      last_login_at: user.lastLoginAt?.toISOString() ?? null,
      is_active: user.isActive,
      delivered_order_count: agg._count._all,
      total_spent_twd: agg._sum.amount ? agg._sum.amount.toString() : '0',
      orders: deliveredOrders.map((o) => ({
        id: o.id,
        fac_trade_seq: o.facTradeSeq,
        status: o.status,
        amount: o.amount.toString(),
        currency: o.currency,
        created_at: o.createdAt.toISOString(),
        delivered_at: o.deliveredAt?.toISOString() ?? null,
        product_code: o.product.code,
        product_name: o.product.nameDisplay,
      })),
      inventory_currencies: user.inventoryCurrencies.map((c) => ({
        currency_code: c.currencyCode,
        balance: c.balance.toString(),
      })),
    };
  }
}

export interface UserDetailResponse {
  id: string;
  uid: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
  is_active: boolean;
  delivered_order_count: number;
  total_spent_twd: string;
  orders: Array<{
    id: string;
    fac_trade_seq: string;
    status: string;
    amount: string;
    currency: string;
    created_at: string;
    delivered_at: string | null;
    product_code: string;
    product_name: string;
  }>;
  inventory_currencies: Array<{
    currency_code: string;
    balance: string;
  }>;
}
