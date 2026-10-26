// Общие хелперы E2E: подготовка из global setup и контекст с сессией по токену.
import { type Browser, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SESSION_COOKIE = 'dzw_session';

export interface E2ESetup {
  readonly authorToken: string;
  readonly reviewerToken: string;
  readonly factId: string;
}

export function loadSetup(): E2ESetup {
  const file = path.join(__dirname, '..', 'test-results', 'e2e-setup.json');
  return JSON.parse(readFileSync(file, 'utf8')) as E2ESetup;
}

export async function signedInContext(
  browser: Browser,
  baseURL: string,
  token: string,
): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL });
  await context.addCookies([{ name: SESSION_COOKIE, value: token, url: baseURL }]);
  return context;
}
