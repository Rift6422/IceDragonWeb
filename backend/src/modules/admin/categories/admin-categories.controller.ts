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

  @Delete(':id')
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentAdmin() admin: { id: string },
    @Req() req: Request,
  ): Promise<Category> {
    const deactivated = await this.categories.deactivate(id);
    await this.audit.log({
      adminId: admin.id,
      action: 'deactivate_category',
      targetType: 'category',
      targetId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
    });
    return deactivated;
  }
}
