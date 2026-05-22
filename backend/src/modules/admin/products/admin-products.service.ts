import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Product, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto, ListProductsDto, UpdateProductDto } from './product.dto';

@Injectable()
export class AdminProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListProductsDto): Promise<{ total: number; items: Product[] }> {
    const where: Prisma.ProductWhereInput = {};
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
    const product = await this.prisma.product.findUnique({ where: { id } });
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
      },
    });
  }

  /** 軟刪除:status=INACTIVE,保留歷史訂單關聯 */
  async deactivate(id: string): Promise<Product> {
    await this.detail(id);
    return this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.INACTIVE },
    });
  }
}
