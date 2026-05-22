import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './modules/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AdminModule } from './modules/admin/admin.module';
import { MyCardModule } from './modules/mycard/mycard.module';
import { OrdersModule } from './modules/orders/orders.module';
import { DispatchModule } from './modules/dispatch/dispatch.module';
import { CallbackModule } from './modules/callback/callback.module';
import { ProductsModule } from './modules/products/products.module';
import { MyCardDirectModule } from './modules/mycard-direct/mycard-direct.module';
import { GameBackendModule } from './modules/game-backend/game-backend.module';

// 解析靜態檔目錄:
//   - prod (Docker):/app/public(Dockerfile COPY vite dist 進來)
//   - dev(compiled,backend/dist):../public → backend/public
//   - dev(compiled):../../frontend/dist → repo/frontend/dist
//   - 若全找不到 → 不掛載(dev 時前端改開 Vite dev server)
function resolveStaticRoot(): string | null {
  const candidates = [
    process.env.STATIC_DIR,
    join(__dirname, '..', 'public'),                  // /app/dist → /app/public(Docker)
    join(__dirname, '..', '..', 'public'),            // backend/dist → icedragon-pay/public(rare)
    join(__dirname, '..', '..', 'frontend', 'dist'),  // backend/dist → icedragon-pay/frontend/dist(dev)
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const STATIC_ROOT = resolveStaticRoot();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
      cache: true,
    }),
    ...(STATIC_ROOT
      ? [
          ServeStaticModule.forRoot({
            rootPath: STATIC_ROOT,
            exclude: ['/api/(.*)', '/healthz', '/healthz/(.*)'],
            serveStaticOptions: {
              index: ['index.html'],
              fallthrough: true,
            },
          }),
        ]
      : []),
    PrismaModule,
    HealthModule,
    GameBackendModule,
    MyCardModule,
    OrdersModule,
    DispatchModule,
    CallbackModule,
    AdminModule,
    ProductsModule,
    MyCardDirectModule,
  ],
})
export class AppModule {}
