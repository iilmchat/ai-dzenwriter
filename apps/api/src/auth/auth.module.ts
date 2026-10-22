import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { AuthConfig } from '../config/auth-config';
import { AUTH_CONFIG } from '../config/tokens';
import { IdentityModule } from '../identity/identity.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { FetchGithubOAuth, GITHUB_OAUTH } from './github.client';

@Module({
  imports: [IdentityModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
    {
      provide: GITHUB_OAUTH,
      inject: [AUTH_CONFIG],
      useFactory: (config: AuthConfig) => new FetchGithubOAuth(config.github),
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
