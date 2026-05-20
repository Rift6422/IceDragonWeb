import { Injectable, NotFoundException } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ProductCategory = 'BUNDLE' | 'CURRENCY';

export interface PublicProduct {
  id: string;
  code: string;
  name_display: string;
  amount: string;
  currency: string;
  effects: unknown;
  sort_order: number;
  /** 玩家前台分類:從 code 推導(BUNDLE_* → BUNDLE,其餘 → CURRENCY) */
  category: ProductCategory;
  /** 純展示用標籤,後端不強制,前端只當 badge 印 */
  purchase_limit_label?: string | null;
}

/** code 前綴推導分類(MVP — 之後可改 enum 欄位) */
function deriveCategory(code: string): ProductCategory {
  return code.startsWith('BUNDLE_') ? 'BUNDLE' : 'CURRENCY';
}

/** effects.purchase_limit_label → 玩家看到的「每日限購 1/1」這種文案 */
function extractLimitLabel(effects: unknown): string | null {
  if (effects && typeof effects === 'object' && 'purchase_limit_label' in effects) {
    const v = (effects as Record<string, unknown>).purchase_limit_label;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

@Injectable()
export class PublicProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<{ total: number; items: PublicProduct[] }> {
    const items = await this.prisma.product.findMany({
      where: { status: ProductStatus.ACTIVE },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        code: true,
        nameDisplay: true,
        amount: true,
        currency: true,
        effects: true,
        sortOrder: true,
      },
    });
    return {
      total: items.length,
      items: items.map((p) => ({
        id: p.id,
        code: p.code,
        name_display: p.nameDisplay,
        amount: p.amount.toString(),
        currency: p.currency,
        effects: p.effects,
        sort_order: p.sortOrder,
        category: deriveCategory(p.code),
        purchase_limit_label: extractLimitLabel(p.effects),
      })),
    };
  }

  async findByCode(code: string): Promise<PublicProduct> {
    const p = await this.prisma.product.findUnique({
      where: { code },
      select: {
        id: true,
        code: true,
        nameDisplay: true,
        amount: true,
        currency: true,
        effects: true,
        sortOrder: true,
        status: true,
      },
    });
    if (!p || p.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException(`Product "${code}" not found`);
    }
    return {
      id: p.id,
      code: p.code,
      name_display: p.nameDisplay,
      amount: p.amount.toString(),
      currency: p.currency,
      effects: p.effects,
      sort_order: p.sortOrder,
      category: deriveCategory(p.code),
      purchase_limit_label: extractLimitLabel(p.effects),
    };
  }
}
