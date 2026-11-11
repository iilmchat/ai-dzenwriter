import { Body, Controller, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  autopilotExtractInputSchema,
  type AutopilotEvent,
  type AutopilotExtractInput,
  type AutopilotExtractResponse,
} from '@dzenwriter/shared';
import type { Response } from 'express';
import { AuthUser } from '../auth/auth.decorators';
import type { SessionUser } from '../auth/auth.service';
import { uuidParam } from '../common/uuid-param';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AutopilotService } from './autopilot.service';

@Controller('autopilot')
export class AutopilotController {
  constructor(private readonly autopilot: AutopilotService) {}

  // Извлечение фактов из сырого задания: обычный JSON-ответ.
  @Post('extract')
  @HttpCode(HttpStatus.CREATED)
  extract(
    @Body(new ZodValidationPipe(autopilotExtractInputSchema)) body: AutopilotExtractInput,
    @AuthUser() actor: SessionUser,
  ): Promise<AutopilotExtractResponse> {
    return this.autopilot.extractFacts(actor, body);
  }

  // Цикл автопилота отдаёт поток SSE: стадии, итог или ошибку.
  @Post(':articleId/run')
  async run(
    @Param('articleId', uuidParam('Некорректный идентификатор материала')) articleId: string,
    @AuthUser() actor: SessionUser,
    @Res() response: Response,
  ): Promise<void> {
    // Права и готовность фактов проверяем до потока: клиент получит problem+json.
    await this.autopilot.prepare(actor, articleId);

    response.status(HttpStatus.OK);
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx иначе буферизует поток, и клиент не увидит стадии вовремя.
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();

    try {
      await this.autopilot.runAutopilot(actor, articleId, (event) => {
        writeEvent(response, event);
      });
    } catch {
      // Поток уже начат: сервис записал ошибку событием, код ответа не поменять.
    }
    response.end();
  }
}

function writeEvent(response: Response, event: AutopilotEvent): void {
  response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}
