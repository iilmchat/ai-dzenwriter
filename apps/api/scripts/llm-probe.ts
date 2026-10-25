// Проба провайдера перед пилотом: список моделей и пробный структурированный запрос.
// Запуск: pnpm --filter @dzenwriter/api llm:probe
// Ключ берётся из .env (LLM_BASE_URL + LLM_API_KEY + LLM_MODEL). В логи и stdout ключ не печатается.
import { parseEnv } from '../src/config/env';
import { resolveLlmConfig } from '../src/config/llm-config';

const env = parseEnv(process.env as Record<string, string>);
const llm = resolveLlmConfig(env);

if (llm.provider !== 'openai' || !llm.baseUrl || !llm.apiKey) {
  console.error(
    'Нужен настоящий провайдер: LLM_PROVIDER=openai, LLM_BASE_URL и LLM_API_KEY в .env',
  );
  process.exit(1);
}

const baseUrl = llm.baseUrl;
const auth = { Authorization: `Bearer ${llm.apiKey}` };

async function main(): Promise<void> {
  // 1. Список моделей: проверяем, что модель видна на роутере.
  const modelsResponse = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
    headers: auth,
  });
  if (!modelsResponse.ok) {
    console.error(`GET /models → ${modelsResponse.status}`);
    console.error(await modelsResponse.text());
    process.exit(1);
  }
  const models = (await modelsResponse.json()) as { data?: readonly { id?: string }[] };
  const ids = (models.data ?? []).map((entry) => entry.id ?? '').filter(Boolean);
  console.log(`Доступно моделей: ${ids.length}`);
  console.log(
    ids
      .filter((id) => id.toLowerCase().includes(llm.model.toLowerCase().split('-')[0] ?? ''))
      .slice(0, 20)
      .join(', ') || ids.slice(0, 20).join(', '),
  );

  // 2. Пробный запрос с нашим строгим json_schema: так работают гейты.
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary'],
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
    },
  } as const;

  const chatResponse = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: llm.model,
      messages: [
        { role: 'system', content: 'Отвечай только JSON по схеме.' },
        { role: 'user', content: 'Верни title «Как мы проверяем факты» и summary в одну строку.' },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'dzen_writer_output', strict: true, schema },
      },
      temperature: 0.2,
    }),
  });
  const text = await chatResponse.text();
  console.log(`POST /chat/completions → ${chatResponse.status}`);
  console.log(text.slice(0, 600));
  if (!chatResponse.ok) {
    process.exit(1);
  }
}

void main();
