import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DirectTopupStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MyCardDirectHashService } from './hash';
import type { BAuthResultDto } from './dto/auth-result.dto';
import type { BAccountVerifyDto } from './dto/account-verify.dto';
import type { BTopupResultDto } from './dto/topup-result.dto';

/**
 * MyCard 直接儲值主邏輯(13 步流程)。
 *
 * 設計準則:
 *   - 同一 Mycard_id 絕對不可重複加值:DB UNIQUE + 重複時回 SRESULT=-2 + SMESSAGE
 *   - 玩家身分驗證只看 UID 存在 + active(無密碼,MVP)
 *   - 派發復用 Model A 的 MailDispatcher(未來注入)
 *   - 所有回應走純文字(controller 端設 Content-Type)
 *   - SMESSAGE 一律英文(規格要求,避免編碼)
 *
 * 注入 hash service factory 而非 service 本身:避免啟動時 KEY 未設造成 boot crash;
 * 真的被呼到時才檢查 key 並 lazy 建 service。
 */
@Injectable()
export class DirectTopupService {
  private readonly logger = new Logger(DirectTopupService.name);

  /** 第 3 步驗證 token 有效期間(MyCard 通常會立刻引導用戶,給 30 分鐘充裕) */
  private static readonly VERIFY_TOKEN_TTL_MS = 30 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** lazy 建 hash service — 沒 key 就 throw(直接儲值流程被 disable)*/
  private getHashService(): MyCardDirectHashService {
    const k1 = this.config.get<string>('MYCARD_DIRECT_KEY1');
    const k2 = this.config.get<string>('MYCARD_DIRECT_KEY2');
    if (!k1 || !k2) {
      throw new ServiceUnavailableException(
        'MyCard direct topup is not configured (missing MYCARD_DIRECT_KEY1/2)',
      );
    }
    return new MyCardDirectHashService(k1, k2);
  }

  // ============================================================
  // 第 2 步:商家授權結果(MyCard → 我方)
  // ============================================================
  /**
   * MyCard 推 PreText + TradeSeq 進來,我方:
   *   1. 驗 SHA-1 hash
   *   2. 寫入 direct_topup_attempts(status=PENDING_VERIFY)
   *   3. 產一次性 verifyToken,返回(MyCard 不需要,但會放在第 3 步 redirect URL)
   *
   * 注意:此 step 還沒有玩家身分,user_id 為 null。
   *
   * @returns verifyToken — 用於第 3 步 GET 驗證頁的 query string
   */
  async receiveAuthResult(dto: BAuthResultDto): Promise<{ verifyToken: string }> {
    const hash = this.getHashService();

    // 1) 驗 hash
    const valid = hash.verifyBAuthResult(
      { tradeSeq: dto.TradeSeq, preText: dto.PreText, customerId: dto.CustomerId },
      dto.Hash,
    );
    if (!valid) {
      // 失敗只 log,不洩漏為什麼錯(規格慣例)
      this.logger.warn(`AUTH_RESULT hash invalid for TradeSeq=${dto.TradeSeq}`);
      throw new UnauthorizedException('Invalid hash');
    }

    // 2) 冪等檢查:同 TradeSeq 已存在就回原 token
    const existing = await this.prisma.directTopupAttempt.findUnique({
      where: { tradeSeq: dto.TradeSeq },
    });
    if (existing?.verifyToken) {
      this.logger.log(
        `AUTH_RESULT duplicate TradeSeq=${dto.TradeSeq} → reuse token`,
      );
      return { verifyToken: existing.verifyToken };
    }

    // 3) 產 token + 寫紀錄
    const verifyToken = this.generateVerifyToken();
    const expire = new Date(Date.now() + DirectTopupService.VERIFY_TOKEN_TTL_MS);

    await this.prisma.directTopupAttempt.upsert({
      where: { tradeSeq: dto.TradeSeq },
      update: {
        verifyToken,
        verifyTokenExpire: expire,
        authRequestRaw: dto as unknown as Prisma.InputJsonValue,
        status: DirectTopupStatus.PENDING_VERIFY,
      },
      create: {
        // mycardId 第 2 步沒有,塞 trade_seq 作 placeholder(UNIQUE 約束)
        // 等第 9 步真的儲值請求進來才更新成正確的 Mycard_id
        mycardId: `PENDING-${dto.TradeSeq}`,
        tradeSeq: dto.TradeSeq,
        submittedUid: dto.CustomerId?.toUpperCase() ?? null,
        verifyToken,
        verifyTokenExpire: expire,
        authRequestRaw: dto as unknown as Prisma.InputJsonValue,
        status: DirectTopupStatus.PENDING_VERIFY,
      },
    });

    return { verifyToken };
  }

