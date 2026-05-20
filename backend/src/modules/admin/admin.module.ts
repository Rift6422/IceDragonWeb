import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminDashboardController } from './dashboard/admin-dashboard.controller';
import { AdminDashboardService } from './dashboard/admin-dashboard.service';
import { AdminOrdersController } from './orders/admin-orders.controller';
import { AdminOrdersService } from './orders/admin-orders.service';
import { AdminProductsController } from './products/admin-products.controller';
import { AdminProductsService } from './products/admin-products.service';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminAuditService } from './audit/admin-audit.service';

import { AdminJwtGuard } from '../../common/guards/admin-jwt.guard';
import { AdminIpWhitelistGuard } from '../../common/guards/admin-ip-whitelist.guard';

/**
 * Admin 後台模組
 *
 * 路由(全部 prefix `/api/admin`):
 *   POST   /admin/auth/login              ← 登入(無需 JWT)
 *   GET    /admin/auth/me                 ← 取自己 admin 資訊
 *   GET    /admin/dashboard               ← 儀表板統計
 *   GET    /admin/orders                  ← 訂單列表(filter / pagination)
 *   GET    /admin/orders/:id              ← 訂單詳情(含 status history + callbacks)
 *   GET    /admin/products                ← 商品列表
 *   GET    /admin/products/:id            ← 商品詳情
 *   POST   /admin/products                ← 建商品
 *   PATCH  /admin/products/:id            ← 改商品
 *   DELETE /admin/products/:id            ← 軟刪除(status=INACTIVE)
 *   GET    /admin/users                   ← GameUser 列表(read-only)
 *   GET    /admin/users/uid/:uid          ← 用 UID 查 GameUser
 *   GET    /admin/users/:id               ← GameUser 詳情(含訂單與庫存)
 *
 * Guards 套用順序:AdminIpWhitelistGuard → AdminJwtGuard
 *   - IpWhitelist:預設 OFF,可由 env 啟用
 *   - JwtGuard:除 /admin/auth/login 外全部保護
 *
 * 不做 RBAC(權限角色)— 所有有效 JWT 等同 SUPER_ADMIN
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: cfg.get<string>('JWT_EXPIRES_IN', '8h'),
        },
      }),
    }),
  ],
  controllers: [
    AdminAuthController,
    AdminDashboardController,
    AdminOrdersController,
    AdminProductsController,
    AdminUsersController,
  ],
  providers: [
    AdminAuthService,
    AdminAuditService,
    AdminDashboardService,
    AdminOrdersService,
    AdminProductsService,
    AdminUsersService,
    AdminJwtGuard,
    AdminIpWhitelistGuard,
  ],
  exports: [AdminAuditService],
})
export class AdminModule {}
