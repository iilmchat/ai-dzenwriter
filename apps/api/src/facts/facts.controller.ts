import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createFactInputSchema,
  factConsentInputSchema,
  factFieldsSchema,
  factListQuerySchema,
  factVersionInputSchema,
  updateFactInputSchema,
  type CreateFactInput,
  type FactConsentInput,
  type FactFields,
  type FactItem,
  type FactListQuery,
  type FactListResponse,
  type FactVersionInput,
  type UpdateFactInput,
} from '@dzenwriter/shared';
import { AuthUser } from '../auth/auth.decorators';
import type { SessionUser } from '../auth/auth.service';
import { uuidParam } from '../common/uuid-param';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { FactsService } from './facts.service';

const factIdPipe = () => uuidParam('Некорректный идентификатор факта');

// Библиотеку видят все вошедшие. Одобряют и подтверждают согласие ревьюер и администратор, но не автор факта.
@Controller('facts')
export class FactsController {
  constructor(private readonly facts: FactsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(factListQuerySchema)) query: FactListQuery,
    @AuthUser() actor: SessionUser,
  ): Promise<FactListResponse> {
    return this.facts.list(actor, query);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createFactInputSchema)) body: CreateFactInput,
    @AuthUser() actor: SessionUser,
  ): Promise<FactItem> {
    return this.facts.create(actor, body);
  }

  @Patch(':id')
  update(
    @Param('id', factIdPipe()) id: string,
    @Body(new ZodValidationPipe(updateFactInputSchema)) body: UpdateFactInput,
    @AuthUser() actor: SessionUser,
  ): Promise<FactItem> {
    return this.facts.update(actor, id, body, new Date());
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', factIdPipe()) id: string,
    @Body(new ZodValidationPipe(factVersionInputSchema)) body: FactVersionInput,
    @AuthUser() actor: SessionUser,
  ): Promise<FactItem> {
    return this.facts.approve(actor, id, body, new Date());
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id', factIdPipe()) id: string,
    @Body(new ZodValidationPipe(factVersionInputSchema)) body: FactVersionInput,
    @AuthUser() actor: SessionUser,
  ): Promise<FactItem> {
    return this.facts.reject(actor, id, body, new Date());
  }

  @Post(':id/consent')
  @HttpCode(HttpStatus.OK)
  confirmConsent(
    @Param('id', factIdPipe()) id: string,
    @Body(new ZodValidationPipe(factConsentInputSchema)) body: FactConsentInput,
    @AuthUser() actor: SessionUser,
  ): Promise<FactItem> {
    return this.facts.confirmConsent(actor, id, body, new Date());
  }

  @Post(':id/consent/withdraw')
  @HttpCode(HttpStatus.OK)
  withdrawConsent(
    @Param('id', factIdPipe()) id: string,
    @Body(new ZodValidationPipe(factVersionInputSchema)) body: FactVersionInput,
    @AuthUser() actor: SessionUser,
  ): Promise<FactItem> {
    return this.facts.withdrawConsent(actor, id, body, new Date());
  }

  @Post(':id/corrections')
  correct(
    @Param('id', factIdPipe()) id: string,
    @Body(new ZodValidationPipe(factFieldsSchema)) body: FactFields,
    @AuthUser() actor: SessionUser,
  ): Promise<FactItem> {
    return this.facts.correct(actor, id, body);
  }
}
