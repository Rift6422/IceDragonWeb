import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminDashboardService, DashboardStats } from './admin-dashboard.service';
import { AdminJwtGuard } from '../../../common/guards/admin-jwt.guard';
import { AdminIpWhitelistGuard } from '../../../common/guards/admin-ip-whitelist.guard';

@Controller('admin/dashboard')
@UseGuards(AdminIpWhitelistGuard, AdminJwtGuard)
export class AdminDashboardController {
  constructor(private readonly dashboard: AdminDashboardService) {}

  @Get()
  stats(): Promise<DashboardStats> {
    return this.dashboard.getStats();
  }
}
