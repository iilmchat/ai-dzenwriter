import { Inject, Injectable } from '@nestjs/common';
import type { FormatConfig, StyleConfig } from '@dzenwriter/shared';
import { runChecks, type CheckOutput } from './check-engine';
import type { CheckClaim, CheckFact } from './check-context';
import { APP_CONFIG } from '../config/tokens';
import type { AppConfig } from '../config/app-config';

export interface VersionChecksInput {
  readonly style: StyleConfig;
  readonly format: FormatConfig;
  readonly topic: string;
  readonly keywords: readonly string[];
  readonly productName: string | null;
  readonly facts: readonly CheckFact[];
  readonly title: string;
  readonly seoTitle: string;
  readonly tags: readonly string[];
  readonly articleMarkdown: string;
  readonly advertisingLabel: boolean;
  readonly disclaimerText: string | null;
  readonly claims: readonly CheckClaim[];
  readonly factLabels: readonly string[];
}

// Сервис проверок: считает проверки для версии статьи и размечает утверждения.
@Injectable()
export class ChecksService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  run(input: VersionChecksInput): CheckOutput {
    return runChecks({
      ...input,
      config: this.config.checks,
    });
  }
}
