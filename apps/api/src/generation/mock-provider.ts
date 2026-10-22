import {
  LlmProviderError,
  type LlmErrorCode,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
} from './llm-provider';

export type MockStep =
  | { readonly kind: 'content'; readonly content: string }
  | { readonly kind: 'error'; readonly code: LlmErrorCode; readonly message?: string };

export interface MockProviderOptions {
  readonly model?: string;
  // Ответы по вызовам: первый шаг — на первый запрос. Когда шаги кончились,
  // провайдер отвечает корректным JSON по умолчанию.
  readonly steps?: readonly MockStep[];
}

// Заглушка провайдера для тестов, CI и локального запуска без ключа.
// Реальные вызовы в CI запрещены, поэтому поведение провайдера тут полностью задано сценарием.
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly requests: LlmRequest[] = [];

  private readonly steps: readonly MockStep[];

  constructor(private readonly options: MockProviderOptions = {}) {
    this.steps = options.steps ?? [];
  }

  get model(): string {
    return this.options.model ?? 'mock-dzen-writer';
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const step = this.steps[this.requests.length - 1];
    if (step === undefined) {
      return { content: defaultContent(request), usage: defaultUsage(request) };
    }
    if (step.kind === 'error') {
      throw new LlmProviderError(step.code, step.message ?? 'Провайдер вернул ошибку');
    }
    return { content: step.content, usage: defaultUsage(request) };
  }
}

// Ответ по умолчанию собирается из самого запроса: тема и метки фактов читаются из промпта.
export function defaultContent(request: LlmRequest): string {
  const prompt = request.messages.map((message) => message.content).join('\n');
  const topic = extract(prompt, '- Тема / инфоповод: ') ?? 'Материал';
  const labels = extractFactLabels(prompt);
  const claims = labels.map((label) => ({
    text: `Утверждение по факту ${label}`,
    type: 'fact',
    fact_ids: [label],
  }));
  return JSON.stringify({
    status: 'ok',
    title: topic.slice(0, 80),
    article_markdown: [
      `## ${topic}`,
      '',
      'Вступление: зачем эта тема важна читателю и что он узнает из материала.',
      '',
      'Основная часть: факты из списка ниже, без чисел и имён, которых в фактах нет.',
      ...labels.flatMap(() => ['', 'Факт раскрыт в тексте без ссылок на метки.']),
      '',
      'Заключение: короткий вывод и мягкий призыв.',
    ].join('\n'),
    seo_title: topic.slice(0, 70),
    tags: ['ии', 'автоматизация', 'агентные-системы', 'практика', 'опыт', 'инструменты'],
    description: 'Материал о том, как подходят к теме на практике.',
    image_prompt: 'Спокойная иллюстрация: рабочий стол с ноутбуком и заметками.',
    claims,
    questions: [],
    advertising_label_suggested: false,
    disclaimer_needed: false,
  });
}

function defaultUsage(request: LlmRequest): LlmUsage {
  const inputTokens = Math.ceil(request.messages.reduce((sum, m) => sum + m.content.length, 0) / 4);
  return { inputTokens, outputTokens: Math.ceil(inputTokens * 2) };
}

function extract(text: string, marker: string): string | null {
  const index = text.indexOf(marker);
  if (index < 0) {
    return null;
  }
  const rest = text.slice(index + marker.length);
  const end = rest.indexOf('\n');
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

function extractFactLabels(prompt: string): string[] {
  const labels: string[] = [];
  for (const line of prompt.split('\n')) {
    const match = /^(F\d+)\s\[/.exec(line);
    if (match?.[1] !== undefined && !labels.includes(match[1])) {
      labels.push(match[1]);
    }
  }
  return labels;
}
