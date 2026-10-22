import { problemDetailsSchema } from '@dzenwriter/shared';

// Схемы zod из shared проходят этот контракт, поэтому веб не импортирует zod напрямую.
export interface Parser<T> {
  parse(input: unknown): T;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions<T> {
  readonly method?: 'GET' | 'POST' | 'PATCH';
  readonly body?: unknown;
  readonly schema: Parser<T>;
}

// Ответ сверяется той же схемой, что и на сервере: расхождение контракта видно сразу.
export async function apiRequest<T>(path: string, options: RequestOptions<T>): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method: options.method ?? 'GET', headers, body });
  if (!response.ok) {
    throw new ApiError(response.status, await problemMessage(response));
  }
  return options.schema.parse(await response.json());
}

async function problemMessage(response: Response): Promise<string> {
  try {
    const problem = problemDetailsSchema.parse(await response.json());
    return problem.detail ?? `Ошибка ${response.status}`;
  } catch {
    return `Ошибка ${response.status}`;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие';
}
