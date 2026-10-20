import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GameBackendService } from '../game-backend/game-backend.service';
import type { ItemLimitation, StoreItem } from '../game-backend/game-backend.types';

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
  /** 自由文字商品說明(玩家 modal 顯示)。空時前端 fallback 回 effects 清單 */
  description: string | null;
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
  /** 該品項是否參與加倍活動(v2 getstoreitems 帶來,舊 endpoint fallback 時為 null)*/
  can_double?: boolean | null;
  /**
   * 玩家是否已擁有此商品(月卡類 premium 用)— 來自 getstoreitems 的 ownPremiums。
   * true → 已擁有,前端應禁用購買;null = 沒查到 uid / 非 premium 類別
   */
  owned?: boolean | null;
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
    private readonly config: ConfigService,
  ) {}

  async list(uid?: string): Promise<PublicProductsResponse> {
    const [items, categories] = await Promise.all([
      this.prisma.product.findMany({
        where: { status: ProductStatus.ACTIVE, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          code: true,
          nameDisplay: true,
          description: true,
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
        where: { status: ProductStatus.ACTIVE, deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, code: true, displayName: true, sortOrder: true },
      }),
    ]);

    const { storeMap, ownPremiums } = await this.fetchStoreItems(uid, items);
    const hasUid = !!uid;

    return {
      total: items.length,
      categories: categories.map((c) => mapCategory(c)!).filter(Boolean),
      items: items.map((p) => {
        const si = p.playfabItemId ? storeMap.get(p.playfabItemId) ?? null : null;
        const owned =
          hasUid && p.playfabItemId ? ownPremiums.has(p.playfabItemId) : null;
        return {
          id: p.id,
          code: p.code,
          name_display: p.nameDisplay,
          description: p.description,
          amount: p.amount.toString(),
          currency: p.currency,
          effects: p.effects,
          sort_order: p.sortOrder,
          category: mapCategory(p.category),
          purchase_limit_label: extractLimitLabel(p.effects),
          playfab_item_id: p.playfabItemId,
          limitation: si?.limitation ?? null,
          can_double: si?.can_double ?? null,
          owned,
        };
      }),
    };
  }

  async findByCode(code: string, uid?: string): Promise<PublicProduct> {
    const p = await this.prisma.product.findUnique({
      where: { code },
      select: {
        id: true,
        code: true,
        nameDisplay: true,
        description: true,
        amount: true,
        currency: true,
        effects: true,
        sortOrder: true,
        status: true,
        deletedAt: true,
        playfabItemId: true,
        playfabStoreId: true,
        category: { select: { id: true, code: true, displayName: true, sortOrder: true } },
      },
    });
    if (!p || p.status !== ProductStatus.ACTIVE || p.deletedAt) {
      throw new NotFoundException(`Product "${code}" not found`);
    }

    // 走 fetchStoreItems(/api/getstoreitems)— 拿到 limitation + can_double + ownPremiums
    let storeItem: StoreItem | null = null;
    let owned: boolean | null = null;
    if (uid && p.playfabItemId) {
      const { storeMap, ownPremiums } = await this.fetchStoreItems(uid, [
        { playfabItemId: p.playfabItemId, playfabStoreId: p.playfabStoreId },
      ]);
      storeItem = storeMap.get(p.playfabItemId) ?? null;
      owned = ownPremiums.has(p.playfabItemId);
    }

    return {
      id: p.id,
      code: p.code,
      name_display: p.nameDisplay,
      description: p.description,
      amount: p.amount.toString(),
      currency: p.currency,
      effects: p.effects,
      sort_order: p.sortOrder,
      category: mapCategory(p.category),
      purchase_limit_label: extractLimitLabel(p.effects),
      playfab_item_id: p.playfabItemId,
      limitation: storeItem?.limitation ?? null,
      can_double: storeItem?.can_double ?? null,
      owned,
    };
  }

  /**
   * 取得「我們關心的所有 PlayFab itemID 對應的 StoreItem」+ 玩家已擁有的 premium 清單。
   *
   * 一次帶 unique stores;失敗 / stub → 回空 map / set(不擋主流程)。
   *
   * @returns storeMap = Map<playfab_item_id, StoreItem>
   *          ownPremiums = Set<playfab_item_id>(玩家已擁有,例月卡)
   */
  private async fetchStoreItems(
    uid: string | undefined,
    products: Array<{ playfabItemId: string | null; playfabStoreId: string | null }>,
  ): Promise<{ storeMap: Map<string, StoreItem>; ownPremiums: Set<string> }> {
    const storeMap = new Map<string, StoreItem>();
    const ownPremiums = new Set<string>();
    if (!uid) return { storeMap, ownPremiums };

    const productsWithPlayfab = products.filter((p) => p.playfabItemId);
    if (productsWithPlayfab.length === 0) return { storeMap, ownPremiums };

    const defaultStoreId = this.config.get<string>('GAME_BACKEND_STORE_ID');
    // 即使所有商品都是 catalog-level(無 store),也至少帶預設 store 以確保拿到 ownPremiums
    const stores = Array.from(
      new Set(
        productsWithPlayfab
          .map((p) => p.playfabStoreId ?? defaultStoreId ?? null)
          .filter((s): s is string => !!s),
      ),
    );
    if (stores.length === 0) return { storeMap, ownPremiums };

    const result = await this.gameBackend.getStoreItems(uid.toUpperCase(), stores);
    for (const items of result.storeItems.values()) {
      for (const si of items) {
        storeMap.set(si.item_id, si);
      }
    }
    for (const id of result.ownPremiums) {
      ownPremiums.add(id);
    }
    return { storeMap, ownPremiums };
  }
}
