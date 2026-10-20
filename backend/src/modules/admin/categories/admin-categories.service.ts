import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Category, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';

@Injectable()
export class AdminCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<{ total: number; items: Array<Category & { product_count: number }> }> {
    // 已軟刪除的不顯示;product_count 也只算「未軟刪除」的商品
    const items = await this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { products: { where: { deletedAt: null } } } },
      },
    });
    return {
      total: items.length,
      items: items.map(({ _count, ...c }) => ({ ...c, product_count: _count.products })),
    };
  }

  async detail(id: string): Promise<Category> {
    const c = await this.prisma.category.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException(`Category ${id} not found`);
    return c;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    const existing = await this.prisma.category.findUnique({ where: { code: dto.code } });
    if (existing) throw new ConflictException(`Category code "${dto.code}" already exists`);

    return this.prisma.category.create({
      data: {
        code: dto.code,
        displayName: dto.display_name,
        sortOrder: dto.sort_order ?? 0,
        status: dto.status ?? ProductStatus.ACTIVE,
      },
    });
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    await this.detail(id);
    return this.prisma.category.update({
      where: { id },
      data: {
        displayName: dto.display_name,
        sortOrder: dto.sort_order,
        status: dto.status,
      },
    });
  }

  /** 停用:status=INACTIVE,保留底下商品的 FK,可重新啟用 */
  async deactivate(id: string): Promise<Category> {
    await this.detail(id);
    return this.prisma.category.update({
      where: { id },
      data: { status: ProductStatus.INACTIVE },
    });
  }

  /**
   * 軟刪除:設 deletedAt,從列表消失。
   * 同 transaction 把底下所有 products 的 categoryId 設 null(歸到「未分類」)— 避免商品消失
   */
  async softDelete(id: string): Promise<{ category: Category; products_unlinked: number }> {
    await this.detail(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateMany({
        where: { categoryId: id, deletedAt: null },
        data: { categoryId: null },
      });
      const category = await tx.category.update({
        where: { id },
        data: { deletedAt: new Date(), status: ProductStatus.INACTIVE },
      });
      return { category, products_unlinked: updated.count };
    });
  }
}
