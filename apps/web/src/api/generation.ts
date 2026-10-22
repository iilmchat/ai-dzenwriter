import {
  generationCancelResponseSchema,
  generationRunListResponseSchema,
  type GenerationCancelResponse,
  type GenerationResult,
  type GenerationRunListResponse,
  type GenerationStageEvent,
} from '@dzenwriter/shared';
import { ApiError, apiRequest } from './client';

export type GenerationEvent =
  | { readonly type: 'stage'; readonly stage: GenerationStageEvent }
  | { readonly type: 'result'; readonly result: GenerationResult };

export interface StartGenerationOptions {
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

// Запуск генерации отдаёт поток SSE, поэтому читаем тело ответа сами:
// EventSource не умеет POST.
export async function* startGeneration(
  articleId: string,
  options: StartGenerationOptions = {},
): AsyncGenerator<GenerationEvent> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (options.idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  const response = await fetch(`/api/v1/articles/${articleId}/generations`, {
    method: 'POST',
    headers,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await problemText(response));
  }
  if (response.body === null) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseEvent(block);
      if (event !== null) {
        yield event;
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export function fetchGenerationRuns(articleId: string): Promise<GenerationRunListResponse> {
  return apiRequest(`/api/v1/articles/${articleId}/generations`, {
    schema: generationRunListResponseSchema,
  });
}

export function cancelGeneration(
  articleId: string,
  runId: string,
): Promise<GenerationCancelResponse> {
  return apiRequest(`/api/v1/articles/${articleId}/generations/${runId}/cancel`, {
    method: 'POST',
    schema: generationCancelResponseSchema,
  });
}

function parseEvent(block: string): GenerationEvent | null {
  const lines = block.split('\n').filter((line) => line.length > 0);
  const name = lines.find((line) => line.startsWith('event: '))?.slice(7);
  const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
  if (name === undefined || data === undefined) {
    return null;
  }
  try {
    return JSON.parse(data) as GenerationEvent;
  } catch {
    return null;
  }
}

// Ошибка до начала потока приходит в формате problem+json.
async function problemText(response: Response): Promise<string> {
  try {
    const problem = (await response.json()) as { readonly detail?: string };
    return problem.detail ?? `Ошибка ${response.status}`;
  } catch {
    return `Ошибка ${response.status}`;
  }
}
