import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { SessionUser } from '../src/auth/auth.service';
import { hashSessionToken } from '../src/auth/session-token';
import { UsersService } from '../src/users/users.service';
import { InMemoryIdentityRepository } from './support/in-memory-identity.repository';

const NOW = new Date('2026-10-22T10:00:00Z');

function setup() {
  const repository = new InMemoryIdentityRepository();
  const admin = repository.addUser({ githubId: 1, login: 'admin', role: 'admin' });
  const actor: SessionUser = {
    id: admin.id,
    login: admin.login,
    name: null,
    role: 'admin',
    sessionId: 'session-admin',
  };
  return { repository, actor, service: new UsersService(repository) };
}

describe('UsersService.update', () => {
  it('смена роли пишется в аудит с прежним и новым значением', async () => {
    const { repository, actor, service } = setup();
    const author = repository.addUser({ githubId: 2, login: 'boris' });

    const updated = await service.update(actor, author.id, { role: 'reviewer' }, NOW);

    expect(updated.role).toBe('reviewer');
    expect(repository.audit.at(-1)).toEqual({
      actorId: actor.id,
      action: 'user.role_change',
      entityType: 'user',
      entityId: author.id,
      payload: { from: 'author', to: 'reviewer' },
    });
  });

  it('отключение отзывает все активные сессии и пишет их число в аудит', async () => {
    const { repository, actor, service } = setup();
    const author = repository.addUser({ githubId: 2, login: 'boris' });
    await repository.insertSession({
      userId: author.id,
      tokenHash: hashSessionToken('token-1'),
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    const updated = await service.update(actor, author.id, { disabled: true }, NOW);

    expect(updated.disabledAt).toEqual(NOW);
    expect(await repository.findActiveSession(hashSessionToken('token-1'), NOW)).toBeUndefined();
    expect(repository.audit.at(-1)).toMatchObject({
      action: 'user.disable',
      payload: { sessionsRevoked: 1 },
    });
  });

  it('включение снимает отключение и пишет запись в аудит', async () => {
    const { repository, actor, service } = setup();
    const author = repository.addUser({ githubId: 2, login: 'boris', disabledAt: NOW });

    const updated = await service.update(actor, author.id, { disabled: false }, NOW);

    expect(updated.disabledAt).toBeNull();
    expect(repository.audit.at(-1)).toMatchObject({ action: 'user.enable' });
  });

  it('администратор не может понизить или отключить себя', async () => {
    const { actor, service } = setup();

    await expect(service.update(actor, actor.id, { role: 'author' }, NOW)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.update(actor, actor.id, { disabled: true }, NOW)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('несуществующий пользователь даёт 404', async () => {
    const { actor, service } = setup();

    await expect(
      service.update(actor, '00000000-0000-4000-8000-000000000000', { role: 'reviewer' }, NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('изменение без различий не пишет аудит', async () => {
    const { repository, actor, service } = setup();
    const author = repository.addUser({ githubId: 2, login: 'boris' });
    const before = repository.audit.length;

    await service.update(actor, author.id, { role: 'author', disabled: false }, NOW);

    expect(repository.audit.length).toBe(before);
  });
});
