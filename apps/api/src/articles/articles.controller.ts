import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
}

function articleIdPipe(): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () => new BadRequestException('Некорректный идентификатор материала'),
  });
}