  // ============================================================
  // 第 3-7 步:帳密驗證
  // ============================================================
  /**
   * GET 驗證頁 → 用 token 取得對應 attempt(讓前端渲染 trade info)
   */
  async getVerifyContext(verifyToken: string): Promise<{
    tradeSeq: string;
    customerHint: string | null;
    expired: boolean;
  } | null> {
    const attempt = await this.prisma.directTopupAttempt.findUnique({
      where: { verifyToken },
    });
    if (!attempt) return null;
    return {
      tradeSeq: attempt.tradeSeq ?? '',
      customerHint: attempt.submittedUid ?? null,
      expired:
        !!attempt.verifyTokenExpire && attempt.verifyTokenExpire.getTime() < Date.now(),
    };
  }

  /**
   * POST 提交 UID → 我方檢查 UID 存在 + active,回 VRESULT。
   *
   * VRESULT 規格:
   *   0    成功
   *   -1   一般失敗(UID 不存在 / 帳號停用)
   *   -2   token 無效 / 已過期 / 重複使用
   */
  async submitVerify(dto: BAccountVerifyDto): Promise<{ vresult: number; tradeSeq: string }> {
    const attempt = await this.prisma.directTopupAttempt.findUnique({
      where: { verifyToken: dto.verifyToken },
    });
    if (!attempt) {
      return { vresult: -2, tradeSeq: '' };
    }
    if (
      attempt.verifyTokenExpire &&
      attempt.verifyTokenExpire.getTime() < Date.now()
    ) {
      return { vresult: -2, tradeSeq: attempt.tradeSeq ?? '' };
    }
    if (
      attempt.status !== DirectTopupStatus.PENDING_VERIFY &&
      attempt.status !== DirectTopupStatus.VERIFY_FAILED
    ) {
      // 已經 verify_ok / processing / delivered 不允許重提
      return { vresult: -2, tradeSeq: attempt.tradeSeq ?? '' };
    }

    const uid = dto.uid.toUpperCase();
    const user = await this.prisma.user.findUnique({ where: { uid } });

    if (!user || !user.isActive) {
      await this.prisma.directTopupAttempt.update({
        where: { id: attempt.id },
        data: {
          submittedUid: uid,
          status: DirectTopupStatus.VERIFY_FAILED,
          vresult: -1,
          verifiedAt: new Date(),
        },
      });
      return { vresult: -1, tradeSeq: attempt.tradeSeq ?? '' };
    }

    await this.prisma.directTopupAttempt.update({
      where: { id: attempt.id },
      data: {
        submittedUid: uid,
        userId: user.id,
        status: DirectTopupStatus.VERIFY_OK,
        vresult: 0,
        verifiedAt: new Date(),
      },
    });

    return { vresult: 0, tradeSeq: attempt.tradeSeq ?? '' };
  }

