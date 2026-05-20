import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AdminOrdersService } from './admin-orders.service';
import { ListOrdersDto } from './list-orders.dto';
import { AdminJwtGuard } from '../../../common/guards/admin-jwt.guard';
import { AdminIpWhitelistGuard } from '../../../common/guards/admin-ip-whitelist.guard';

@Controller('admin/orders')
@UseGuards(AdminIpWhitelistGuard, AdminJwtGuard)
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get()
  list(@Query() query: ListOrdersDto): Promise<unknown> {
    return this.orders.list(query);
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<unknown> {
    return this.orders.detail(id);
  }
}
