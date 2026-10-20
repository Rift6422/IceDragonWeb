import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Product, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GameBackendService } from '../../game-backend/game-backend.service';
import type { StoreItem } from '../../game-backend/game-backend.types';
import { CreateProductDto, ListProductsDto, UpdateProductDto } from './product.dto';

export interface AdminStoreItemEntry {
  playfab_item_id: string;
  store_id: string;
  can_double: boolean;
  limitation: null | {
    limit_period: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'ALL_TIME';
    max_quantity: number;
    left_quantity: number;
    reset_at: string | null;
  };
}

export interface AdminStoreItemsResponse {
  uid: string;
  fetched_at: string;
  store_ids: string[];
  /** 沒對接遊戲端或失敗時為 true,前端顯示提示 */
  stub_or_failed: boolean;
  /** key = playfab_item_id */
  items: Record<string, AdminStoreItemEntry>;
  /** 玩家已擁有的 premium itemId 清單(月卡類)*/
  own_premiums: string[];
}

@Injectable()
export class AdminProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameBackend: GameBackendService,
    private readonly config: ConfigService,
  ) {}

  async list(query: ListProductsDto): Promise<{ total: number; items: Product[] }> {
    // 預設不顯示已軟刪除的;list / detail 都過濾
    const where: Prisma.ProductWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;

    const [total, items] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: query.limit ?? 100,
        skip: query.offset ?? 0,
      }),
    ]);
    return { total, items };
  }

  async detail(id: string): Promise<Product> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async create(dto: CreateProductDto): Promise<Product> {
    const existing = await this.prisma.product.findUnique({ where: { code: dto.code } });
    if (existing) {
      throw new ConflictException(`Product code "${dto.code}" already exists`);
    }
    return this.prisma.product.create({
      data: {
        code: dto.code,
        mycardItemCode: dto.mycard_item_code ?? null,
        nameDisplay: dto.name_display,
        nameInternal: dto.name_internal,
        description: dto.description ?? null,
        amount: dto.amount,
        currency: dto.currency ?? 'TWD',
        effects: dto.effects as Prisma.InputJsonValue,
        status: dto.status ?? ProductStatus.ACTIVE,
        sortOrder: dto.sort_order ?? 0,
        playfabItemId: dto.playfab_item_id ?? null,
        playfabStoreId: dto.playfab_store_id ?? null,
        playfabCatalog: dto.playfab_catalog ?? null,
        categoryId: dto.category_id ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    await this.detail(id);
    return this.prisma.product.update({
      where: { id },
      data: {
        mycardItemCode: dto.mycard_item_code,
        nameDisplay: dto.name_display,
        nameInternal: dto.name_internal,
        description: dto.description,
        amount: dto.amount,
        currency: dto.currency,
        effects: dto.effects as Prisma.InputJsonValue | undefined,
        status: dto.status,
        sortOrder: dto.sort_order,
        playfabItemId: dto.playfab_item_id,
        playfabStoreId: dto.playfab_store_id,
        playfabCatalog: dto.playfab_catalog,
        categoryId: dto.category_id,
      },
    });
  }

  /** 下架:status=INACTIVE,仍留在後台列表,可重新上架 */
  async deactivate(id: string): Promise<Product> {
    await this.detail(id);
    return this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.INACTIVE },
    });
  }

  /** 軟刪除:設 deletedAt,從後台 + 玩家前台都消失,保留歷史訂單 FK */
  async softDelete(id: string): Promise<Product> {
    await this.detail(id);
    return this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: ProductStatus.INACTIVE },
    });
  }

  /**
   * 以「指定 UID」的視角拉所有商品的限購資訊 — 後台 debug / 客服查詢用。
   *
   * 一次帶全部 store(unique 後),呼叫 /api/getstoreitems。
   * 回傳的 map 用 playfab_item_id 當 key,方便前端 join product list。
   *
   * 沒對接遊戲端 / 失敗時:items = {} + stub_or_failed = true(前端顯示提示)。
   */
  async getStoreItemsForUid(uid: string): Promise<AdminStoreItemsResponse> {
    const normalizedUid = uid.toUpperCase();

    const products = await this.prisma.product.findMany({
      where: { deletedAt: null, playfabItemId: { not: null } },
      select: { playfabItemId: true, playfabStoreId: true },
    });

    const defaultStoreId = this.config.get<string>('GAME_BACKEND_STORE_ID');
    const stores = Array.from(
      new Set(
        products
          .map((p) => p.playfabStoreId ?? defaultStoreId ?? null)
          .filter((s): s is string => !!s),
      ),
    );

    const items: Record<string, AdminStoreItemEntry> = {};
    let ownPremiums: string[] = [];
    let stubOrFailed = false;

    if (stores.length === 0) {
      stubOrFailed = true;
    } else {
      const result = await this.gameBackend.getStoreItems(normalizedUid, stores);
      if (result.storeItems.size === 0 && result.ownPremiums.length === 0) {
        stubOrFailed = true;
      } else {
        for (const list of result.storeItems.values()) {
          for (const si of list) {
            items[si.item_id] = this.shapeStoreItem(si);
          }
        }
        ownPremiums = result.ownPremiums;
      }
    }

    return {
      uid: normalizedUid,
      fetched_at: new Date().toISOString(),
      store_ids: stores,
      stub_or_failed: stubOrFailed,
      items,
      own_premiums: ownPremiums,
    };
  }

  private shapeStoreItem(si: StoreItem): AdminStoreItemEntry {
    return {
      playfab_item_id: si.item_id,
      store_id: si.store_id,
      can_double: si.can_double,
      limitation: si.limitation
        ? {
            limit_period: si.limitation.limit_period,
            max_quantity: si.limitation.max_quantity,
            left_quantity: si.limitation.left_quantity,
            reset_at: si.limitation.reset_at,
          }
        : null,
    };
  }
}
