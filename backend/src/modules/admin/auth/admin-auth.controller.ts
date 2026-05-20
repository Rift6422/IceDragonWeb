import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AdminAuthService, LoginResult } from './admin-auth.service';
import { LoginDto } from './login.dto';
import { AdminJwtGuard } from '../../../common/guards/admin-jwt.guard';
import { AdminIpWhitelistGuard } from '../../../common/guards/admin-ip-whitelist.guard';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';

@Controller('admin/auth')
@UseGuards(AdminIpWhitelistGuard)
export class AdminAuthController {
  constructor(private readonly auth: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<LoginResult> {
    return this.auth.login(
      dto.username,
      dto.password,
      req.ip,
      req.headers['user-agent']?.toString(),
    );
  }

  @Get('me')
  @UseGuards(AdminJwtGuard)
  me(@CurrentAdmin() admin: { id: string; username: string; role: string }): {
    id: string;
    username: string;
    role: string;
  } {
    return admin;
  }
}
