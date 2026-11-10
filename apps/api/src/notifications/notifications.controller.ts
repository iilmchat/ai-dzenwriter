import { randomUUID } from 'node:crypto';
import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { NotificationsResponse } from '@dzenwriter/shared';
import { AuthUser } from '../auth/auth.decorators';
import type { SessionUser } from '../auth/auth.service';
import { uuidParam } from '../common/uuid-param';
import type { Env } from '../config/env';
import { ENV } from '../config/tokens';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  list(@AuthUser() actor: SessionUser): Promise<NotificationsResponse> {
    return this.notifications.list(actor);
  }

  @Patch(':id/read')
  markRead(
    @Param('id', uuidParam('Некорректный идентификатор уведомления')) id: string,
    @AuthUser() actor: SessionUser,
  ): Promise<NotificationsResponse> {
    return this.notifications.markRead(actor, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@AuthUser() actor: SessionUser): Promise<NotificationsResponse> {
    return this.notifications.markAllRead(actor);
  }

  // Ручная проверка колокольчика: маршрут существует только в development.
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async createTest(@AuthUser() actor: SessionUser): Promise<NotificationsResponse> {
    if (this.env.NODE_ENV !== 'development') {
      throw new ForbiddenException('Тестовые уведомления доступны только в development');
    }
    await this.notifications.notify(
      actor.id,
      'review_requested',
      'Тестовое уведомление: проверка колокольчика',
      randomUUID(),
    );
    return this.notifications.list(actor);
  }
}
