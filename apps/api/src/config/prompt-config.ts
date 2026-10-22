import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ConfigError } from './errors';

const BASE_PROMPT_FILE = 'dzen_writer.md';

// Ищет каталог prompts/ вверх от указанной папки: так же, как ищется config/.
export function resolvePromptsDir(explicitDir?: string, startDir: string = __dirname): string {
  if (explicitDir) {
    const dir = path.resolve(explicitDir);
    if (!existsSync(path.join(dir, BASE_PROMPT_FILE))) {
      throw new ConfigError(`PROMPTS_DIR: в каталоге ${dir} нет файла ${BASE_PROMPT_FILE}`);
    }
    return dir;
  }

  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, 'prompts');
    if (existsSync(path.join(candidate, BASE_PROMPT_FILE))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ConfigError('Не найден каталог prompts/ с dzen_writer.md. Задайте PROMPTS_DIR.');
    }
    current = parent;
  }
}

// Базовый промпт — часть версии материала, поэтому пустой файл считаем ошибкой конфигурации.
export function loadBasePrompt(promptsDir: string): string {
  const file = path.join(promptsDir, BASE_PROMPT_FILE);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${file}: файл не читается: ${reason}`);
  }
  if (text.trim().length === 0) {
    throw new ConfigError(`${file}: файл пуст`);
  }
  return text;
}
