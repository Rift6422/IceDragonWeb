import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const logger = new Logger('Bootstrap');
  const config = app.get(ConfigService);

  // Trust proxy:正式部署在 Cloudflare + Zeabur(AWS LB)後面共 2 層 proxy
  // trust=1 只信最後一跳(Zeabur LB),req.ip 拿到的是 Cloudflare IP,不是真實 client IP
  // → 設 true 信全部 hop,讓 req.ip = X-Forwarded-For[0] = 真實 client IP
  // (CF 在 prod 會 strip 來源端任何 spoofed XFF,安全無虞;guard 內另外吃 CF-Connecting-IP 雙保險)
  app.getHttpAdapter().getInstance().set('trust proxy', true);

  // MyCard 補儲 / 差異比對 callback 用 x-www-form-urlencoded 送 DATA={JSON}
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));

  // 全域 ValidationPipe(DTO 自動驗證)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // 全域 API prefix
  app.setGlobalPrefix('api', { exclude: ['healthz', 'healthz/(.*)'] });

  // Graceful shutdown(Docker / Zeabur 部署需要)
  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);

  logger.log(`🚀 icedragon-pay backend listening on http://localhost:${port}`);
  logger.log(`   Environment: ${config.get('NODE_ENV')}`);
  logger.log(`   Health:      http://localhost:${port}/healthz`);
}

void bootstrap();
