import type { GithubAuthConfig } from '../config/auth-config';

export const GITHUB_OAUTH = Symbol('GITHUB_OAUTH');

const GITHUB_WEB = 'https://github.com';
const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = 'DzenWriter';

export interface GithubProfile {
  readonly id: number;
  readonly login: string;
  readonly name: string | null;
}

export type OrgMembershipState = 'active' | 'pending';

// Токен доступа GitHub нужен только внутри одного входа и нигде не сохраняется.
export interface GithubOAuth {
  exchangeCode(code: string): Promise<string>;
  fetchProfile(accessToken: string): Promise<GithubProfile>;
  // undefined: пользователь не состоит в организации.
  fetchOrgMembership(accessToken: string, org: string): Promise<OrgMembershipState | undefined>;
}

export class GithubRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubRequestError';
  }
}

interface GithubRequest {
  readonly method?: 'GET' | 'POST';
  readonly headers?: Record<string, string>;
  readonly body?: URLSearchParams;
}

export class FetchGithubOAuth implements GithubOAuth {
  constructor(private readonly app: GithubAuthConfig | undefined) {}

  async exchangeCode(code: string): Promise<string> {
    const app = this.requireApp();
    const response = await this.send(`${GITHUB_WEB}/login/oauth/access_token`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code,
        redirect_uri: app.callbackUrl,
      }),
    });
    const body = await readJson<{ access_token?: string }>(response);
    if (!body.access_token) {
      throw new GithubRequestError('GitHub не вернул токен доступа');
    }
    return body.access_token;
  }

  async fetchProfile(accessToken: string): Promise<GithubProfile> {
    const response = await this.send(`${GITHUB_API}/user`, {
      headers: apiHeaders(accessToken),
    });
    if (!response.ok) {
      throw new GithubRequestError(`Профиль GitHub: ответ ${response.status}`);
    }
    const body = await readJson<{ id: number; login: string; name?: string | null }>(response);
    return { id: body.id, login: body.login, name: body.name ?? null };
  }

  async fetchOrgMembership(
    accessToken: string,
    org: string,
  ): Promise<OrgMembershipState | undefined> {
    const response = await this.send(
      `${GITHUB_API}/user/memberships/orgs/${encodeURIComponent(org)}`,
      { headers: apiHeaders(accessToken) },
    );
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      throw new GithubRequestError(`Членство в организации: ответ ${response.status}`);
    }
    const body = await readJson<{ state: OrgMembershipState }>(response);
    return body.state;
  }

  private requireApp(): GithubAuthConfig {
    if (!this.app) {
      throw new GithubRequestError('GitHub OAuth не настроен');
    }
    return this.app;
  }

  private async send(url: string, request: GithubRequest): Promise<Response> {
    try {
      return await fetch(url, {
        method: request.method ?? 'GET',
        headers: { 'User-Agent': USER_AGENT, ...request.headers },
        body: request.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GithubRequestError('GitHub недоступен');
    }
  }
}

function apiHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new GithubRequestError('GitHub вернул ответ не в JSON');
  }
}
