import type { ReadinessResponse } from '@dzenwriter/shared';
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { DatabaseService } from '../database/database.service';

@Controller()
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  // Живость процесса: не ходит в базу, поэтому не падает вместе с ней.
  @Public()
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  // Готовность принимать трафик: нужна база. Возвращает 503, пока база недоступна.
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const database = await this.database.ping();
    if (database === 'error') {
      res.status(503);
    }
    return {
      status: database === 'ok' ? 'ready' : 'unavailable',
      checks: { database },
    };
  }
}
