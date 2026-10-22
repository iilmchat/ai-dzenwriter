import { GENERATION_STATUSES, type GenerationStatus } from '@dzenwriter/shared';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface LlmMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

// Коды ошибок провайдера попадают в generation_runs.error_code и в аудит.
// Тексты ответов провайдера в логи и в базу не пишутся.
export const LLM_ERROR_CODES = [
  'unavailable',
  'timeout',
  'auth',
  'invalid_response',
  'aborted',
] as const;
export type LlmErrorCode = (typeof LLM_ERROR_CODES)[number];

export class LlmProviderError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  // JSON-схема ответа: провайдеры с поддержкой structured output передают её как есть.
  readonly jsonSchema: Record<string, unknown>;
  readonly temperature: number;
  // Сигнал отмены: пользователь нажал «отменить» или соединение закрылось по таймауту.
  readonly signal: AbortSignal | undefined;
}

export interface LlmResponse {
  readonly content: string;
  readonly usage: LlmUsage;
}

// Модуль генерации зависит от интерфейса, а не от провайдера:
// смена OpenAI-совместимого API на другой не трогает домен.
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  generate(request: LlmRequest): Promise<LlmResponse>;
}

// Статус запуска, в который провайдерская ошибка превращается в базе.
export function statusForError(code: LlmErrorCode): GenerationStatus {
  return code === 'aborted' ? 'cancelled' : 'failed';
}

export const GENERATION_STATUS_SET: ReadonlySet<GenerationStatus> = new Set(GENERATION_STATUSES);
