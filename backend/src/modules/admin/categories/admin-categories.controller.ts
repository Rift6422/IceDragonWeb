import {
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
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { Category } from '@prisma/client';
import { AdminCategoriesService } from './admin-categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';
import { AdminJwtGuard } from '../../../common/guards/admin-jwt.guard';
import { AdminIpWhitelistGuard } from '../../../common/guards/admin-ip-whitelist.guard';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { AdminAuditService } from '../audit/admin-audit.service';

@Controller('admin/categories')
@UseGuards(AdminIpWhitelistGuard, AdminJwtGuard)
export class AdminCategoriesController {
  constructor(
    private readonly categories: AdminCategoriesService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list(): Promise<{ total: number; items: Array<Category & { product_count: number }> }> {
    return this.categories.list();
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<Category> {
    return this.categories.detail(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreateCategoryDto,
    @CurrentAdmin() admin: { id: string },
    @Req() req: Request,
  ): Promise<Category> {
    const created = await this.categories.create(dto);
    await this.audit.log({
      adminId: admin.id,
      action: 'create_category',
      targetType: 'category',
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
    @Body() dto: UpdateCategoryDto,
    @CurrentAdmin() admin: { id: string },
    @Req() req: Request,
  ): Promise<Category> {
    const updated = await this.categories.update(id, dto);
    await this.audit.log({
      adminId: admin.id,
      action: 'update_category',
      targetType: 'category',
      targetId: id,
      payload: dto,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
    });
    return updated;
  }

  /**
   * 軟刪除分類 — 從列表消失,底下所有商品的 categoryId 設 null(歸到「未分類」)。
   * 「停用」(可重新啟用)請改用 PATCH /api/admin/categories/:id { status: 'INACTIVE' }
   */
  @Delete(':id')
  async softDelete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: { id: string },
    @Req() req: Request,
  ): Promise<{ category: Category; products_unlinked: number }> {
    const result = await this.categories.softDelete(id);
    await this.audit.log({
      adminId: admin.id,
      action: 'delete_category',
      targetType: 'category',
      targetId: id,
      payload: { products_unlinked: result.products_unlinked },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
    });
    return result;
  }
}
