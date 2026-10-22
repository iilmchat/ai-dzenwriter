import pino, { type Logger } from 'pino';

// Заголовки с cookie и токенами не попадают в логи. Тела запросов и ответов не логируются вовсе.
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'dzenwriter-api' },
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      censor: '[скрыто]',
    },
  });
}
