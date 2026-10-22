import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  createProductInputSchema,
  updateProductInputSchema,
  type ArticleFormat,
  type CreateProductInput,
  type FormatCard,
  type Product,
  type StyleCard,
  type StyleConfig,
  type FormatConfig,
  type UpdateProductInput,
} from '@dzenwriter/shared';
import { AuthUser, Roles } from '../auth/auth.decorators';
import type { SessionUser } from '../auth/auth.service';
import { uuidParam } from '../common/uuid-param';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/tokens';
import { CATALOG_REPOSITORY, type CatalogRepository } from './catalog.repository';
import { ProductsService } from './products.service';

// Стили и форматы — из config/ (проверены при старте), продукты — из БД.
@Controller()
export class CatalogController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CATALOG_REPOSITORY) private readonly catalog: CatalogRepository,
    private readonly productsService: ProductsService,
  ) {}

  @Get('styles')
  styles(): { items: StyleCard[] } {
    return { items: [...this.config.styles.values()].map(toStyleCard) };
  }

  @Get('formats')
  formats(): { items: FormatCard[] } {
    return {
      items: Object.entries(this.config.formats.formats).map(([id, format]) =>
        toFormatCard(id as ArticleFormat, format),
      ),
    };
  }

  @Get('products')
  async products(): Promise<{ items: Product[] }> {
    return { items: await this.catalog.listProducts() };
  }

  @Post('products')
  @Roles('admin')
  createProduct(
    @Body(new ZodValidationPipe(createProductInputSchema)) body: CreateProductInput,
    @AuthUser() actor: SessionUser,
  ): Promise<Product> {
    return this.productsService.create(actor, body);
  }

  @Patch('products/:id')
  @Roles('admin')
  updateProduct(
    @Param('id', uuidParam('Некорректный идентификатор продукта')) id: string,
    @Body(new ZodValidationPipe(updateProductInputSchema)) body: UpdateProductInput,
    @AuthUser() actor: SessionUser,
  ): Promise<Product> {
    return this.productsService.update(actor, id, body, new Date());
  }
}

function toStyleCard(style: StyleConfig): StyleCard {
  return {
    id: style.id,
    name: style.name,
    summary: style.summary,
    audience: style.audience,
    version: style.version,
    allowedFormats: style.allowed_formats,
    defaultTone: style.voice.default_tone,
    voice: {
      person: style.voice.person,
      register: style.voice.register,
      readerAddress: style.voice.reader_address,
    },
    factPolicy: style.fact_policy,
    inputs: {
      requiredFactTypes: style.inputs.required_fact_types,
      minFacts: style.inputs.min_facts,
      minNoteChars: style.inputs.min_note_chars ?? null,
      requiresProduct: style.inputs.requires_product === true,
      requiresConsent: style.inputs.requires_consent === true,
      requiresAnonymization: style.inputs.requires_anonymization === true,
    },
    checks: Object.entries(style.checks).map(([id, severity]) => ({ id, severity })),
    disclaimer: {
      forTopics: style.disclaimer.for_topics,
      always: style.disclaimer.always,
      text: style.disclaimer.text,
    },
  };
}

function toFormatCard(id: ArticleFormat, format: FormatConfig): FormatCard {
  return {
    id,
    name: format.name,
    length: format.length,
    blocks: format.blocks ?? null,
    items: format.items ?? null,
    structure: format.structure,
  };
}
