import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Category, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';

@Injectable()
export class AdminCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<{ total: number; items: Array<Category & { product_count: number }> }> {
    const items = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return {
      total: items.length,
      items: items.map(({ _count, ...c }) => ({ ...c, product_count: _count.products })),
    };
  }

  async detail(id: string): Promise<Category> {
    const c = await this.prisma.category.findUnique({ where: { id } });
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

  /** 軟刪除:status=INACTIVE,保留底下商品的 FK */
  async deactivate(id: string): Promise<Category> {
    await this.detail(id);
    return this.prisma.category.update({
      where: { id },
      data: { status: ProductStatus.INACTIVE },
    });
  }
}
