import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditLogInput {
  adminId: string;
  /** e.g. 'login' / 'logout' / 'create_product' / 'redeliver_order' */
  action: string;
  targetType?: string;
  targetId?: string;
  /** 任何可 JSON 序列化的 payload(service 內會用 JSON.stringify+parse 過濾) */
  payload?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * 後台稽核 log — 所有 mutate 動作都該 log 一筆
 * 寫進 admin_audit_logs 表(永久保留)
 *
 * 設計原則:
 * - 寫 log 失敗不要 throw(不能因 log 寫不進而拒絕主要操作)
 * - 但要 console error 出來,監控才能告警
 */
@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditLogInput): Promise<void> {
    try {
      // 透過 JSON 來回確保 payload 是 InputJsonValue-compatible
      const payload: Prisma.InputJsonValue | typeof Prisma.JsonNull =
        input.payload === undefined || input.payload === null
          ? Prisma.JsonNull
          : (JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonValue);

      await this.prisma.adminAuditLog.create({
        data: {
          adminId: input.adminId,
          action: input.action,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          payload,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log: action=${input.action} admin=${input.adminId}`,
        err,
      );
    }
  }
}