  // ============================================================
  // 第 9-11 步:儲值結果回覆
  // ============================================================
  /**
   * MyCard 推實際儲值請求進來:
   *   1. 驗 SHA-1
   *   2. 用 mycard_id 上 UNIQUE 鎖 — 重複進來必回 SRESULT=-2
   *   3. 用 trade_seq 找到 verified attempt
   *   4. 加值(透過 MailDispatcher,目前先標記 DELIVERED;實際派發在 D7 接上)
   *   5. 回 SRESULT=0
   *
   * SMESSAGE 規格:英文,SRESULT=-2 時帶卡號。
   */
  async processTopupResult(dto: BTopupResultDto): Promise<{
    sresult: number;
    smessage: string;
  }> {
    const hash = this.getHashService();

    // 1) Hash
    const valid = hash.verifyBTopupResult(
      {
        tradeSeq: dto.TradeSeq,
        mycardId: dto.Mycard_id,
        mycardProjectNo: dto.MyCardProjectNo,
        mycardType: dto.Mycardtype,
        // 我方算 hash 時需要 sresult,但 MyCard 推來的是「我方應計算」— 此時 sresult 未知
        // 規格其實是用 hash 保護 input,不是 output。先按 input-only hash 算。
        sresult: 0,
        amount: dto.Amount,
        currency: dto.Currency,
      },
      dto.Hash,
    );
    if (!valid) {
      this.logger.warn(
        `TOPUP_RESULT hash invalid for Mycard_id=${dto.Mycard_id} TradeSeq=${dto.TradeSeq}`,
      );
      throw new UnauthorizedException('Invalid hash');
    }

    // 2) 重複儲值偵測(用 Mycard_id 鎖)
    const dup = await this.prisma.directTopupAttempt.findUnique({
      where: { mycardId: dto.Mycard_id },
    });
    if (dup && dup.status === DirectTopupStatus.DELIVERED) {
      this.logger.log(
        `TOPUP_RESULT duplicate Mycard_id=${dto.Mycard_id} (already delivered)`,
      );
      return { sresult: -2, smessage: `Duplicate Mycard_id ${dto.Mycard_id}` };
    }

    // 3) 找對應的 verify_ok attempt(by tradeSeq)
    const attempt = await this.prisma.directTopupAttempt.findUnique({
      where: { tradeSeq: dto.TradeSeq },
      include: { user: true },
    });
    if (!attempt) {
      return { sresult: -1, smessage: `No verified attempt for TradeSeq ${dto.TradeSeq}` };
    }
    if (attempt.status !== DirectTopupStatus.VERIFY_OK) {
      return {
        sresult: -1,
        smessage: `Attempt not in VERIFY_OK state (current=${attempt.status})`,
      };
    }
    if (!attempt.userId) {
      return { sresult: -1, smessage: 'No verified user attached' };
    }

    // 4) 寫入 / 鎖卡 + 派發(目前先標記 — D7 真接 MailDispatcher)
    try {
      await this.prisma.directTopupAttempt.update({
        where: { id: attempt.id },
        data: {
          mycardId: dto.Mycard_id, // 由 PENDING-xxx 升級成真實 card id
          mycardProjectNo: dto.MyCardProjectNo,
          mycardType: dto.Mycardtype,
          amount: dto.Amount ? new Prisma.Decimal(dto.Amount) : undefined,
          currency: dto.Currency,
          cardPoint: dto.CardPoint,
          status: DirectTopupStatus.TOPUP_PROCESSING,
          topupRequestRaw: dto as unknown as Prisma.InputJsonValue,
          topupAt: new Date(),
        },
      });
    } catch (err) {
      // P2002 unique violation on mycardId → race condition with duplicate
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return {
          sresult: -2,
          smessage: `Duplicate Mycard_id ${dto.Mycard_id}`,
        };
      }
      throw err;
    }

    // TODO(D7):接 MailDispatcher 真實派發,目前先標 DELIVERED
    await this.prisma.directTopupAttempt.update({
      where: { id: attempt.id },
      data: {
        status: DirectTopupStatus.DELIVERED,
        sresult: 0,
        deliveredAt: new Date(),
      },
    });

    return { sresult: 0, smessage: 'OK' };
  }

  // ============================================================
  // 工具
  // ============================================================

  /** 32 字 hex token,前端 URL 帶 ?token=...;同時 DB UNIQUE 防碰撞 */
  private generateVerifyToken(): string {
    return randomBytes(32).toString('hex');
  }
}
