import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@dzenwriter/shared';
import type { Request } from 'express';
import type { SessionUser } from './auth.service';

export const IS_PUBLIC_KEY = 'auth:public';
export const ROLES_KEY = 'auth:roles';

// Маршрут открыт без входа: health, начало и конец входа.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// Маршрут доступен только перечисленным ролям. Без @Roles() достаточно входа.
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export type AuthenticatedRequest = Request & { user?: SessionUser };

export const AuthUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) {
    throw new Error('Пользователь не определён: маршрут должен быть защищён AuthGuard');
  }
  return request.user;
});
