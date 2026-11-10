import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { UserRole } from '@dzenwriter/shared';
import { timingSafeEqual } from 'node:crypto';
import type { AuthConfig, GithubAuthConfig } from '../config/auth-config';
import { AUTH_CONFIG } from '../config/tokens';
import {
  IDENTITY_REPOSITORY,
  type IdentityRepository,
  type UserRow,
} from '../identity/identity.repository';
import { SESSION_TTL_MS } from './cookies';
import {
  GITHUB_OAUTH,
  GithubRequestError,
  type GithubOAuth,
  type GithubProfile,
  type OrgMembershipState,
} from './github.client';
import { createOpaqueToken, hashSessionToken } from './session-token';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const OAUTH_SCOPES = 'read:user read:org';

export type LoginFailure = 'state' | 'github' | 'not_member' | 'disabled';

export type LoginResult =
  | { readonly ok: true; readonly sessionToken: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly reason: LoginFailure };

export interface SessionUser {
  readonly id: string;
  readonly login: string;
  readonly name: string | null;
  readonly role: UserRole;
  readonly sessionId: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(GITHUB_OAUTH) private readonly github: GithubOAuth,
    @Inject(IDENTITY_REPOSITORY) private readonly repository: IdentityRepository,
  ) {}

  get enabled(): boolean {
    return this.config.github !== undefined;
  }

  // state уходит в cookie браузера и сверяется в callback: так подменённый вход не пройдёт.
  beginLogin(): { state: string; url: string } {
    const github = this.requireGithub();
    const state = createOpaqueToken();
    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: github.clientId,
      redirect_uri: github.callbackUrl,
      scope: OAUTH_SCOPES,
      state,
      allow_signup: 'false',
    }).toString();
    return { state, url: url.toString() };
  }

  async completeLogin(input: {
    code: string;
    state: string;
    expectedState: string | undefined;
    now: Date;
  }): Promise<LoginResult> {
    const github = this.requireGithub();
    if (!input.expectedState || !equalInConstantTime(input.state, input.expectedState)) {
      return { ok: false, reason: 'state' };
    }

    let profile: GithubProfile;
    let membership: OrgMembershipState | undefined;
    try {
      const accessToken = await this.github.exchangeCode(input.code);
      profile = await this.github.fetchProfile(accessToken);
      membership = await this.github.fetchOrgMembership(accessToken, github.org);
    } catch (error) {
      if (error instanceof GithubRequestError) {
        return { ok: false, reason: 'github' };
      }
      throw error;
    }

    if (membership !== 'active') {
      await this.repository.insertAudit({
        actorId: null,
        action: 'auth.denied',
        entityType: 'auth',
        entityId: 'github',
        payload: { reason: 'not_member' },
      });
      return { ok: false, reason: 'not_member' };
    }

    const existing = await this.repository.findUserByGithubId(profile.id);
    if (existing?.disabledAt) {
      await this.repository.insertAudit({
        actorId: existing.id,
        action: 'auth.denied',
        entityType: 'user',
        entityId: existing.id,
        payload: { reason: 'disabled' },
      });
      return { ok: false, reason: 'disabled' };
    }

    // Первый администратор задаётся ADMIN_GITHUB_LOGINS, пока в системе нет ни одного администратора.
    const makeAdmin =
      github.adminLogins.includes(profile.login.toLowerCase()) &&
      (await this.repository.countActiveAdmins()) === 0;
    const sessionToken = createOpaqueToken();
    const expiresAt = new Date(input.now.getTime() + SESSION_TTL_MS);

    let loginConflict = false;
    try {
      await this.repository.withTransaction(async (tx) => {
        let user: UserRow;
        try {
          user = await tx.upsertUser({
            githubId: profile.id,
            login: profile.login,
            name: profile.name,
            makeAdmin,
          });
        } catch (error) {
          loginConflict = isUniqueViolation(error);
          throw error;
        }
        await tx.insertSession({
          userId: user.id,
          tokenHash: hashSessionToken(sessionToken),
          expiresAt,
        });
        await tx.insertAudit({
          actorId: user.id,
          action: 'auth.login',
          entityType: 'user',
          entityId: user.id,
          payload: { created: existing === undefined, bootstrapAdmin: makeAdmin },
        });
      });
    } catch (error) {
      if (!loginConflict || !isUniqueViolation(error)) {
        throw error;
      }
      await this.reportLoginConflict(profile, existing);
    }

    return { ok: true, sessionToken, expiresAt };
  }

  async findSession(token: string, now: Date): Promise<SessionUser | undefined> {
    const row = await this.repository.findActiveSession(hashSessionToken(token), now);
    if (!row) {
      return undefined;
    }
    return {
      id: row.user.id,
      login: row.user.login,
      name: row.user.name,
      role: row.user.role,
      sessionId: row.sessionId,
    };
  }

  async logout(token: string, now: Date): Promise<void> {
    const row = await this.repository.findActiveSession(hashSessionToken(token), now);
    if (!row) {
      return;
    }
    await this.repository.withTransaction(async (tx) => {
      await tx.revokeSession(row.sessionId, now);
      await tx.insertAudit({
        actorId: row.user.id,
        action: 'auth.logout',
        entityType: 'session',
        entityId: row.sessionId,
        payload: {},
      });
    });
  }

  // PostgreSQL прерывает транзакцию после нарушения уникальности, поэтому аудит
  // пишем отдельным соединением — уже после отката неудавшегося upsert.
  private async reportLoginConflict(
    profile: GithubProfile,
    existing: UserRow | undefined,
  ): Promise<never> {
    const conflicting = await this.repository.findUserByLogin(profile.login);
    await this.repository.insertAudit({
      actorId: existing?.id ?? null,
      action: 'auth.login_conflict',
      entityType: 'user',
      entityId: existing?.id ?? 'unknown',
      payload: {
        githubId: profile.id,
        conflictingUserId: conflicting?.id ?? null,
        existingUser: existing !== undefined,
      },
    });
    this.logger.warn(
      {
        event: 'auth.login_conflict',
        githubId: profile.id,
        existingUserId: existing?.id ?? null,
        newLogin: profile.login,
        conflictingUserId: conflicting?.id ?? null,
        conflictingLogin: conflicting?.login ?? null,
      },
      'Конфликт логина GitHub',
    );
    throw new ConflictException({
      type: 'about:blank',
      title: 'Конфликт логина GitHub',
      status: 409,
      detail: `Пользователь с логином ${profile.login} уже существует. Обратитесь к администратору.`,
    });
  }

  private requireGithub(): GithubAuthConfig {
    if (!this.config.github) {
      throw new ServiceUnavailableException('Вход через GitHub не настроен');
    }
    return this.config.github;
  }
}

function isUniqueViolation(error: unknown): error is { code: '23505' } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

function equalInConstantTime(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
