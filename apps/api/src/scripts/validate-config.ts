import { loadAppConfig, resolveConfigDir } from '../config/app-config';
import { assertProductionLlmProvider } from '../config/env';

// Проверка config/ без базы и без переменных окружения. Запускается в CI на каждый PR.
try {
  assertProductionLlmProvider(process.env.NODE_ENV, process.env.LLM_PROVIDER);
  const configDir = resolveConfigDir(process.env.CONFIG_DIR);
  const config = loadAppConfig(configDir);
  console.log(
    `Конфигурация в порядке: стилей ${config.styles.size}, ` +
      `форматов ${Object.keys(config.formats.formats).length} (${configDir})`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
