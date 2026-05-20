import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { DispatchInput, DispatchResult, MailDispatcher } from './mail-dispatcher.interface';

/**
 * 預設 dispatcher(MVP 用):總是回成功,純粹 log
 *
 * 上線前(Stage 5 之前)必須把 token MAIL_DISPATCHER 換成 HttpMailDispatcher,
 * 並接遊戲端真實 API
 */
@Injectable()
export class MockMailDispatcher implements MailDispatcher {
  private readonly logger = new Logger(MockMailDispatcher.name);

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const start = Date.now();
    await new Promise((r) => setTimeout(r, 20));
    const mailId = `MOCK_MAIL_${randomUUID().slice(0, 8).toUpperCase()}`;
    this.logger.log(
      `[MOCK DISPATCH] order=${input.facTradeSeq} uid=${input.uid} → mail_id=${mailId}`,
    );
    return {
      ok: true,
      mailId,
      responseStatus: 200,
      responseBody: JSON.stringify({ mock: true, mail_id: mailId }),
      durationMs: Date.now() - start,
    };
  }
}
