import { Injectable, NotFoundException } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GameBackendService } from '../game-backend/game-backend.service';
import type { ItemLimitation } from '../game-backend/game-backend.types';

export interface PublicCategory {
  id: string;
  code: string;
  display_name: string;
  sort_order: number;
}

export interface PublicProduct {
  id: string;
  code: string;
  name_display: string;
  amount: string;
  currency: string;
  effects: unknown;
  sort_order: number;
  /**
   * 動態分類:從 Product.category 關聯帶出。
   *
   * 沒設定 category 的舊資料用 fallback:
   *   BUNDLE_* / ALL_TIME_* / DAY_* / WEEK_* / MONTH_* → BUNDLE 分類
   *   其他 → CURRENCY 分類
   */
  category: PublicCategory | null;
  /** 純展示用標籤,後端不強制,前端只當 badge 印 */
  purchase_limit_label?: string | null;
  /** PlayFab itemId(對應遊戲端商品)— 玩家不需要看到,但 admin 用得到 */
  playfab_item_id?: string | null;
  /** 限購狀態(僅在 list/findByCode 帶 uid 時填入) */
  limitation?: ItemLimitation | null;
}

export interface PublicProductsResponse {
  total: number;
  /** 啟用中的分類(玩家前台 tab),依 sortOrder 排序 */
  categories: PublicCategory[];
  /** 商品(含 category 對應) */
  items: PublicProduct[];
}

function extractLimitLabel(effects: unknown): string | null {
  if (effects && typeof effects === 'object' && 'purchase_limit_label' in effects) {
    const v = (effects as Record<string, unknown>).purchase_limit_label;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

function mapCategory(c: { id: string; code: string; displayName: string; sortOrder: number } | null): PublicCategory | null {
  if (!c) return null;
  return { id: c.id, code: c.code, display_name: c.displayName, sort_order: c.sortOrder };
}

@Injectable()
export class PublicProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameBackend: GameBackendService,
  ) {}

  async list(uid?: string): Promise<PublicProductsResponse> {
    const [items, categories] = await Promise.all([
      this.prisma.product.findMany({
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
          playfabItemId: true,
          playfabStoreId: true,
          category: { select: { id: true, code: true, displayName: true, sortOrder: true } },
        },
      }),
      this.prisma.category.findMany({
        where: { status: ProductStatus.ACTIVE },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, code: true, displayName: true, sortOrder: true },
      }),
    ]);

    const limitationMap = await this.fetchLimitations(uid, items);

    return {
      total: items.length,
      categories: categories.map((c) => mapCategory(c)!).filter(Boolean),
      items: items.map((p) => ({
        id: p.id,
        code: p.code,
        name_display: p.nameDisplay,
        amount: p.amount.toString(),
        currency: p.currency,
        effects: p.effects,
        sort_order: p.sortOrder,
        category: mapCategory(p.category),
        purchase_limit_label: extractLimitLabel(p.effects),
        playfab_item_id: p.playfabItemId,
        limitation: p.playfabItemId ? (limitationMap.get(p.playfabItemId) ?? null) : null,
      })),
    };
  }

  async findByCode(code: string, uid?: string): Promise<PublicProduct> {
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
        playfabItemId: true,
        playfabStoreId: true,
        category: { select: { id: true, code: true, displayName: true, sortOrder: true } },
      },
    });
    if (!p || p.status !== ProductStatus.ACTIVE) {
      throw new NotFoundException(`Product "${code}" not found`);
    }

    let limitation: ItemLimitation | null = null;
    if (uid && p.playfabItemId) {
      limitation = await this.gameBackend.getItemLimitation(
        uid.toUpperCase(),
        p.playfabItemId,
        p.playfabStoreId ?? undefined,
      );
    }

    return {
      id: p.id,
      code: p.code,
      name_display: p.nameDisplay,
      amount: p.amount.toString(),
      currency: p.currency,
      effects: p.effects,
      sort_order: p.sortOrder,
      category: mapCategory(p.category),
      purchase_limit_label: extractLimitLabel(p.effects),
      playfab_item_id: p.playfabItemId,
      limitation,
    };
  }

  private async fetchLimitations(
    uid: string | undefined,
    products: Array<{ playfabItemId: string | null; playfabStoreId: string | null }>,
  ): Promise<Map<string, ItemLimitation>> {
    const map = new Map<string, ItemLimitation>();
    if (!uid) return map;

    const productsWithPlayfab = products.filter((p) => p.playfabItemId);
    if (productsWithPlayfab.length === 0) return map;

    const stores = new Set(
      productsWithPlayfab.map((p) => p.playfabStoreId ?? '__default__'),
    );

    const normalizedUid = uid.toUpperCase();
    await Promise.all(
      Array.from(stores).map(async (store) => {
        const storeID = store === '__default__' ? undefined : store;
        const limitations = await this.gameBackend.getStoreLimitations(normalizedUid, storeID);
        for (const l of limitations) {
          map.set(l.item_id, l);
        }
      }),
    );

    return map;
  }
}
