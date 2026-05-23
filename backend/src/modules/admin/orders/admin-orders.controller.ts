import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Request } from 'express';
import { AdminOrdersService } from './admin-orders.service';
import { ListOrdersDto } from './list-orders.dto';
import { AdminJwtGuard } from '../../../common/guards/admin-jwt.guard';
import { AdminIpWhitelistGuard } from '../../../common/guards/admin-ip-whitelist.guard';
import { MyCardCallbackService } from '../../callback/mycard-callback.service';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { AdminAuditService } from '../audit/admin-audit.service';

class RetryCallbackDto {
  @IsString()
  @MaxLength(50)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'facTradeSeq invalid' })
  facTradeSeq!: string;

  /**
   * force=true:即使訂單已 DELIVERED 也再次呼叫派發(grantrmproduct)。
   * 危險動作,可能讓玩家拿到第二份禮包;前端必須二次確認後才可送這個 flag。
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@Controller('admin/orders')
@UseGuards(AdminIpWhitelistGuard, AdminJwtGuard)
export class AdminOrdersController {
  constructor(
    private readonly orders: AdminOrdersService,
    private readonly callback: MyCardCallbackService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list(@Query() query: ListOrdersDto): Promise<unknown> {
    return this.orders.list(query);
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<unknown> {
    return this.orders.detail(id);
  }

  /**
   * 手動重跑 MyCard callback(等同 supplement)。
   *
   * 卡單救援用:訂單因 IP 白名單漏接 callback、網路抖動、其他暫時問題卡在
   * PENDING / AUTHED 時,後台或 QA 可呼叫此端點觸發 TradeQuery + PaymentConfirm
   * + 派發。內部使用 callback service 的 reprocessOne 邏輯,行為與 MyCard 主動
   * 推 supplement 完全一致(包含冪等性檢查)。
   */
  @Post('retry-callback')
  @HttpCode(HttpStatus.OK)
  async retryCallback(
    @Body() dto: RetryCallbackDto,
    @CurrentAdmin() admin: { id: string },
    @Req() req: Request,
  ): Promise<{ ok: boolean; status: string | null; message: string }> {
    const result = await this.callback.forceReprocess(dto.facTradeSeq, { force: dto.force });
    await this.audit.log({
      adminId: admin.id,
      action: dto.force ? 'force_redispatch' : 'retry_callback',
      targetType: 'order',
      targetId: dto.facTradeSeq,
      payload: { result, force: !!dto.force },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']?.toString(),
    });
    return result;
  }
}
