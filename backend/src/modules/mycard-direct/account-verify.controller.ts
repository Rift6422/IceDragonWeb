import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DirectTopupService } from './direct-topup.service';
import { BAccountVerifyDto } from './dto/account-verify.dto';

/**
 * 第 3-7 步:帳密驗證。
 *
 * 兩個 handler:
 *   GET   /api/mycard/direct-topup/account-verify?token=...
 *         → 302 redirect 玩家瀏覽器到 SPA 路由 /redeem-verify?token=...
 *
 *   POST  /api/mycard/direct-topup/account-verify
 *         { verifyToken, uid } → 純文字 VRESULT 數字
 *         0=成功 / -1=帳號不存在或停用 / -2=token 無效
 *
 * SPA 路由由 PlayerLayout 渲染,前端送 POST 拿 VRESULT 後顯示結果。
 */
@Controller('mycard/direct-topup')
export class BAccountVerifyController {
  private readonly logger = new Logger(BAccountVerifyController.name);

  constructor(
    private readonly direct: DirectTopupService,
    private readonly config: ConfigService,
  ) {}

  /**
   * MyCard 把玩家瀏覽器帶來這裡(GET + token query),我方 redirect 進 SPA。
   *
   * 規格上 MyCard 也可能直接打 GET 查驗證頁是否存在 — 用 HTTP 302 比 200+HTML 更穩。
   */
  @Get('account-verify')
  @Redirect()
  redirectToVerifyPage(
    @Query('token') token?: string,
  ): { url: string; statusCode: number } {
    const frontendBase = this.config.get<string>(
      'PLAYER_FRONTEND_URL',
      'http://localhost:3000',
    );
    const safeToken = token && /^[0-9a-fA-F]{1,128}$/.test(token) ? token : '';
    return {
      url: `${frontendBase}/redeem-verify?token=${safeToken}`,
      statusCode: 302,
    };
  }

  /**
   * 玩家在 SPA 表單填 UID 後 POST 過來,回 VRESULT 純文字。
   *
   * 規格要求 MyCard 看的是 VRESULT 數字,前端再渲染人類可讀訊息。
   */
  @Post('account-verify')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async submit(@Body() dto: BAccountVerifyDto): Promise<string> {
    try {
      const { vresult } = await this.direct.submitVerify(dto);
      return String(vresult);
    } catch (err) {
      this.logger.warn(`account-verify error: ${(err as Error).message}`);
      return '-1';
    }
  }
}
