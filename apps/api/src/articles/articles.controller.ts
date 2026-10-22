import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type ArticleDetail,
  type ArticleListQuery,
  type ArticleListResponse,
  articleListQuerySchema,
  attachFactInputSchema,
  type AttachFactInput,
  type ConfirmCheckInput,
  confirmCheckInputSchema,
  type CreateArticleInput,
  type CreateArticleResponse,
  createArticleInputSchema,
  type TransitionInput,
  transitionInputSchema,
  type UpdateArticleInput,
  updateArticleInputSchema,
} from '@dzenwriter/shared';
import { AuthUser } from '../auth/auth.decorators';
import type { SessionUser } from '../auth/auth.service';
import { uuidParam } from '../common/uuid-param';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ArticlesService } from './articles.service';

// Доска видна всем вошедшим: команда работает с общим списком. Изменения — по правилам сервиса.
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(articleListQuerySchema)) query: ArticleListQuery,
    @AuthUser() actor: SessionUser,
  ): Promise<ArticleListResponse> {
    return this.articles.list(query, actor.id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createArticleInputSchema)) body: CreateArticleInput,
    @AuthUser() actor: SessionUser,
  ): Promise<CreateArticleResponse> {
    return this.articles.create(actor, body);
  }

  @Get(':id')
  get(
    @Param('id', articleIdPipe()) id: string,
    @AuthUser() actor: SessionUser,
  ): Promise<ArticleDetail> {
    return this.articles.get(actor, id);
  }

  @Patch(':id')
  update(
    @Param('id', articleIdPipe()) id: string,
    @Body(new ZodValidationPipe(updateArticleInputSchema)) body: UpdateArticleInput,
    @AuthUser() actor: SessionUser,
  ): Promise<ArticleDetail> {
    return this.articles.update(actor, id, body, new Date());
  }

  @Post(':id/transitions')
  @HttpCode(HttpStatus.OK)
  transition(
    @Param('id', articleIdPipe()) id: string,
    @Body(new ZodValidationPipe(transitionInputSchema)) body: TransitionInput,
    @AuthUser() actor: SessionUser,
  ): Promise<ArticleDetail> {
    return this.articles.transition(actor, id, body, new Date());
  }

  @Post(':id/facts')
  attachFact(
    @Param('id', articleIdPipe()) id: string,
    @Body(new ZodValidationPipe(attachFactInputSchema)) body: AttachFactInput,
    @AuthUser() actor: SessionUser,
  ): Promise<ArticleDetail> {
    return this.articles.attachFact(actor, id, body.factId);
  }

  // Подтверждение ревьюера на запуск генерации для темы вне фокуса ИИ.
  @Post(':id/generation-confirmation')
  @HttpCode(HttpStatus.OK)
  confirmGeneration(
    @Param('id', articleIdPipe()) id: string,
    @AuthUser() actor: SessionUser,
  ): Promise<ArticleDetail> {
    return this.articles.confirmGeneration(actor, id);
  }

  // Подтверждение проверки автором: снимает блокировку и попадает в аудит.
  @Post(':id/versions/:number/checks/:index/confirm')
  @HttpCode(HttpStatus.OK)
  confirmCheck(
    @Param('id', articleIdPipe()) id: string,
    @Param('number', versionNumberPipe()) number: number,
    @Param('index', checkIndexPipe()) index: number,
    @Body(new ZodValidationPipe(confirmCheckInputSchema)) body: ConfirmCheckInput,
    @AuthUser() actor: SessionUser,
  ): Promise<ArticleDetail> {
    return this.articles.confirmCheck(actor, id, number, index, body.comment, new Date());
  }

  @Delete(':id/facts/:factId')
  detachFact(
    @Param('id', articleIdPipe()) id: string,
    @Param('factId', uuidParam('Некорректный идентификатор факта')) factId: string,
    @AuthUser() actor: SessionUser,
  ): Promise<ArticleDetail> {
    return this.articles.detachFact(actor, id, factId);
  }
}

function articleIdPipe(): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () => new BadRequestException('Некорректный идентификатор материала'),
  });
}

// Номер версии и индекс проверки — целые числа из пути.
function versionNumberPipe(): ParseIntPipe {
  return new ParseIntPipe({
    exceptionFactory: () => new BadRequestException('Некорректный номер версии'),
  });
}

function checkIndexPipe(): ParseIntPipe {
  return new ParseIntPipe({
    exceptionFactory: () => new BadRequestException('Некорректный номер проверки'),
  });
}
