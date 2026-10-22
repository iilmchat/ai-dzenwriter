import { Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import {
  type GenerationRunListResponse,
  type GenerationRunSummary,
  generationRunSummarySchema,
} from '@dzenwriter/shared';
import type { Response } from 'express';
import { AuthUser } from '../auth/auth.decorators';
import type { SessionUser } from '../auth/auth.service';
import { uuidParam } from '../common/uuid-param';
import { type GenerationEvent, GenerationService } from './generation.service';

const MAX_IDEMPOTENCY_KEY = 200;

@Controller('articles/:id/generations')
export class GenerationController {
  constructor(private readonly generations: GenerationService) {}

  // Запуск генерации: ответ — поток SSE со стадиями и итогом.
  @Post()
  async start(
    @Param('id', uuidParam('Некорректный идентификатор материала')) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @AuthUser() actor: SessionUser,
    @Res() response: Response,
  ): Promise<void> {
    // Проверки до потока: их ошибки отдаются обычным problem+json, а не событием SSE.
    const plan = await this.generations.prepare(actor, id, normalizeKey(idempotencyKey));

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
      await this.generations.run(plan, async (event) => {
        writeEvent(response, event);
      });
    } catch {
      // Поток уже начат: код ответа не поменяем. Итог запуска сервис уже записал в базу,
      // клиент увидит его в истории запусков.
    }
    response.end();
  }

  // История запусков материала.
  @Get()
  async list(
    @Param('id', uuidParam('Некорректный идентификатор материала')) id: string,
  ): Promise<GenerationRunListResponse> {
    const runs = await this.generations.listRuns(id);
    return { items: runs.map(toSummary) };
  }

  @Post(':runId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', uuidParam('Некорректный идентификатор материала')) id: string,
    @Param('runId', uuidParam('Некорректный идентификатор запуска')) runId: string,
    @AuthUser() actor: SessionUser,
  ): Promise<{ readonly run: GenerationRunSummary }> {
    const run = await this.generations.cancel(actor, id, runId);
    return { run: toSummary(run) };
  }
}

// Ключ идемпотентности ограничиваем по длине: он попадает в уникальный индекс.
function normalizeKey(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.slice(0, MAX_IDEMPOTENCY_KEY);
}

function writeEvent(response: Response, event: GenerationEvent): void {
  const name = event.type === 'stage' ? 'stage' : 'result';
  response.write(`event: ${name}\ndata: ${JSON.stringify(event)}\n\n`);
}

export function toSummary(run: {
  readonly id: string;
  readonly status: string;
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number | null;
  readonly costUsd: string | null;
  readonly errorCode: string | null;
  readonly questions: readonly string[];
  readonly versionNumber: number | null;
  readonly createdAt: Date;
  readonly finishedAt: Date | null;
  readonly createdBy: string;
}): GenerationRunSummary {
  return generationRunSummarySchema.parse({
    id: run.id,
    status: run.status,
    provider: run.provider,
    model: run.model,
    promptVersion: run.promptVersion,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    latencyMs: run.latencyMs,
    costUsd: run.costUsd,
    errorCode: run.errorCode,
    questions: [...run.questions],
    versionNumber: run.versionNumber,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt === null ? null : run.finishedAt.toISOString(),
    createdBy: run.createdBy,
  });
}
