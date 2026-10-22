import { RequestMethod, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { Logger } from 'pino';
import pinoHttp from 'pino-http';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { genRequestId } from './common/request-id';
import type { Env } from './config/env';

const SILENT_PATHS = new Set(['/health', '/ready']);

// Общая настройка приложения для main.ts и тестов: логи, защита заголовков, префикс API, ошибки.
export function configureApp(app: INestApplication, env: Env, logger: Logger): void {
  app.use(
    pinoHttp({
      logger,
      genReqId: genRequestId,
      autoLogging: {
        ignore: (req) => SILENT_PATHS.has(req.url?.split('?')[0] ?? ''),
      },
    }),
  );
  app.use(helmet());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalFilters(new ProblemDetailsFilter(logger));
  app.enableShutdownHooks();
}
