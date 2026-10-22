import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import type { AppConfig } from './config/app-config';
import { parseEnv } from './config/env';
import { APP_CONFIG } from './config/tokens';
import { createLogger } from './logging/logger';
import { PinoNestLogger } from './logging/nest-logger';

async function bootstrap(): Promise<void> {
  const env = parseEnv(process.env);
  const logger = createLogger(env.LOG_LEVEL);
  const app = await NestFactory.create(AppModule, { logger: new PinoNestLogger(logger) });
  configureApp(app, env, logger);

  const config = app.get<AppConfig>(APP_CONFIG);
  logger.info(
    {
      configDir: config.configDir,
      styles: config.styles.size,
      formats: Object.keys(config.formats.formats).length,
    },
    'Конфигурация загружена',
  );

  await app.listen(env.API_PORT, '0.0.0.0');
  logger.info({ port: env.API_PORT, env: env.NODE_ENV }, 'API запущен');
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
