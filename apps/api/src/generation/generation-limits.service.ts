import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { moscowDayStart } from '../common/moscow-time';
import type { LlmConfig } from '../config/llm-config';
import { LLM_CONFIG } from '../config/tokens';
import { GENERATION_REPOSITORY, type GenerationRepository } from './generation.repository';
import type { LlmUsage } from './llm-provider';

// Общие суточные лимиты LLM: основной текст и бриф считаются в одном дневном лимите.
// Вынесены из GenerationService, чтобы бриф не дублировал проверку и расход.
@Injectable()
export class GenerationLimitsService {
  constructor(
    @Inject(GENERATION_REPOSITORY) private readonly repository: GenerationRepository,
    @Inject(LLM_CONFIG) private readonly llm: LlmConfig,
  ) {}

  // Суточные лимиты: запуск на пользователя и общий бюджет. 0 — лимита нет.
  async checkLimits(actorId: string): Promise<void> {
    const since = moscowDayStart(new Date());
    const used = await this.repository.countRunsSince(actorId, since);
    if (this.llm.dailyLimitPerUser > 0 && used >= this.llm.dailyLimitPerUser) {
      throw new HttpException(
        `Дневной лимит генераций исчерпан: ${used} из ${this.llm.dailyLimitPerUser}. Попробуйте завтра.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const spent = Number(await this.repository.sumCostSince(since));
    if (this.llm.dailyBudgetUsd > 0 && spent >= this.llm.dailyBudgetUsd) {
      throw new HttpException(
        `Дневной бюджет генерации исчерпан: ${spent.toFixed(2)} из ${this.llm.dailyBudgetUsd} $. Попробуйте завтра.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // Стоимость считается по ценам провайдера из окружения.
  costOf(usage: LlmUsage): number {
    const input = (usage.inputTokens / 1_000_000) * this.llm.inputPricePerMtok;
    const output = (usage.outputTokens / 1_000_000) * this.llm.outputPricePerMtok;
    return Math.round((input + output) * 10_000) / 10_000;
  }
}
