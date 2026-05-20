import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MyCardHashService } from './mycard-hash.service';

/**
 * MyCardHashService 的 NestJS 可注入工廠
 *
 * 為何不用 useFactory + JwtModule 那套?
 *  - 因為 hash service 是 stateless,直接從 config 拿 key 建構即可
 *  - 也方便測試時 mock(只要 mock ConfigService.get('MYCARD_HASH_KEY'))
 *
 * Mock mode 時自動用 placeholder key,避免 startup crash
 */
@Injectable()
export class MyCardHashFactory {
  private readonly logger = new Logger(MyCardHashFactory.name);
  private readonly instance: MyCardHashService;

  constructor(config: ConfigService) {
    const mockMode = config.get<string>('MYCARD_MOCK_MODE') === 'true';
    const key = config.get<string>('MYCARD_HASH_KEY');

    if (mockMode && (!key || !/^[0-9a-zA-Z]+$/.test(key))) {
      this.logger.warn('Hash service in mock mode — using placeholder key');
      this.instance = new MyCardHashService('mockkey1234');
    } else {
      if (!key) throw new Error('MYCARD_HASH_KEY required');
      this.instance = new MyCardHashService(key);
    }
  }

  get(): MyCardHashService {
    return this.instance;
  }
}
