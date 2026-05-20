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
import { BTopupResultDto } from './dto/topup-result.dto';

/**
 * 第 9-11 步:儲值結果回覆。
 *
 * MyCard 推來實際儲值請求,我方:
 *   1. 驗 SHA-1
 *   2. Mycard_id UNIQUE 防重複
 *   3. 加值 + 派發
 *   4. 回應純文字 `SRESULT=X SMESSAGE=Y`(同規格慣例,英文)
 *
 * 規格不變式:
 *   SRESULT  0  → 成功
 *   SRESULT -1  → 一般失敗(SMESSAGE 帶英文錯誤原因)
 *   SRESULT -2  → 該 Mycard_id 已儲值過(SMESSAGE 帶卡號)
 */
@Controller('mycard/direct-topup')
export class BTopupResultController {
  private readonly logger = new Logger(BTopupResultController.name);

  constructor(private readonly direct: DirectTopupService) {}

  @Post('topup-result')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async handle(@Body() dto: BTopupResultDto): Promise<string> {
    try {
      const { sresult, smessage } = await this.direct.processTopupResult(dto);
      return `SRESULT=${sresult} SMESSAGE=${smessage}`;
    } catch (err) {
      this.logger.warn(`topup-result error: ${(err as Error).message}`);
      return 'SRESULT=-1 SMESSAGE=Internal error';
    }
  }
}
