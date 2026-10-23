import { Controller, Get, Query } from '@nestjs/common';
import {
  pilotMetricsQuerySchema,
  type PilotMetricsQuery,
  type PilotMetricsResponse,
} from '@dzenwriter/shared';
import { Roles } from '../auth/auth.decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PilotService } from './pilot.service';

@Controller('pilot')
export class PilotController {
  constructor(private readonly pilot: PilotService) {}

  // Показатели пилота видит администратор: это агрегаты по всей редакции.
  @Get('metrics')
  @Roles('admin')
  metrics(
    @Query(new ZodValidationPipe(pilotMetricsQuerySchema)) query: PilotMetricsQuery,
  ): Promise<PilotMetricsResponse> {
    return this.pilot.metrics(query);
  }
}
