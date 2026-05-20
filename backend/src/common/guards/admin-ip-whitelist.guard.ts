import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * 後台 IP 白名單 guard
 *
 * 行為:
 *   - `ADMIN_IP_WHITELIST_ENABLED=false`(預設)→ 直接放行,不擋
 *   - `ADMIN_IP_WHITELIST_ENABLED=true` 但 `ADMIN_IP_WHITELIST` 為空 → 全擋
 *     (避免「忘了填 IP 就上線」造成自己鎖外)
 *   - `ADMIN_IP_WHITELIST_ENABLED=true` + IP 不在清單 → 403
 *
 * IP 來源:`req.ip`(由 `trust proxy` 配置自動取 X-Forwarded-For / CF-Connecting-IP)
 *
 * 上線啟用前 checklist:
 *   1. 確認 Cloudflare 把 `CF-Connecting-IP` 傳到 origin
 *   2. 確認 `app.set('trust proxy', 1)` 已設(main.ts)
 *   3. 用測試環境試:用允許 IP / 不允許 IP 各打一次
 */
@Injectable()
export class AdminIpWhitelistGuard implements CanActivate {
  private readonly logger = new Logger(AdminIpWhitelistGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const enabled = this.config.get<string>('ADMIN_IP_WHITELIST_ENABLED') === 'true';
    if (!enabled) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    const clientIp = req.ip ?? '';

    const raw = this.config.get<string>('ADMIN_IP_WHITELIST') ?? '';
    const allowed = raw
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);

    if (allowed.length === 0) {
      this.logger.error(
        `IP whitelist enabled but list is empty — blocking all access. Set ADMIN_IP_WHITELIST.`,
      );
      throw new ForbiddenException('Admin access blocked: IP whitelist misconfigured');
    }

    if (!allowed.includes(clientIp)) {
      this.logger.warn(`Admin access denied: ${clientIp} not in whitelist`);
      throw new ForbiddenException(`IP ${clientIp} not whitelisted`);
    }

    return true;
  }
}
