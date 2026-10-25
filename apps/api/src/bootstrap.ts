import { RequestMethod, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { IncomingMessage } from 'node:http';
import type { Logger } from 'pino';
import pinoHttp from 'pino-http';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import { registerRateLimiters } from './common/rate-limit';
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
      // В строке запроса бывают одноразовый code OAuth и state: в логах остаётся только путь.
      serializers: {
        req: (req: IncomingMessage & { id?: unknown }) => ({
          id: req.id,
          method: req.method,
          url: req.url?.split('?')[0],
        }),
      },
    }),
  );
  // CSP отвечает nginx: его политика для HTML-страниц строже дефолта helmet.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  // В production API стоим за nginx-прокси из docker compose: достоверно res.ip
  // для лимитеров нужен только там, один уровень прокси.
  if (env.NODE_ENV === 'production') {
    (app as NestExpressApplication).set('trust proxy', 1);
  }
  registerRateLimiters(app, env);
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalFilters(new ProblemDetailsFilter(logger));
  app.enableShutdownHooks();
}
