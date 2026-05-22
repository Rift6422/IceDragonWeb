import { Injectable, NotFoundException } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GameBackendService } from '../game-backend/game-backend.service';
import type { ItemLimitation } from '../game-backend/game-backend.types';

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
  /** PlayFab itemId(對應遊戲端商品)— 玩家不需要看到,但 admin 用得到 */
  playfab_item_id?: string | null;
  /**
   * 限購狀態(僅在 list/findByCode 帶 uid 時填入)
   *
   * - `null` = 沒對該玩家查(沒帶 uid)或商品無限購設定
   * - 否則 = 對該玩家當前剩餘次數 / 重置時間
   */
  limitation?: ItemLimitation | null;
}

function deriveCategory(code: string): ProductCategory {
  return code.startsWith('BUNDLE_') ? 'BUNDLE' : 'CURRENCY';
}

function extractLimitLabel(effects: unknown): string | null {
  if (effects && typeof effects === 'object' && 'purchase_limit_label' in effects) {
    const v = (effects as Record<string, unknown>).purchase_limit_label;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

@Injectable()
export class PublicProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameBackend: GameBackendService,
  ) {}

  /**
   * 列商品。若帶 uid 會多打一次 GameBackend 拿限購剩餘次數。
   *
   * uid 不存在玩家也沒關係 — GameBackend 端會回空 / 各 itemID 沒 entry → 顯示「未對接」狀態
   */
  async list(uid?: string): Promise<{ total: number; items: PublicProduct[] }> {
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
        playfabItemId: true,
        playfabStoreId: true,
      },
    });

    const limitationMap = await this.fetchLimitations(uid, items);

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
      category: deriveCategory(p.code),
      purchase_limit_label: extractLimitLabel(p.effects),
      playfab_item_id: p.playfabItemId,
      limitation,
    };
  }

  /**
   * 取得整批商品對應的限購資訊(以 playfabItemId 為 key)。
   *
   * 為了減少對 GameBackend 的呼叫:**對同一 storeID 只打一次**,把整批拉回。
   * 若商品分散在多個 storeID 各打一次。
   */
  private async fetchLimitations(
    uid: string | undefined,
    products: Array<{ playfabItemId: string | null; playfabStoreId: string | null }>,
  ): Promise<Map<string, ItemLimitation>> {
    const map = new Map<string, ItemLimitation>();
    if (!uid) return map;

    const productsWithPlayfab = products.filter((p) => p.playfabItemId);
    if (productsWithPlayfab.length === 0) return map;

    // 同 storeID 一起查
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
