import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { DirectTopupService } from './direct-topup.service';
import { BAuthResultDto } from './dto/auth-result.dto';

/**
 * 第 2 步:商家授權結果。
 *
 * MyCard 推 PreText + TradeSeq 進來,我方驗 hash → 產一次性 verifyToken →
 * 回應純文字 PreText echo(規格慣例,讓 MyCard 確認我方收到)。
 *
 * 後續第 3 步 MyCard 會帶 token 把玩家瀏覽器導到 /redeem-verify SPA 頁。
 */
@Controller('mycard/direct-topup')
export class BAuthResultController {
  private readonly logger = new Logger(BAuthResultController.name);

  constructor(private readonly direct: DirectTopupService) {}

  @Post('auth-result')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async handle(@Body() dto: BAuthResultDto): Promise<string> {
    try {
      const { verifyToken } = await this.direct.receiveAuthResult(dto);
      // 規格:廠商需 Response.Write 一段文字。沿用 PreText echo + token,
      // 讓 MyCard 拿到我方產的 verifyToken,後續第 3 步 URL 帶它
      return `${dto.PreText}|${verifyToken}`;
    } catch (err) {
      this.logger.warn(`auth-result error: ${(err as Error).message}`);
      // 失敗一律回 ERROR(規格慣例,不洩漏細節)
      return 'ERROR';
    }
  }
}
