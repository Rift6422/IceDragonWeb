import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 訂單狀態機 — 集中管理所有狀態轉換
 *
 * 規則(對齊 schema.prisma Appendix B):
 *   PENDING → AUTHED
 *   AUTHED → PAID | FAILED | CANCELLED
 *   PAID → CONFIRMED
 *   CONFIRMED → DELIVERED | DELIVERY_FAILED
 *   PENDING → CANCELLED(玩家放棄)
 *
 * 任何狀態轉換都會:
 *   1. 用 transaction 確保原子性
 *   2. 寫 order_status_history
 *   3. 不可往「過去」轉換(防止覆蓋)
 */

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [OrderStatus.AUTHED, OrderStatus.CANCELLED, OrderStatus.FAILED],
  AUTHED: [OrderStatus.PAID, OrderStatus.FAILED, OrderStatus.CANCELLED],
  PAID: [OrderStatus.CONFIRMED, OrderStatus.FAILED],
  CONFIRMED: [OrderStatus.DELIVERED, OrderStatus.DELIVERY_FAILED],
  DELIVERY_FAILED: [OrderStatus.DELIVERED], // 重試成功時可回到 DELIVERED
  DELIVERED: [], // 終態
  CANCELLED: [], // 終態
  FAILED: [], // 終態
};

export interface TransitionInput {
  orderId: string;
  toStatus: OrderStatus;
  reason?: string;
  /** 'system' / 'mycard_callback' / 'admin:<id>' */
  triggeredBy: string;
  metadata?: Prisma.InputJsonValue;
  /** 額外要在 orders 表更新的欄位(例如 authedAt / paidAt 時間戳)*/
  extraOrderUpdate?: Prisma.OrderUpdateInput;
}

@Injectable()
export class OrderStateService {
  private readonly logger = new Logger(OrderStateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 嘗試把訂單轉到新狀態
   * @returns 新狀態的 order(若已是該狀態,直接回現況)
   * @throws 若狀態轉換違反 ALLOWED_TRANSITIONS
   */
  async transition(input: TransitionInput): Promise<{ order: unknown; transitioned: boolean }> {
    return this.prisma.$transaction(async (tx) => {
      // 鎖住該 row(防 race condition,例如補儲 5 次同時打)
      // 注意:$queryRaw 回的 status 是 DB 字串(snake_case 小寫,因 schema @map),
      // 需 toUpperCase 才對齊 Prisma 的 enum 值
      const current = await tx.$queryRaw<Array<{ id: string; status: string }>>`
        SELECT id, status FROM orders WHERE id = ${input.orderId}::uuid FOR UPDATE
      `;

      if (current.length === 0) {
        throw new Error(`Order ${input.orderId} not found`);
      }

      const currentStatus = current[0].status.toUpperCase() as OrderStatus;

      // 已是目標狀態 → 冪等,不報錯
      if (currentStatus === input.toStatus) {
        const order = await tx.order.findUnique({ where: { id: input.orderId } });
        return { order, transitioned: false };
      }

      // 檢查轉換合法
      const allowed = ALLOWED_TRANSITIONS[currentStatus];
      if (!allowed.includes(input.toStatus)) {
        throw new Error(
          `Invalid transition: ${currentStatus} → ${input.toStatus} (order ${input.orderId})`,
        );
      }

      // 寫 history
      await tx.orderStatusHistory.create({
        data: {
          orderId: input.orderId,
          fromStatus: currentStatus,
          toStatus: input.toStatus,
          reason: input.reason ?? null,
          triggeredBy: input.triggeredBy,
          metadata: input.metadata ?? Prisma.JsonNull,
        },
      });

      // 更新 order
      const updateData: Prisma.OrderUpdateInput = {
        status: input.toStatus,
        ...(input.extraOrderUpdate ?? {}),
      };

      // 自動補時間戳
      const now = new Date();
      if (input.toStatus === OrderStatus.AUTHED && !('authedAt' in updateData)) {
        updateData.authedAt = now;
      }
      if (input.toStatus === OrderStatus.PAID && !('paidAt' in updateData)) {
        updateData.paidAt = now;
      }
      if (input.toStatus === OrderStatus.CONFIRMED && !('confirmedAt' in updateData)) {
        updateData.confirmedAt = now;
      }
      if (input.toStatus === OrderStatus.DELIVERED && !('deliveredAt' in updateData)) {
        updateData.deliveredAt = now;
      }
      if (input.toStatus === OrderStatus.FAILED && input.reason && !('failureReason' in updateData)) {
        updateData.failureReason = input.reason;
      }

      const order = await tx.order.update({
        where: { id: input.orderId },
        data: updateData,
      });

      this.logger.log(
        `Order ${input.orderId}: ${currentStatus} → ${input.toStatus} (by ${input.triggeredBy})`,
      );

      return { order, transitioned: true };
    });
  }
}
