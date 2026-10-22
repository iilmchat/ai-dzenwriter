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

    res
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: STATUS_CODES[status] ?? 'Error',
        status,
        detail:
          status < 500 && exception instanceof HttpException ? detailOf(exception) : undefined,
        instance: req.originalUrl.split('?')[0],
        requestId: req.id,
      });
  }
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
