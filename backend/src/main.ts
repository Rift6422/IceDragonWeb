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

  // Trust proxy:正式部署在 Cloudflare + Zeabur(AWS LB)後面,要從 X-Forwarded-For / CF-Connecting-IP 拿真實 IP
  // '1' = 信任最近一層 proxy(可改更嚴格的 CIDR list)
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

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
