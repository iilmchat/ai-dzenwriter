import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { CurrentUser } from '@dzenwriter/shared';
import type { Request, Response } from 'express';
import type { AuthConfig } from '../config/auth-config';
import { AUTH_CONFIG } from '../config/tokens';
import { AuthUser, Public } from './auth.decorators';
import { AuthService, type SessionUser } from './auth.service';
import {
  cookieAttributes,
  OAUTH_CALLBACK_PATH,
  OAUTH_STATE_COOKIE,
  oauthStateCookieOptions,
  readCookie,
  SESSION_COOKIE,
  sessionCookieOptions,
} from './cookies';

@Controller()
export class AuthController {
  constructor(
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Get('auth/github/start')
  start(@Res() res: Response): void {
    if (!this.auth.enabled) {
      this.redirectToWeb(res, 'unavailable');
      return;
    }
    const { state, url } = this.auth.beginLogin();
    res.cookie(OAUTH_STATE_COOKIE, state, oauthStateCookieOptions(this.config.secureCookies));
    res.redirect(302, url);
  }

  // Одноразовый code из GitHub не попадает в логи: логгер записывает только путь без query.
  @Public()
  @Get('auth/github/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const expectedState = readCookie(req.headers.cookie, OAUTH_STATE_COOKIE);
    res.clearCookie(
      OAUTH_STATE_COOKIE,
      cookieAttributes(this.config.secureCookies, OAUTH_CALLBACK_PATH),
    );

    if (error) {
      this.redirectToWeb(res, 'denied');
      return;
    }
    if (!this.auth.enabled) {
      this.redirectToWeb(res, 'unavailable');
      return;
    }

    const result = await this.auth.completeLogin({
      code: code ?? '',
      state: state ?? '',
      expectedState,
      now: new Date(),
    });
    if (!result.ok) {
      this.redirectToWeb(res, result.reason);
      return;
    }

    res.cookie(
      SESSION_COOKIE,
      result.sessionToken,
      sessionCookieOptions(this.config.secureCookies),
    );
    this.redirectToWeb(res);
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) {
      await this.auth.logout(token, new Date());
    }
    res.clearCookie(SESSION_COOKIE, cookieAttributes(this.config.secureCookies, '/'));
  }

  @Get('me')
  me(@AuthUser() user: SessionUser): CurrentUser {
    return { id: user.id, login: user.login, name: user.name, role: user.role };
  }

  private redirectToWeb(res: Response, error?: string): void {
    const url = new URL('/', this.config.webOrigin);
    if (error) {
      url.searchParams.set('error', error);
    }
    res.redirect(302, url.toString());
  }
}
