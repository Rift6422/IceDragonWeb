import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { MyCardSourceGuard } from './guards/mycard-source.guard';
import { MyCardCallbackService } from './mycard-callback.service';

interface TradeResultBody {
  ReturnCode?: string;
  ReturnMsg?: string;
  PayResult?: string;
  FacTradeSeq?: string;
  PaymentType?: string;
  Amount?: string;
  Currency?: string;
  MyCardTradeNo?: string;
  MyCardType?: string;
  PromoCode?: string;
  SerialId?: string;
  Hash?: string;
}

interface SupplementBody {
  DATA?: string;
}

interface DiffReportBody {
  StartDateTime?: string;
  EndDateTime?: string;
  MyCardTradeNo?: string;
}

interface TopupRecordsQuery {
  StartDate?: string;
  EndDate?: string;
  MyCardID?: string;
}

/**
 * MyCard inbound callback endpoints
 *
 * 注意:全部走 `/api/mycard/*`,不走 `/api/admin/*` 的 JWT 守衛
 *       但會經過 MyCardSourceGuard(IP + UA + mock mode 通融)
 */
@Controller('mycard')
@UseGuards(MyCardSourceGuard)
export class MyCardCallbackController {
  constructor(
    private readonly callback: MyCardCallbackService,
    private readonly config: ConfigService,
  ) {}

  /**
   * §3.2.4 交易結果回傳
   *
   * 同一 POST endpoint 接兩種來源,用 User-Agent 分流:
   *   - `MyCardGlobalBilling/1.0`(server-to-server)→ 處理 callback 並回 200 JSON
   *   - 其他(玩家瀏覽器 form-submit)→ wait-and-join 等 server callback
   *     把狀態推到終態,再 302 redirect 到 /?paid=XXX&result=...
   *
   * 這支採 @Res() 寫 response,因為兩種來源回的格式不同(JSON vs redirect)。
   */
  @Post('trade-result')
  async tradeResult(
    @Body() body: TradeResultBody,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ua = req.headers['user-agent']?.toString() ?? '';
    const expectedUA = this.config.get<string>('MYCARD_USER_AGENT', 'MyCardGlobalBilling/1.0');

    if (ua === expectedUA) {
      // server-to-server callback:走原本邏輯
      const result = await this.callback.handleTradeResult(body as Required<TradeResultBody>, {
        sourceIp: req.ip,
        userAgent: ua,
        rawBody: JSON.stringify(body),
      });
      res.status(HttpStatus.OK).json({ ok: result.ok });
      return;
    }

    // 玩家瀏覽器 form-submit:hold 連線最多 6 秒,等 server callback 把訂單推到終態
    // (CF 邊界 100 秒,Express keep-alive 預設 5 分鐘,6 秒足夠且玩家不會覺得久)
    const facTradeSeq = body.FacTradeSeq ?? '';
    const target = await this.callback.waitForOrderResolution(facTradeSeq, 6000);
    res.redirect(302, target);
  }

  /** §3.6 補儲通知 */
  @Post('supplement')
  @HttpCode(HttpStatus.OK)
  async supplement(@Body() body: SupplementBody, @Req() req: Request): Promise<{ ok: boolean; processed: number }> {
    return this.callback.handleSupplement(body.DATA ?? '', {
      sourceIp: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
      rawBody: JSON.stringify(body),
    });
  }

  /** §3.7 交易差異比對(POST,回 JSON)— 保留 internal URL */
  @Post('diff-report')
  @HttpCode(HttpStatus.OK)
  diffReport(@Body() body: DiffReportBody, @Req() req: Request): Promise<{ trades: unknown[] }> {
    return this.callback.handleDiffReport(body, {
      sourceIp: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
      rawBody: JSON.stringify(body),
      httpMethod: 'POST',
      url: '/api/mycard/diff-report',
    });
  }

  /**
   * 廠商儲值紀錄查詢 (GET,回 CSV+<BR>)
   * MyCard 規格:於頁面 Response.Write,每筆 11 欄,逗號分隔,<BR> 結尾
   *
   * 註:同一 URL 也接 POST 處理「差異比對」— 因 MyCard 介接資料表
   * 把兩個 URL 合在同一個欄位(見 docs/12_MyCard_ModelB_直接儲值.md)。
   */
  @Get('topup-records')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  topupRecords(@Query() query: TopupRecordsQuery, @Req() req: Request): Promise<string> {
    return this.callback.handleTopupRecords(query, {
      sourceIp: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
      rawBody: JSON.stringify(query),
      httpMethod: 'GET',
      url: '/api/mycard/topup-records',
    });
  }

  /**
   * 同 URL POST:差異比對(JSON 查單)
   * 路徑跟 GET 完全一樣,但 method 不同 → NestJS 自動分流。
   * 行為與 `/diff-report` 等價,給 MyCard 註冊用。
   */
  @Post('topup-records')
  @HttpCode(HttpStatus.OK)
  diffReportAtTopupRecords(@Body() body: DiffReportBody, @Req() req: Request): Promise<{ trades: unknown[] }> {
    return this.callback.handleDiffReport(body, {
      sourceIp: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
      rawBody: JSON.stringify(body),
      httpMethod: 'POST',
      url: '/api/mycard/topup-records',
    });
  }
}
