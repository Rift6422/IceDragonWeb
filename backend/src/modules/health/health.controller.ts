import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface HealthResponse {
  status: 'ok';
  uptime_seconds: number;
  env: string;
  timestamp: string;
}

interface DbHealthResponse {
  status: 'ok' | 'error';
  latency_ms?: number;
  error?: string;
}

/**
 * Health endpoints
 * - GET /healthz       → 服務本身存活
 * - GET /healthz/db    → 含 DB 連線檢查
 *
 * 注意:路徑無 /api/ prefix(在 main.ts 已 exclude),方便 LB / k8s liveness probe
 */
@Controller('healthz')
export class HealthController {
  private readonly bootedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  liveness(): HealthResponse {
    return {
      status: 'ok',
      uptime_seconds: Math.floor((Date.now() - this.bootedAt) / 1000),
      env: this.config.get<string>('NODE_ENV', 'unknown'),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('db')
  async dbHealth(): Promise<DbHealthResponse> {
    const result = await this.prisma.ping();
    if (result.ok) {
      return { status: 'ok', latency_ms: result.latencyMs };
    }
    return { status: 'error', error: result.error };
  }
}
