import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

// Внутренние сообщения Nest пишем тем же JSON-логгером, что и HTTP-запросы.
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string): void {
    this.logger.info({ context }, text(message));
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, text(message));
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn({ context }, text(message));
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug({ context }, text(message));
  }

  verbose(message: unknown, context?: string): void {
    this.logger.trace({ context }, text(message));
  }
}

function text(message: unknown): string {
  return typeof message === 'string' ? message : JSON.stringify(message);
}
