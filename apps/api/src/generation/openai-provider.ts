import {
  LlmProviderError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
} from './llm-provider';

export interface OpenAiProviderOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  // Цены провайдера в долларах за миллион токенов: из них считается cost_usd.
  readonly inputPricePerMtok: number;
  readonly outputPricePerMtok: number;
}

interface ChatCompletionResponse {
  // RouterAI может вернуть HTTP 200 с телом-ошибкой вместо 4xx.
  readonly error?: {
    readonly message?: unknown;
    readonly code?: unknown;
    readonly type?: unknown;
  };
  readonly choices?: readonly {
    readonly message?: { readonly content?: unknown };
  }[];
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

// Первый адаптер к OpenAI-совместимому API: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL.
// Второй провайдер добавляется реализацией LlmProvider, домен не меняется.
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai';

  constructor(private readonly options: OpenAiProviderOptions) {}

  get model(): string {
    return this.options.model;
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          // Без схемы ответ ждём текстом: structured output нужен только генерации статьи.
          ...(request.jsonSchema === undefined
            ? {}
            : {
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: 'dzen_writer_output',
                    strict: true,
                    schema: request.jsonSchema,
                  },
                },
              }),
          temperature: request.temperature,
        }),
        signal,
      });
    } catch (error) {
      throw this.transportError(error, request.signal);
    }

    if (!response.ok) {
      throw await this.httpError(response);
    }

    const payload = await this.readJson(response);
    if (payload.error !== undefined && payload.error !== null) {
      // Сообщение провайдера помогает диагностике: без него видно только «ответ без текста».
      throw new LlmProviderError('invalid_response', providerErrorMessage(payload.error));
    }
    const content = extractContent(payload);
    if (content === null) {
      throw new LlmProviderError('invalid_response', 'Провайдер вернул ответ без текста');
    }
    return {
      content,
      usage: extractUsage(payload),
    };
  }

  // Стоимость прогона по ценам провайдера. Нулевая цена — неизвестная цена.
  costUsd(usage: LlmUsage): number {
    const input = (usage.inputTokens / 1_000_000) * this.options.inputPricePerMtok;
    const output = (usage.outputTokens / 1_000_000) * this.options.outputPricePerMtok;
    return Math.round((input + output) * 10_000) / 10_000;
  }

  private transportError(error: unknown, callerSignal: AbortSignal | undefined): LlmProviderError {
    if (callerSignal?.aborted === true) {
      return new LlmProviderError('aborted', 'Запуск отменён');
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      return new LlmProviderError('timeout', 'Провайдер не ответил вовремя');
    }
    return new LlmProviderError('unavailable', 'Провайдер недоступен');
  }

  private async httpError(response: Response): Promise<LlmProviderError> {
    if (response.status === 401 || response.status === 403) {
      return new LlmProviderError('auth', 'Провайдер отклонил ключ');
    }
    if (response.status === 429) {
      return new LlmProviderError('unavailable', 'Провайдер отклонил запрос: лимит запросов');
    }
    if (response.status >= 500) {
      return new LlmProviderError('unavailable', 'Провайдер вернул ошибку сервера');
    }
    return new LlmProviderError('invalid_response', 'Провайдер отклонил запрос');
  }

  private async readJson(response: Response): Promise<ChatCompletionResponse> {
    try {
      return (await response.json()) as ChatCompletionResponse;
    } catch {
      throw new LlmProviderError('invalid_response', 'Провайдер вернул ответ не в JSON');
    }
  }
}

// Короткое описание ошибки провайдера для логов: тип, код и текст, без тела запроса.
function providerErrorMessage(error: NonNullable<ChatCompletionResponse['error']>): string {
  const code = [error.type, error.code]
    .filter((value) => value !== undefined && value !== null && String(value).length > 0)
    .map((value) => String(value))
    .join('/');
  const message = typeof error.message === 'string' ? error.message.trim().slice(0, 300) : '';
  const prefix = code.length > 0 ? `Провайдер вернул ошибку ${code}` : 'Провайдер вернул ошибку';
  return message.length > 0 ? `${prefix}: ${message}` : prefix;
}

// Content бывает строкой, а у некоторых провайдеров — массивом частей.
function extractContent(payload: ChatCompletionResponse): string | null {
  const raw = payload.choices?.[0]?.message?.content;
  if (typeof raw === 'string') {
    return raw.trim().length > 0 ? raw : null;
  }
  if (Array.isArray(raw)) {
    const text = raw
      .map((part) =>
        typeof part === 'object' && part !== null && 'text' in part
          ? String((part as { text: unknown }).text)
          : '',
      )
      .join('');
    return text.trim().length > 0 ? text : null;
  }
  return null;
}

function extractUsage(payload: ChatCompletionResponse): LlmUsage {
  return {
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
  };
}
