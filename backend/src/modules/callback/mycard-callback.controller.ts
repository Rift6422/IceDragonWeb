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
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
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
  constructor(private readonly callback: MyCardCallbackService) {}

  /** §3.2.4 交易結果回傳 */
  @Post('trade-result')
  @HttpCode(HttpStatus.OK)
  async tradeResult(@Body() body: TradeResultBody, @Req() req: Request): Promise<{ ok: boolean }> {
    const result = await this.callback.handleTradeResult(body as Required<TradeResultBody>, {
      sourceIp: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
      rawBody: JSON.stringify(body),
    });
    return { ok: result.ok };
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
