import {
  USER_ROLE_LABELS,
  type UpdateUserInput,
  type UserItem,
  type UserRole,
} from '@dzenwriter/shared';
import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { fetchUsers, updateUser } from '../api/users';
import { formatDate } from '../lib/format';
import { useSession } from '../session/SessionContext';
import { BUTTON_SECONDARY, INPUT_CLASS } from '../shared/ui/classes';
import { Notice } from '../shared/ui/Notice';

const ROLES: readonly UserRole[] = ['author', 'reviewer', 'admin'];

// Управление доступом: роли и отключение. Себя менять нельзя, сервер тоже не даст.
export function UsersPage() {
  const { state } = useSession();
  const me = state.phase === 'authenticated' ? state.user : undefined;
  const [users, setUsers] = useState<readonly UserItem[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    fetchUsers().then(
      (response) => {
        if (active) {
          setUsers(response.items);
        }
      },
      (cause: unknown) => {
        if (active) {
          setError(errorMessage(cause));
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  async function change(user: UserItem, input: UpdateUserInput) {
    setBusyId(user.id);
    setError(undefined);
    try {
      const updated = await updateUser(user.id, input);
      setUsers((current) => current?.map((item) => (item.id === updated.id ? updated : item)));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-bold">Пользователи</h1>
        <p className="mt-2 text-on-surface-variant">
          Роли и доступ. Каждое изменение пишется в журнал. Отключение сразу завершает все сессии
          пользователя.
        </p>
      </header>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {users === undefined && error === undefined ? (
        <Notice>Загружаем пользователей…</Notice>
      ) : null}

      {users ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-separate border-spacing-y-2 text-left text-sm">
            <caption className="sr-only">Пользователи организации</caption>
            <thead className="text-on-surface-variant">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Логин
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Имя
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Роль
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Статус
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  С нами с
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isMe = me?.id === user.id;
                return (
                  <tr key={user.id} className="bg-surface-container">
                    <th scope="row" className="rounded-l-xl px-3 py-3 font-medium">
                      {user.login}
                      {isMe ? ' (это вы)' : ''}
                    </th>
                    <td className="px-3 py-3">{user.name ?? '—'}</td>
                    <td className="px-3 py-3">
                      <select
                        aria-label={`Роль: ${user.login}`}
                        className={INPUT_CLASS}
                        value={user.role}
                        disabled={isMe || busyId === user.id}
                        onChange={(event) => {
                          const role = ROLES.find((item) => item === event.target.value);
                          if (role) {
                            void change(user, { role });
                          }
                        }}
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {USER_ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-3">{user.disabled ? 'отключён' : 'активен'}</td>
                    <td className="px-3 py-3">{formatDate(user.createdAt)}</td>
                    <td className="rounded-r-xl px-3 py-3 text-right">
                      <button
                        type="button"
                        className={BUTTON_SECONDARY}
                        disabled={isMe || busyId === user.id}
                        onClick={() => void change(user, { disabled: !user.disabled })}
                      >
                        {user.disabled ? 'Включить' : 'Отключить'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
