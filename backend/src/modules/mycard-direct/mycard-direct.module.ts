import { Module } from '@nestjs/common';
import { DirectTopupService } from './direct-topup.service';
import { BAuthResultController } from './auth-result.controller';
import { BAccountVerifyController } from './account-verify.controller';
import { BTopupResultController } from './topup-result.controller';

/**
 * MyCard 直接儲值(Model B,v1.3.0)
 *
 * 三個 callback endpoint:
 *   POST /api/mycard/direct-topup/auth-result      — 第 2 步
 *   GET  /api/mycard/direct-topup/account-verify   — 第 3 步(redirect SPA)
 *   POST /api/mycard/direct-topup/account-verify   — 第 4-7 步(submit)
 *   POST /api/mycard/direct-topup/topup-result     — 第 9-11 步
 *
 * 跟 Model A(`/api/mycard/*`)完全分離 — DB 表也是另一張(direct_topup_attempts)。
 *
 * Key 配置由 ConfigModule(global)注入,service 內 lazy 建 hash service:
 *   - 沒設 MYCARD_DIRECT_KEY1/2 → 真的被呼到時 throw,回 ERROR 文字
 *   - 設了 → 正常運作
 */
@Module({
  controllers: [
    BAuthResultController,
    BAccountVerifyController,
    BTopupResultController,
  ],
  providers: [DirectTopupService],
  exports: [DirectTopupService],
})
export class MyCardDirectModule {}
