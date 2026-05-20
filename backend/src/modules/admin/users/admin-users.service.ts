import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

    return {
      total,
      items: rows.map((u) => ({
        id: u.id,
        uid: u.uid,
        email: u.email,
        display_name: u.displayName,
        created_at: u.createdAt,
        last_login_at: u.lastLoginAt,
        is_active: u.isActive,
      })),
    };
  }

  async detail(id: string): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            product: { select: { code: true, nameInternal: true } },
          },
        },
        inventoryCurrencies: true,
      },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async detailByUid(uid: string): Promise<unknown> {
    const user = await this.prisma.user.findUnique({
      where: { uid: uid.toUpperCase() },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            product: { select: { code: true, nameInternal: true } },
          },
        },
        inventoryCurrencies: true,
      },
    });
    if (!user) throw new NotFoundException(`User UID ${uid} not found`);
    return user;
  }
}
