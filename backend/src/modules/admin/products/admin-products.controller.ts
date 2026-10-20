import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Product } from '@prisma/client';
import { AdminProductsService, AdminStoreItemsResponse } from './admin-products.service';
import { CreateProductDto, ListProductsDto, UpdateProductDto } from './product.dto';
import { AdminJwtGuard } from '../../../common/guards/admin-jwt.guard';
import { AdminIpWhitelistGuard } from '../../../common/guards/admin-ip-whitelist.guard';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { AdminAuditService } from '../audit/admin-audit.service';

@Controller('admin/products')
@UseGuards(AdminIpWhitelistGuard, AdminJwtGuard)
export class AdminProductsController {
  constructor(
    private readonly products: AdminProductsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list(@Query() query: ListProductsDto): Promise<{ total: number; items: Product[] }> {
    return this.products.list(query);
  }

  /**
   * 以指定 UID 視角拉所有商品的限購資訊(debug / 客服查詢)。
   * 注意:必須放在 `:id` route 之前,否則會被 ParseUUIDPipe 攔截。
   */
  @Get('store-items')
  storeItems(@Query('uid') uid?: string): Promise<AdminStoreItemsResponse> {
    if (!uid || !/^[0-9A-Fa-f]{16}$/.test(uid)) {
      throw new BadRequestException('uid 必填,且為 16 碼 hex');
    }
    return this.products.getStoreItemsForUid(uid);
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<Product> {
    return this.products.detail(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateProductDto,
    @CurrentAdmin() admin: { id: string },
    @Req() req: Request,
  ): Promise<Product> {
    const created = await this.products.create(dto);
    await this.audit.log({
      adminId: admin.id,
      action: 'create_product',
      targetType: 'product',
      targetId: created.id,
      payload: { code: created.code },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
    });
    return created;
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentAdmin() admin: { id: string },
    @Req() req: Request,
  ): Promise<Product> {
    const updated = await this.products.update(id, dto);
    await this.audit.log({
      adminId: admin.id,
      action: 'update_product',
      targetType: 'product',
      targetId: id,
      payload: dto,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
    });
    return updated;
  }

  /**
   * 軟刪除商品 — 設 deletedAt,從後台列表 + 玩家前台都消失。
   * 「下架」(可重新上架)請改用 PATCH /api/admin/products/:id { status: 'INACTIVE' }
   */
  @Delete(':id')
  async softDelete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: { id: string },
    @Req() req: Request,
  ): Promise<Product> {
    const deleted = await this.products.softDelete(id);
    await this.audit.log({
      adminId: admin.id,
      action: 'delete_product',
      targetType: 'product',
      targetId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
    });
    return deleted;
  }
}
