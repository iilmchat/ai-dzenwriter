import {
  autopilotExtractResponseSchema,
  type AutopilotEvent,
  type AutopilotExtractInput,
  type AutopilotExtractResponse,
} from '@dzenwriter/shared';
import { ApiError, apiRequest } from './client';

// Извлечение фактов из сырого задания: создаёт материал и черновики фактов.
export function extractFacts(input: AutopilotExtractInput): Promise<AutopilotExtractResponse> {
  return apiRequest('/api/v1/autopilot/extract', {
    method: 'POST',
    body: input,
    schema: autopilotExtractResponseSchema,
  });
}

export interface StartAutopilotOptions {
  readonly signal?: AbortSignal;
}

// Цикл автопилота отдаёт поток SSE, поэтому читаем тело ответа сами:
// EventSource не умеет POST.
export async function* startAutopilot(
  articleId: string,
  options: StartAutopilotOptions = {},
): AsyncGenerator<AutopilotEvent> {
  const response = await fetch(`/api/v1/autopilot/${articleId}/run`, {
    method: 'POST',
    headers: { Accept: 'text/event-stream' },
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

function parseEvent(block: string): AutopilotEvent | null {
  const lines = block.split('\n').filter((line) => line.length > 0);
  const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
  if (data === undefined) {
    return null;
  }
  try {
    return JSON.parse(data) as AutopilotEvent;
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
