import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';

const BCRYPT_COST = 10;
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

/**
 * 開機時把 ADMIN_USERNAME / ADMIN_PASSWORD 同步進 admin_users。
 *
 * 設計(方法 B,env 為帳密唯一來源):
 *   - 改帳號/密碼 = Zeabur 改 ADMIN_USERNAME / ADMIN_PASSWORD env → Redeploy(不碰 DB、不重 build)
 *   - 每次開機都 upsert,既有帳號的密碼會被覆寫成 env 值
 *   - 連帶解鎖(清 failedLoginCount / lockedUntil),避免被鎖死後沒法救
 *   - **env 指定的帳號 = 唯一有效管理員**:開機移除其他所有 admin 帳號
 *     (能硬刪就刪;有 audit log 被 FK 擋住的改停用 isActive=false),
 *     避免舊的預設 admin/admin123 變成後門。
 *     改 ADMIN_USERNAME 的效果 = 換掉唯一登入帳號(等同改名),不是多開一個。
 *   - 不填 env → 預設 admin / admin123(僅 dev 方便,正式務必改)
 *
 * 注意:密碼無長度下限(已移除),使用預設密碼時會 log 警告。
 */
@Injectable()
export class AdminBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const username = this.config.get<string>('ADMIN_USERNAME', DEFAULT_ADMIN_USERNAME);
    const password = this.config.get<string>('ADMIN_PASSWORD', DEFAULT_ADMIN_PASSWORD);

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    const admin = await this.prisma.adminUser.upsert({
      where: { username },
      // 既有帳號:覆寫密碼 + 解鎖,其餘(email / role)維持不動
      update: {
        passwordHash,
        failedLoginCount: 0,
        lockedUntil: null,
        isActive: true,
      },
      create: {
        username,
        email: `${username}@icedragon-games.com`,
        passwordHash,
        role: 'SUPER_ADMIN',
        isActive: true,
      },
    });

    // env 帳號 = 唯一有效管理員:移除其他所有帳號(擋掉舊的預設 admin/admin123 後門)
    // 能硬刪就刪;有 audit log 的(FK Restrict 擋住)退而求其次停用,避免摧毀金流稽核軌跡 / crash 開機。
    const others = await this.prisma.adminUser.findMany({
      where: { id: { not: admin.id } },
      select: { id: true, username: true },
    });
    let deleted = 0;
    let disabled = 0;
    for (const other of others) {
      try {
        await this.prisma.adminUser.delete({ where: { id: other.id } });
        deleted++;
      } catch {
        // 有 AdminAuditLog 參照 → 保留 row 但停用,登入端點的 isActive 檢查會擋掉
        await this.prisma.adminUser.update({
          where: { id: other.id },
          data: { isActive: false },
        });
        disabled++;
      }
    }
    if (deleted + disabled > 0) {
      this.logger.warn(
        `舊 admin 帳號清理:刪除 ${deleted} 個、停用 ${disabled} 個 — 現在唯一有效登入為 "${username}"`,
      );
    }

    if (password === DEFAULT_ADMIN_PASSWORD) {
      this.logger.warn(
        `Admin "${username}" 使用預設密碼 — 正式環境請設定 ADMIN_PASSWORD env`,
      );
    } else {
      this.logger.log(`Admin "${username}" 密碼已由環境變數同步`);
    }
  }
}
