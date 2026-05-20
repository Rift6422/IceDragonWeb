import { HttpException, HttpStatus, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { comparePassword } from '../../../common/utils/password.util';
import { AdminAuditService } from '../audit/admin-audit.service';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MIN = 30;

export interface LoginResult {
  access_token: string;
  expires_in: number;
  admin: {
    id: string;
    username: string;
    role: string;
    email: string;
  };
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AdminAuditService,
  ) {}

  async login(
    username: string,
    password: string,
    ip?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const admin = await this.prisma.adminUser.findUnique({ where: { username } });

    // 帳號不存在 — 不洩漏「是密碼錯還是帳號錯」
    if (!admin) {
      this.logger.warn(`Login failed: unknown user "${username}" from ${ip}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // 帳號被停用
    if (!admin.isActive) {
      this.logger.warn(`Login attempt on disabled account: ${username}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // 帳號被鎖定中
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      const remainingSec = Math.ceil((admin.lockedUntil.getTime() - Date.now()) / 1000);
      throw new HttpException(
        { message: `Account locked. Try again in ${remainingSec} seconds.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 密碼比對
    const ok = await comparePassword(password, admin.passwordHash);
    if (!ok) {
      const failedCount = admin.failedLoginCount + 1;
      const update: { failedLoginCount: number; lockedUntil?: Date } = {
        failedLoginCount: failedCount,
      };

      if (failedCount >= MAX_FAILED_ATTEMPTS) {
        update.lockedUntil = new Date(Date.now() + LOCK_DURATION_MIN * 60 * 1000);
        this.logger.warn(
          `Account "${username}" locked after ${failedCount} failed attempts (${LOCK_DURATION_MIN} min)`,
        );
      }

      await this.prisma.adminUser.update({
        where: { id: admin.id },
        data: update,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    // 登入成功 — reset failed count + 更新 last login
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip,
      },
    });

    // 簽 JWT
    const expiresIn = this.config.get<string>('JWT_EXPIRES_IN', '8h');
    const access_token = await this.jwt.signAsync(
      { sub: admin.id, username: admin.username, role: admin.role },
      {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn,
      },
    );

    // 寫 audit log
    await this.audit.log({
      adminId: admin.id,
      action: 'login',
      ipAddress: ip,
      userAgent,
    });

    return {
      access_token,
      expires_in: this.parseExpiresIn(expiresIn),
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        email: admin.email,
      },
    };
  }

  /** 將 '8h' / '1d' / '60s' 等格式轉成秒數(回傳給 client 顯示) */
  private parseExpiresIn(input: string): number {
    const match = /^(\d+)([smhd])$/.exec(input);
    if (!match) return 8 * 60 * 60;
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
    return n * multiplier;
  }
}
