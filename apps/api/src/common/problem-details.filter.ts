import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { STATUS_CODES } from 'node:http';

type RequestWithId = Request & { id?: string };

// Все ошибки отдаются в формате RFC 9457. Тексты ошибок 5xx наружу не выходят.
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<RequestWithId>();
    const res = http.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      this.logger.error({ err: exception, requestId: req.id }, 'Необработанная ошибка');
    }

    const problem = exception instanceof HttpException ? problemOf(exception) : {};
    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: problem.type ?? 'about:blank',
        title: problem.title ?? STATUS_CODES[status] ?? 'Error',
        status,
        detail:
          status < 500 && exception instanceof HttpException
            ? (problem.detail ?? detailOf(exception))
            : undefined,
        instance: req.originalUrl.split('?')[0],
        requestId: req.id,
      });
  }
}

interface ProblemFields {
  readonly type?: string;
  readonly title?: string;
  readonly detail?: string;
}

// Явные поля problem+json из тела HttpException важнее стандартных подписей.
function problemOf(exception: HttpException): ProblemFields {
  const response = exception.getResponse();
  if (typeof response !== 'object' || response === null) {
    return {};
  }
  const record = response as Record<string, unknown>;
  return {
    ...(typeof record.type === 'string' ? { type: record.type } : {}),
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    ...(typeof record.detail === 'string' ? { detail: record.detail } : {}),
  };
}

function detailOf(exception: HttpException): string | undefined {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  if (typeof response === 'object' && response !== null && 'message' in response) {
    const { message } = response as { message: unknown };
    return Array.isArray(message) ? message.join('; ') : String(message);
  }
  return undefined;
}
