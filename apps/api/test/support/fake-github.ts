import {
  type GithubOAuth,
  GithubRequestError,
  type GithubProfile,
  type OrgMembershipState,
} from '../../src/auth/github.client';

// Подмена GitHub: сеть в тестах не используется. Поля меняются по сценарию теста.
export class FakeGithubOAuth implements GithubOAuth {
  profile: GithubProfile = { id: 1001, login: 'anna', name: 'Анна Иванова' };
  membership: OrgMembershipState | undefined = 'active';
  exchangeError = false;
  readonly exchangedCodes: string[] = [];

  async exchangeCode(code: string): Promise<string> {
    this.exchangedCodes.push(code);
    if (this.exchangeError) {
      throw new GithubRequestError('GitHub недоступен');
    }
    return 'gho_test_token';
  }

  async fetchProfile(): Promise<GithubProfile> {
    return this.profile;
  }

  async fetchOrgMembership(): Promise<OrgMembershipState | undefined> {
    return this.membership;
  }
}
