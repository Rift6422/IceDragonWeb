import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AdminAuthedRequest } from '../guards/admin-jwt.guard';

/**
 * 從 request 拿出已驗證的 admin 資訊
 *
 * 用法:
 *   @Get('me')
 *   me(@CurrentAdmin() admin: { id: string; username: string; role: string }) { ... }
 */
export const CurrentAdmin = createParamDecorator((_, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AdminAuthedRequest>();
  return req.admin;
});
