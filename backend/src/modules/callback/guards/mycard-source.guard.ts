import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

/**
 * MyCard inbound callback 來源驗證 guard
 *
 * 規則:
 *   - User-Agent 必須是 `MyCardGlobalBilling/1.0`(v3.9 §3.6 / §3.7)
 *   - IP 必須是 MyCard 公告的白名單(test / prod 自動切)
 *
 * 例外:玩家瀏覽器付款完從 MyCard form-submit 回 `/trade-result`,
 *      UA / IP 都不會是 MyCard server。這時不能 403,要 302 導回首頁。
 *      識別:method=POST、path 結尾 /trade-result、UA 不是 MyCard server。
 *
 * Mock mode(MYCARD_MOCK_MODE=true)→ 跳過,允許本地測試
 *
 * 其他失敗回 403,且**不洩漏失敗原因**(避免攻擊者試探)
 */
@Injectable()
export class MyCardSourceGuard implements CanActivate {
  private readonly logger = new Logger(MyCardSourceGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const mockMode = this.config.get<string>('MYCARD_MOCK_MODE') === 'true';
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const clientIp = req.ip ?? '';
    const ua = req.headers['user-agent']?.toString() ?? '';
    const expectedUA = this.config.get<string>('MYCARD_USER_AGENT', 'MyCardGlobalBilling/1.0');

    if (mockMode) {
      this.logger.warn(`[MOCK] callback from ${clientIp} (UA=${ua}) — skipping source check`);
      return true;
    }

    // 玩家瀏覽器 form-submit 回 /trade-result:不 block,改 302 導回首頁
    // (MyCard「返回商家」按鈕在某些渠道是 form POST 而非 GET)
    if (ua !== expectedUA && req.method === 'POST' && this.isTradeResultPath(req)) {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const facTradeSeq = typeof body.FacTradeSeq === 'string' ? body.FacTradeSeq.trim() : '';
      const target = facTradeSeq
        ? `/?paid=${encodeURIComponent(facTradeSeq)}`
        : '/';
      this.logger.log(
        `Browser POST to trade-result from ${clientIp} (UA=${ua.slice(0, 40)}) → 302 ${target}`,
      );
      res.redirect(302, target);
      return false; // 已寫入 response,NestJS 不會再覆蓋
    }

    // UA 檢查
    if (ua !== expectedUA) {
      this.logger.warn(`MyCard callback rejected: UA mismatch (got "${ua}")`);
      throw new ForbiddenException();
    }

    // IP 白名單檢查
    const sandbox = this.config.get<string>('MYCARD_SANDBOX_MODE') === 'true';
    const rawAllowed = sandbox
      ? this.config.get<string>('MYCARD_INBOUND_IP_TEST', '218.32.37.148,40.83.124.36')
      : this.config.get<string>(
          'MYCARD_INBOUND_IP_PROD',
          '220.130.127.125,40.81.30.67,40.81.29.75,210.71.189.165,210.71.189.161',
        );
    const allowed = rawAllowed
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);

    if (!allowed.includes(clientIp)) {
      this.logger.warn(`MyCard callback rejected: IP ${clientIp} not in whitelist`);
      throw new ForbiddenException();
    }

    return true;
  }

  private isTradeResultPath(req: Request): boolean {
    const p = req.path ?? req.originalUrl ?? req.url ?? '';
    return p.endsWith('/trade-result') || p.endsWith('/trade-result/');
  }
}
