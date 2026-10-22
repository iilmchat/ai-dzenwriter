import { Controller, Get, Param, Res } from '@nestjs/common';
import type { PublicationListResponse } from '@dzenwriter/shared';
import type { Response } from 'express';
import { AuthUser } from '../auth/auth.decorators';
import type { SessionUser } from '../auth/auth.service';
import { uuidParam } from '../common/uuid-param';
import { PublicationsService } from './publications.service';

@Controller('publications')
export class PublicationsController {
  constructor(private readonly publications: PublicationsService) {}

  // Материалы в публикации: что готово, что запланировано, что уже вышло.
  @Get()
  list(@AuthUser() actor: SessionUser): Promise<PublicationListResponse> {
    void actor;
    return this.publications.list();
  }

  // Пакет для Дзена: zip с текстом, метаданными, промптом обложки и чек-листом.
  @Get(':articleId/export')
  async export(
    @Param('articleId', uuidParam('Некорректный идентификатор материала')) articleId: string,
    @AuthUser() actor: SessionUser,
    @Res() response: Response,
  ): Promise<void> {
    void actor;
    const package_ = await this.publications.buildPackage(articleId);
    response.set({
      'Content-Type': 'application/zip',
      'Content-Length': String(package_.content.length),
      // Понятное имя с кириллицей уходит в filename*, ASCII-запасное — в filename.
      'Content-Disposition': `attachment; filename="${package_.asciiFilename}"; filename*=UTF-8''${encodeURIComponent(package_.filename)}`,
    });
    response.end(package_.content);
  }
}
