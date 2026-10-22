import type { UserRole } from '@dzenwriter/shared';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useSession } from '../session/SessionContext';
import { Notice } from '../shared/ui/Notice';

// Защита маршрута: без входа — на экран входа, без нужной роли — сообщение о запрете.
export function RequireSession({
  roles,
  children,
}: {
  readonly roles?: readonly UserRole[];
  readonly children: ReactNode;
}) {
  const { state } = useSession();
  switch (state.phase) {
    case 'loading':
      return <Notice>Проверяем вход…</Notice>;
    case 'unavailable':
      return <Notice tone="error">Не удалось проверить вход. Обновите страницу.</Notice>;
    case 'anonymous':
      return <Navigate to="/login" replace />;
    case 'authenticated':
      if (roles && !roles.includes(state.user.role)) {
        return <Notice tone="error">Этот раздел недоступен для вашей роли.</Notice>;
      }
      return <>{children}</>;
  }
}
