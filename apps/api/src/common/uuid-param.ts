import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

// UUID из пути: при ошибке ответ 400 с понятным текстом вместо общего.
export function uuidParam(message: string): ParseUUIDPipe {
  return new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException(message) });
}
