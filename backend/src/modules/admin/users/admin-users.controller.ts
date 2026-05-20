import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { ListUsersDto } from './list-users.dto';
import { AdminJwtGuard } from '../../../common/guards/admin-jwt.guard';
import { AdminIpWhitelistGuard } from '../../../common/guards/admin-ip-whitelist.guard';

/**
 * GameUser 後台 — 嚴格 read-only(決議 #A5)
 *
 * GET 路徑:
 *   /api/admin/users           list with filters
 *   /api/admin/users/:id       by user.id (uuid)
 *   /api/admin/users/uid/:uid  by uid (16-char hex)
 *
 * 沒有任何 POST / PATCH / DELETE — GameUser 由遊戲端建立,本系統不寫
 */
@Controller('admin/users')
@UseGuards(AdminIpWhitelistGuard, AdminJwtGuard)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(@Query() query: ListUsersDto): Promise<unknown> {
    return this.users.list(query);
  }

  @Get('uid/:uid')
  byUid(@Param('uid') uid: string): Promise<unknown> {
    return this.users.detailByUid(uid);
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<unknown> {
    return this.users.detail(id);
  }
}
