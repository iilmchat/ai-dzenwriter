import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { UserRole } from '@dzenwriter/shared';
import type { SessionUser } from '../auth/auth.service';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
  type UserRow,
} from '../identity/identity.repository';

export interface UserPatch {
  readonly role?: UserRole;
  readonly disabled?: boolean;
}

@Injectable()
export class UsersService {
  constructor(@Inject(IDENTITY_REPOSITORY) private readonly repository: IdentityRepository) {}

  list(): Promise<UserRow[]> {
    return this.repository.listUsers();
  }

  // Каждое изменение пишется в аудит той же транзакцией. Отключение сразу отзывает все сессии.
  async update(actor: SessionUser, userId: string, patch: UserPatch, now: Date): Promise<UserRow> {
    if (
      userId === actor.id &&
      (patch.disabled === true || (patch.role !== undefined && patch.role !== 'admin'))
    ) {
      throw new ForbiddenException('Нельзя понизить или отключить себя');
    }

    return this.repository.withTransaction(async (tx) => {
      const current = await tx.findUserById(userId);
      if (!current) {
        throw new NotFoundException('Пользователь не найден');
      }

      const role = patch.role ?? current.role;
      const wasDisabled = current.disabledAt !== null;
      const disabled = patch.disabled ?? wasDisabled;
      if (role === current.role && disabled === wasDisabled) {
        return current;
      }

      const updated = await tx.updateUser(userId, {
        role,
        disabledAt: disabled ? (current.disabledAt ?? now) : null,
      });

      if (role !== current.role) {
        await tx.insertAudit({
          actorId: actor.id,
          action: 'user.role_change',
          entityType: 'user',
          entityId: userId,
          payload: { from: current.role, to: role },
        });
      }
      if (disabled !== wasDisabled) {
        const sessionsRevoked = disabled ? await tx.revokeUserSessions(userId, now) : 0;
        await tx.insertAudit({
          actorId: actor.id,
          action: disabled ? 'user.disable' : 'user.enable',
          entityType: 'user',
          entityId: userId,
          payload: { sessionsRevoked },
        });
      }
      return updated;
    });
  }
}
