import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

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
    // 在 Cloudflare + Zeabur 後面,直接 req.ip 拿到的可能是 proxy IP
    // Cloudflare 一定會帶 CF-Connecting-IP = 原始 client IP(無法被 spoof,因為 CF 自己 set)
    // 沒有 CF-Connecting-IP 時 fallback 到 req.ip(Express 已啟 trust proxy,本來就會解 X-Forwarded-For)
    const cfIp = req.headers['cf-connecting-ip']?.toString();
    const clientIp = (cfIp && cfIp.trim()) || req.ip || '';
    const ua = req.headers['user-agent']?.toString() ?? '';
    const expectedUA = this.config.get<string>('MYCARD_USER_AGENT', 'MyCardGlobalBilling/1.0');

    // 進站第一時間就印 — 任何打到 /api/mycard/* 的請求(含等下會被擋的)都看得到。
    // 方便直接從 stdout 確認「MyCard 到底有沒有打進來、打哪支、來源 IP/UA 是什麼」。
    this.logger.log(
      `[MYCARD-IN] ${req.method} ${req.originalUrl ?? req.url} ip=${clientIp} ua="${ua}"`,
    );
    // 把 MyCard 實際送來的內容也印出來,方便直接在 log 比對交易資料(query + body)。
    // body 已由 express body-parser 解析(form-urlencoded / json 都會 URL-decode),
    // 所以像 ReturnMsg 會直接看到還原後的中文。
    this.logger.log(
      `[MYCARD-IN] ↓ content-type="${req.headers['content-type'] ?? ''}" query=${this.safeJson(req.query)} body=${this.safeJson(req.body)}`,
    );

    if (mockMode) {
      this.logger.warn(`[MOCK] callback from ${clientIp} (UA=${ua}) — skipping source check`);
      return true;
    }

    // 廠商儲值紀錄查詢服務(v1.0.4 規格書)未要求任何來源驗證(無 IP 白名單 / UA / hash);
    // 差異比對讀取也共用同一個 topup-records URL。依案主決策:這支先不做白名單限制,
    // 讓智冠(含客服用瀏覽器人工查)一定看得到交易紀錄。故 GET(CSV)/ POST(JSON)
    // 一律放行,只保留 [MYCARD-IN] log 供稽核。
    // 其餘 callback(trade-result 派發 / supplement 補儲 / Model B)維持 UA + IP 驗證不變。
    if (this.isTopupRecordsPath(req)) {
      this.logger.log(`[MYCARD-IN] topup-records from ${clientIp} (UA="${ua}") → 放行(不套白名單/UA)`);
      return true;
    }

    // 玩家瀏覽器 form-submit 回 /trade-result:不 block,讓 controller 用
    // wait-and-join 處理(等 server-to-server callback 把訂單推進到終態再 302,
    // 體驗更好)
    if (ua !== expectedUA && req.method === 'POST' && this.isTradeResultPath(req)) {
      this.logger.log(
        `Browser POST to trade-result from ${clientIp} (UA=${ua.slice(0, 40)}) → forward to controller`,
      );
      return true; // pass through;由 controller 內判斷 UA 分流
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

  private isTopupRecordsPath(req: Request): boolean {
    // 用 req.path(不含 query string),避免 GET ?StartDate=... 影響結尾比對
    const p = req.path ?? req.originalUrl ?? req.url ?? '';
    return p.endsWith('/topup-records') || p.endsWith('/topup-records/');
  }

  /** 安全序列化(印 log 用):空值/物件/過長都處理掉,不讓 log 噴錯 */
  private safeJson(v: unknown): string {
    if (v === undefined || v === null) return '(none)';
    try {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      if (!s || s === '{}') return '(empty)';
      return s.length > 2000 ? `${s.slice(0, 2000)}…(truncated)` : s;
    } catch {
      return '(unserializable)';
    }
  }
}
