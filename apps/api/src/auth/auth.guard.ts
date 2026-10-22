import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@dzenwriter/shared';
import type { Env } from '../config/env';
import { ENV } from '../config/tokens';
import { type AuthenticatedRequest, IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';
import { AuthService } from './auth.service';
import { readCookie, SESSION_COOKIE } from './cookies';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Глобальный охранник. По умолчанию нужен вход; @Public() открывает маршрут, @Roles() ограничивает роль.
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly webOrigin: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(ENV) env: Env,
  ) {
    this.webOrigin = new URL(env.WEB_ORIGIN).origin;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Дополнительно к SameSite=Lax: изменения принимаем только от нашего origin или без Origin.
    const origin = request.headers.origin;
    if (UNSAFE_METHODS.has(request.method) && origin !== undefined && origin !== this.webOrigin) {
      throw new ForbiddenException('Запрос с чужого источника отклонён');
    }

    const handlers = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, handlers)) {
      return true;
    }

    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const user = token ? await this.auth.findSession(token, new Date()) : undefined;
    if (!user) {
      throw new UnauthorizedException('Требуется вход');
    }

    const roles =
      this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, handlers) ?? [];
    if (roles.length > 0 && !roles.includes(user.role)) {
      throw new ForbiddenException('Недостаточно прав для этого действия');
    }

    request.user = user;
    return true;
  }
}
