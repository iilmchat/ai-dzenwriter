import { Global, Module } from '@nestjs/common';
import { loadAppConfig, resolveConfigDir, type AppConfig } from './app-config';
import { resolveAuthConfig, type AuthConfig } from './auth-config';
import { parseEnv, type Env } from './env';
import { APP_CONFIG, AUTH_CONFIG, ENV } from './tokens';

// Конфигурация читается при старте: если окружение или config/ неверны, сервис не запустится.
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: (): Env => parseEnv(process.env) },
    {
      provide: APP_CONFIG,
      inject: [ENV],
      useFactory: (env: Env): AppConfig => loadAppConfig(resolveConfigDir(env.CONFIG_DIR)),
    },
    {
      provide: AUTH_CONFIG,
      inject: [ENV],
      useFactory: (env: Env): AuthConfig => resolveAuthConfig(env),
    },
  ],
  exports: [ENV, APP_CONFIG, AUTH_CONFIG],
})
export class ConfigModule {}
