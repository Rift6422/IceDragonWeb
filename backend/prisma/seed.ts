/**
 * 種子資料(本地開發 + UAT 測試用)
 *
 * 跑法:
 *   npx prisma db seed
 * 或:
 *   npm run prisma:seed
 *
 * 注意:
 * - 本檔只塞「假資料」與「測試帳號」,**正式環境絕對不要跑**
 * - 若已存在資料(by code / username),會 upsert 不會重塞
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/** 16-char uppercase hex UID,對齊遊戲端格式(決議 #A4)
 *  ⚠️ Seed 才用 — 正式環境 GameUser 由遊戲端建立(決議 #A5),本系統不主動產
 */
function generateUid(): string {
  return randomBytes(8).toString('hex').toUpperCase();
}

/** 預設 admin 密碼(seed 完用 admin/admin123 登入) */
const DEFAULT_ADMIN_PASSWORD = 'admin123';

async function main(): Promise<void> {
  console.log('🌱 開始 seed...\n');

  // ===========================================================
  // 後台帳號(僅 dev,正式請改密碼或刪除)
  // ⚠️ 此帳號 = AdminUser,跟 GameUser 完全分離
  // ===========================================================
  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
  const admin = await prisma.adminUser.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@icedragon-games.com',
      passwordHash,
      role: 'SUPER_ADMIN',
      isActive: true,
    },
  });
  console.log(`✅ Admin user: ${admin.username} (password: ${DEFAULT_ADMIN_PASSWORD})`);

  // ===========================================================
  // 測試 GameUser(本地 dev 用假資料)
  // ⚠️ 正式環境 GameUser 由遊戲端建立(決議 #A5),本 seed 僅供 dev
  // ===========================================================
  const testUser = await prisma.user.upsert({
    where: { email: 'tester@example.com' },
    update: {},
    create: {
      uid: 'E9E3E1A9071AF9DC', // 文件範例 UID
      email: 'tester@example.com',
      emailVerified: true,
      displayName: 'Test Player',
    },
  });
  console.log(`✅ Test user:   ${testUser.email} (UID: ${testUser.uid})`);

  // 額外產 2 個隨機 UID 玩家(upsert by email,避免重跑 seed 時 email 衝突)
  for (let i = 0; i < 2; i++) {
    const email = `player${i + 1}@example.com`;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`✅ Random user: UID ${existing.uid} (existing)`);
      continue;
    }
    const created = await prisma.user.create({
      data: {
        uid: generateUid(),
        email,
        displayName: `Player ${i + 1}`,
      },
    });
    console.log(`✅ Random user: UID ${created.uid}`);
  }

  // ===========================================================
  // 商品
  //
  // 分類由 code 前綴推導(public-products.service.ts deriveCategory):
  //   BUNDLE_*  → 超值禮包(BUNDLE)
  //   其餘       → 啟源石面額(CURRENCY)
  //
  // 註:effect.code 維持 DIAMOND 為「貨幣穩定識別」(跟遊戲端對齊),
  //     display_label 才是玩家看得到的「啟源石」文案。後台 form 可改 display_label。
  //
  // effects schema:
  //   {
  //     effects: [{ type, code, amount, display_label? }],
  //     mail:    { subject, body, expire_days },
  //     icon?: '🎁',                       // 前端展示用 emoji
  //     purchase_limit_label?: '每日限購 1/1' // 純展示,後端不擋(MVP)
  //   }
  // ===========================================================
  const products = [
    // ---------- 超值禮包(BUNDLE) ----------
    {
      code: 'BUNDLE_STARTER',
      nameDisplay: '新手啟源包',
      nameInternal: '新手啟源包(限購一次)',
      amount: '30',
      effects: {
        effects: [
          { type: 'currency', code: 'DIAMOND', amount: 30, display_label: '啟源石' },
          { type: 'currency', code: 'CRYSTAL', amount: 5000, display_label: '源結晶' },
        ],
        mail: { subject: '購買成功 - 新手啟源包', body: '歡迎來到 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/bundle-default.jpg',
        purchase_limit_label: '限購 1/1',
      },
      sortOrder: 11,
    },
    {
      code: 'BUNDLE_VALUE_CHAR',
      nameDisplay: '超值角色包',
      nameInternal: '超值角色包',
      amount: '150',
      effects: {
        effects: [
          { type: 'currency', code: 'DIAMOND', amount: 150, display_label: '啟源石' },
          { type: 'item', code: 'CHAR_AWAKEN_STONE', amount: 5, display_label: '角色突破石' },
        ],
        mail: { subject: '購買成功 - 超值角色包', body: '感謝您支持 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/bundle-default.jpg',
        purchase_limit_label: '限購 1/1',
      },
      sortOrder: 12,
    },
    {
      code: 'BUNDLE_VALUE_PICK',
      nameDisplay: '超值自選包',
      nameInternal: '超值自選包',
      amount: '450',
      effects: {
        effects: [
          { type: 'currency', code: 'DIAMOND', amount: 450, display_label: '啟源石' },
          { type: 'item', code: 'PICK_CARD', amount: 1, display_label: '自選卡' },
        ],
        mail: { subject: '購買成功 - 超值自選包', body: '感謝您支持 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/bundle-default.jpg',
        purchase_limit_label: '限購 1/1',
      },
      sortOrder: 13,
    },
    {
      code: 'BUNDLE_DAILY',
      nameDisplay: '每日限購禮包',
      nameInternal: '每日限購禮包',
      amount: '30',
      effects: {
        effects: [
          { type: 'currency', code: 'DIAMOND', amount: 30, display_label: '啟源石' },
          { type: 'currency', code: 'CRYSTAL', amount: 5000, display_label: '源結晶' },
        ],
        mail: { subject: '購買成功 - 每日限購禮包', body: '感謝您支持 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/bundle-default.jpg',
        purchase_limit_label: '每日限購 1/1',
      },
      sortOrder: 21,
    },
    {
      code: 'BUNDLE_WEEKLY',
      nameDisplay: '每週限購禮包',
      nameInternal: '每週限購禮包',
      amount: '290',
      effects: {
        effects: [
          { type: 'currency', code: 'DIAMOND', amount: 75, display_label: '啟源石(付費)' },
          { type: 'currency', code: 'CRYSTAL', amount: 100000, display_label: '源結晶' },
        ],
        mail: { subject: '購買成功 - 每週限購禮包', body: '感謝您支持 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/bundle-default.jpg',
        purchase_limit_label: '每週限購 2/2',
      },
      sortOrder: 22,
    },
    {
      code: 'BUNDLE_MONTHLY',
      nameDisplay: '每月限購禮包',
      nameInternal: '每月限購禮包',
      amount: '890',
      effects: {
        effects: [
          { type: 'currency', code: 'DIAMOND', amount: 300, display_label: '啟源石(付費)' },
          { type: 'currency', code: 'CRYSTAL', amount: 500000, display_label: '源結晶' },
          { type: 'item', code: 'CHAR_AWAKEN_STONE', amount: 5, display_label: '角色突破石' },
        ],
        mail: { subject: '購買成功 - 每月限購禮包', body: '感謝您支持 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/bundle-default.jpg',
        purchase_limit_label: '每月限購 3/3',
      },
      sortOrder: 23,
    },
    {
      code: 'BUNDLE_STONE_PACK',
      nameDisplay: '啟源石禮包',
      nameInternal: '啟源石禮包(限購二次)',
      amount: '290',
      effects: {
        effects: [
          { type: 'currency', code: 'DIAMOND', amount: 80, display_label: '啟源石' },
          { type: 'currency', code: 'CRYSTAL', amount: 20000, display_label: '源結晶' },
        ],
        mail: { subject: '購買成功 - 啟源石禮包', body: '感謝您支持 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/stone-default.jpg',
        purchase_limit_label: '每月限購 2/2',
      },
      sortOrder: 24,
    },

    // ---------- 啟源石(CURRENCY)— 直接面額儲值 ----------
    {
      code: 'DIAMOND_30',
      nameDisplay: '啟源石 30',
      nameInternal: '啟源石 30 顆',
      amount: '30',
      effects: {
        effects: [{ type: 'currency', code: 'DIAMOND', amount: 30, display_label: '啟源石' }],
        mail: { subject: '購買成功 - 30 啟源石', body: '感謝您支持 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/stone-default.jpg',
      },
      sortOrder: 110,
    },
    {
      code: 'DIAMOND_150',
      nameDisplay: '啟源石 150',
      nameInternal: '啟源石 150 顆',
      amount: '150',
      effects: {
        effects: [{ type: 'currency', code: 'DIAMOND', amount: 150, display_label: '啟源石' }],
        mail: { subject: '購買成功 - 150 啟源石', body: '感謝您支持 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/stone-default.jpg',
      },
      sortOrder: 120,
    },
    {
      code: 'DIAMOND_500',
      nameDisplay: '啟源石 500+25',
      nameInternal: '啟源石 500 顆 + 5% 加贈',
      amount: '500',
      effects: {
        effects: [{ type: 'currency', code: 'DIAMOND', amount: 525, display_label: '啟源石' }],
        mail: { subject: '購買成功 - 500 啟源石 + 5% 加贈', body: '感謝您支持 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/stone-default.jpg',
      },
      sortOrder: 130,
    },
    {
      code: 'DIAMOND_1000',
      nameDisplay: '啟源石 1000+80',
      nameInternal: '啟源石 1000 顆 + 8% 加贈',
      amount: '1000',
      effects: {
        effects: [{ type: 'currency', code: 'DIAMOND', amount: 1080, display_label: '啟源石' }],
        mail: { subject: '購買成功 - 1000 啟源石 + 8% 加贈', body: '感謝您支持 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/stone-default.jpg',
      },
      sortOrder: 140,
    },
    {
      code: 'DIAMOND_3000',
      nameDisplay: '啟源石 3000+300',
      nameInternal: '啟源石 3000 顆 + 10% 加贈',
      amount: '3000',
      effects: {
        effects: [{ type: 'currency', code: 'DIAMOND', amount: 3300, display_label: '啟源石' }],
        mail: { subject: '購買成功 - 3000 啟源石 + 10% 加贈', body: '感謝您支持 冰龍遊戲!', expire_days: 30 },
        icon: '/icons/stone-default.jpg',
      },
      sortOrder: 150,
    },
  ] as Array<{
    code: string;
    mycardItemCode?: string | null;
    nameDisplay: string;
    nameInternal: string;
    amount: string;
    effects: Record<string, unknown>;
    sortOrder: number;
  }>;

  for (const p of products) {
    const created = await prisma.product.upsert({
      where: { code: p.code },
      // 已存在的商品全面覆寫 effects + 名稱 + sort_order(讓 seed 多次跑也能更新展示)
      update: {
        nameDisplay: p.nameDisplay,
        nameInternal: p.nameInternal,
        amount: p.amount,
        effects: p.effects as Prisma.InputJsonValue,
        sortOrder: p.sortOrder,
      },
      create: {
        code: p.code,
        mycardItemCode: p.mycardItemCode ?? null,
        nameDisplay: p.nameDisplay,
        nameInternal: p.nameInternal,
        amount: p.amount,
        currency: 'TWD',
        effects: p.effects as Prisma.InputJsonValue,
        status: 'ACTIVE',
        sortOrder: p.sortOrder,
      },
    });
    console.log(`✅ Product: ${created.code} - NT$${created.amount}`);
  }

  console.log('\n🎉 Seed 完成!');
  console.log('\n登入後台:');
  console.log(`  username: admin`);
  console.log(`  password: ${DEFAULT_ADMIN_PASSWORD} (僅 dev,正式請改)`);
  console.log(`  endpoint: POST http://localhost:3000/api/admin/auth/login`);
}

main()
  .catch((err) => {
    console.error('❌ Seed 失敗:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
