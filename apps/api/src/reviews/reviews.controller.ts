import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type CreateReviewCommentInput,
  createReviewCommentSchema,
  type ReviewComment,
  type ReviewCommentsResponse,
} from '@dzenwriter/shared';
import { AuthUser } from '../auth/auth.decorators';
import type { SessionUser } from '../auth/auth.service';
import { uuidParam } from '../common/uuid-param';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ReviewsService } from './reviews.service';

@Controller('articles')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post(':id/versions/:number/comments')
  @HttpCode(HttpStatus.CREATED)
  createComment(
    @Param('id', uuidParam('Некорректный идентификатор материала')) id: string,
    @Param('number', versionNumberPipe()) number: number,
    @Body(new ZodValidationPipe(createReviewCommentSchema)) body: CreateReviewCommentInput,
    @AuthUser() actor: SessionUser,
  ): Promise<ReviewComment> {
    return this.reviews.createComment(actor, id, { ...body, versionNumber: number });
  }

  @Get(':id/versions/:number/comments')
  listComments(
    @Param('id', uuidParam('Некорректный идентификатор материала')) id: string,
    @Param('number', versionNumberPipe()) number: number,
    @AuthUser() actor: SessionUser,
  ): Promise<ReviewCommentsResponse> {
    return this.reviews.listComments(actor, id, number);
  }

  @Patch(':id/versions/:number/comments/:commentId/resolve')
  @HttpCode(HttpStatus.OK)
  resolveComment(
    @Param('id', uuidParam('Некорректный идентификатор материала')) id: string,
    @Param('number', versionNumberPipe()) number: number,
    @Param('commentId', uuidParam('Некорректный идентификатор комментария')) commentId: string,
    @AuthUser() actor: SessionUser,
  ): Promise<ReviewCommentsResponse> {
    return this.reviews.resolveComment(actor, id, number, commentId);
  }
}

function versionNumberPipe(): ParseIntPipe {
  return new ParseIntPipe({
    exceptionFactory: () => new BadRequestException('Некорректный номер версии'),
  });
}
