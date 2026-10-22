import { readinessResponseSchema, type ReadinessResponse } from '@dzenwriter/shared';

export type ReadinessState =
  | { phase: 'loading' }
  | { phase: 'ready'; response: ReadinessResponse }
  | { phase: 'unavailable'; reason: string; response?: ReadinessResponse };

// Ответ проверяется той же схемой, что и на сервере: расхождение контракта видно сразу.
export async function fetchReadiness(): Promise<ReadinessState> {
  try {
    const response = await fetch('/ready', { headers: { Accept: 'application/json' } });
    const body = readinessResponseSchema.parse(await response.json());
    if (body.status === 'ready') {
      return { phase: 'ready', response: body };
    }
    return { phase: 'unavailable', reason: 'база данных не отвечает', response: body };
  } catch {
    return { phase: 'unavailable', reason: 'сервис не отвечает' };
  }
}
