import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  createMetricInputSchema,
  type CreateMetricInput,
  type CreateMetricResponse,
  importMetricsInputSchema,
  type ImportMetricsInput,
  type ImportMetricsResponse,
  type MetricListResponse,
} from '@dzenwriter/shared';
import { AuthUser } from '../auth/auth.decorators';
import type { SessionUser } from '../auth/auth.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  // Снимки метрик: по дате и по материалу.
  @Get()
  list(
    @Query('articleId') articleId: string | undefined,
    @AuthUser() actor: SessionUser,
  ): Promise<MetricListResponse> {
    return this.metrics.list(actor, { articleId });
  }

  // Ручной ввод: цифры из панели Дзена на дату.
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createMetricInputSchema)) body: CreateMetricInput,
    @AuthUser() actor: SessionUser,
  ): Promise<CreateMetricResponse> {
    return this.metrics.create(actor, body);
  }

  // Импорт CSV: ссылки из панели Дзена сопоставляются с публикациями.
  @Post('import')
  @HttpCode(HttpStatus.OK)
  importCsv(
    @Body(new ZodValidationPipe(importMetricsInputSchema)) body: ImportMetricsInput,
    @AuthUser() actor: SessionUser,
  ): Promise<ImportMetricsResponse> {
    return this.metrics.importCsv(actor, body.csv);
  }
}
