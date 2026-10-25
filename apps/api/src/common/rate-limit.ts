import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { Env } from '../config/env';

type RequestWithId = Request & { id?: string };

// 429 в формате RFC 9457 — той же формы, что и в ProblemDetailsFilter.
function tooManyRequests(req: Request, res: Response): void {
  const { id } = req as RequestWithId;
  res
    .status(429)
    .type('application/problem+json')
    .json({
      type: 'about:blank',
      title: STATUS_CODES[429] ?? 'Error',
      status: 429,
      detail: 'Слишком много запросов: подождите немного и попробуйте снова.',
      instance: req.originalUrl.split('?')[0],
      requestId: id,
    });
}

// Глобальный лимит на /api/v1 с одного IP за минуту; вход в GitHub ограничен жёстче.
// Cookies-based авторизация остаётся без лимита на правильные запросы: окно короткое, порог щедрый.
export function registerRateLimiters(app: INestApplication, env: Env): void {
  const common = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  } as const;

  app.use(
    '/api/v1/auth',
    rateLimit({
      ...common,
      windowMs: 60_000,
      limit: env.AUTH_RATE_LIMIT_MAX,
      handler: tooManyRequests,
    }),
  );
  // Энды входа считаются только своим лимитом: общий пропускает их,
  // чтобы неудачный вход не съедал обычные запросы к материалам.
  app.use(
    '/api/v1',
    rateLimit({
      ...common,
      windowMs: 60_000,
      limit: env.RATE_LIMIT_MAX,
      skip: (req) => req.path.startsWith('/auth'),
      handler: tooManyRequests,
    }),
  );
}
