import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ListOrdersDto } from './list-orders.dto';

@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListOrdersDto): Promise<{
    total: number;
    items: Array<{
      id: string;
      fac_trade_seq: string;
      status: string;
      amount: string;
      currency: string;
      user: { id: string; uid: string; email: string | null };
      product: { id: string; code: string; name_internal: string };
      created_at: Date;
      paid_at: Date | null;
      delivered_at: Date | null;
    }>;
  }> {
    const where: Prisma.OrderWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.fac_trade_seq) where.facTradeSeq = query.fac_trade_seq;
    if (query.user_uid) where.user = { uid: query.user_uid };
    if (query.mycard_trade_no) {
      where.transaction = { mycardTradeNo: query.mycard_trade_no };
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit ?? 50,
        skip: query.offset ?? 0,
        include: {
          user: { select: { id: true, uid: true, email: true } },
          product: { select: { id: true, code: true, nameInternal: true } },
        },
      }),
    ]);

    return {
      total,
      items: rows.map((o) => ({
        id: o.id,
        fac_trade_seq: o.facTradeSeq,
        status: o.status,
        amount: o.amount.toString(),
        currency: o.currency,
        user: o.user,
        product: { id: o.product.id, code: o.product.code, name_internal: o.product.nameInternal },
        created_at: o.createdAt,
        paid_at: o.paidAt,
        delivered_at: o.deliveredAt,
      })),
    };
  }

  async detail(orderId: string): Promise<unknown> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { id: true, uid: true, email: true, displayName: true } },
        product: true,
        transaction: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
        deliveryAttempts: { orderBy: { attemptNumber: 'desc' } },
        callbackLogs: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    return order;
  }
}
