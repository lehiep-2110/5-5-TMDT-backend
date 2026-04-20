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
import { UserRole } from '../../common/enums/user-role.enum';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-request.interface';

interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

/**
 * Auth guard that mirrors JwtStrategy but also accepts a `?token=` query param
 * so the browser EventSource API (which can't set Authorization headers) can
 * authenticate against SSE endpoints.
 */
@Injectable()
export class SseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SseAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Thiếu access token.');
    }
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');
    if (!secret) {
      throw new UnauthorizedException('Máy chủ chưa cấu hình JWT.');
    }
    try {
      const payload = this.jwtService.verify<JwtPayload>(token, { secret });
      if (!payload?.sub || !payload.email || !payload.role) {
        throw new UnauthorizedException('Token không hợp lệ.');
      }
      const user: AuthenticatedUser = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
      };
      // Attach to request so controllers using @CurrentUser() still work.
      (req as unknown as { user: AuthenticatedUser }).user = user;
      return true;
    } catch (err) {
      this.logger.debug(`SSE auth failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Token không hợp lệ hoặc đã hết hạn.');
    }
  }

  private extractToken(req: Request): string | null {
    const header = req.headers['authorization'] ?? req.headers['Authorization'];
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
      return header.slice(7).trim();
    }
    const q = (req.query as Record<string, unknown>)?.token;
    if (typeof q === 'string' && q.length > 0) return q;
    return null;
  }
}
