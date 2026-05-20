import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { PrismaService } from '../../modules/prisma/prisma.service';

export interface AdminJwtPayload {
  /** admin_users.id */
  sub: string;
  username: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AdminAuthedRequest extends Request {
  admin: {
    id: string;
    username: string;
    role: string;
  };
}

@Injectable()
export class AdminJwtGuard implements CanActivate {
  private readonly logger = new Logger(AdminJwtGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminAuthedRequest>();
    const token = this.extractToken(req);

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: AdminJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<AdminJwtPayload>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // 確認 admin 仍 active(被停用後立刻失效,JWT 無 server-side revoke)
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, role: true, isActive: true, lockedUntil: true },
    });

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Account disabled');
    }
    if (admin.lockedUntil && admin.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account locked');
    }

    req.admin = { id: admin.id, username: admin.username, role: admin.role };
    return true;
  }

  private extractToken(req: Request): string | null {
    const auth = req.headers['authorization'];
    if (!auth || typeof auth !== 'string') return null;
    const [scheme, value] = auth.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value.trim();
  }
}
