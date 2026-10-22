import { Global, Module } from '@nestjs/common';
import { loadAppConfig, resolveConfigDir, type AppConfig } from './app-config';
import { parseEnv, type Env } from './env';
import { APP_CONFIG, ENV } from './tokens';

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
  ],
  exports: [ENV, APP_CONFIG],
})
export class ConfigModule {}
