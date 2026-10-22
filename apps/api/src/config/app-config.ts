import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  checksConfigSchema,
  formatsConfigSchema,
  styleConfigSchema,
  type ChecksConfig,
  type FormatsConfig,
  type StyleConfig,
} from '@dzenwriter/shared';
import { parse } from 'yaml';
import type { z } from 'zod';
import { ConfigError, describeIssues } from './errors';

export interface AppConfig {
  readonly configDir: string;
  readonly formats: FormatsConfig;
  readonly styles: ReadonlyMap<string, StyleConfig>;
  // Правила общих проверок текста из config/checks.yaml.
  readonly checks: ChecksConfig;
}

const FORMATS_FILE = 'formats.yaml';
const CHECKS_FILE = 'checks.yaml';
const STYLES_DIR = 'styles';

// Ищет каталог config/ вверх от указанной папки. Так работает и код из исходников,
// и собранный образ, где config/ лежит рядом с приложением.
export function resolveConfigDir(explicitDir?: string, startDir: string = __dirname): string {
  if (explicitDir) {
    const dir = path.resolve(explicitDir);
    if (!existsSync(path.join(dir, FORMATS_FILE))) {
      throw new ConfigError(`CONFIG_DIR: в каталоге ${dir} нет файла ${FORMATS_FILE}`);
    }
    return dir;
  }

  let current = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(current, 'config');
    if (existsSync(path.join(candidate, FORMATS_FILE))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new ConfigError('Не найден каталог config/ с formats.yaml. Задайте CONFIG_DIR.');
    }
    current = parent;
  }
}

// Собирает все ошибки сразу, а не останавливается на первой: так исправлять удобнее.
export function loadAppConfig(configDir: string): AppConfig {
  const errors: string[] = [];
  const formats = readYaml(path.join(configDir, FORMATS_FILE), formatsConfigSchema, errors);
  const checks = readYaml(path.join(configDir, CHECKS_FILE), checksConfigSchema, errors);

  const stylesDir = path.join(configDir, STYLES_DIR);
  const styleFiles = existsSync(stylesDir)
    ? readdirSync(stylesDir)
        .filter((name) => name.endsWith('.yaml'))
        .sort()
    : [];
  if (styleFiles.length === 0) {
    errors.push(`${stylesDir}: нет ни одного стиля (*.yaml)`);
  }

  const styles = new Map<string, StyleConfig>();
  for (const fileName of styleFiles) {
    const file = path.join(stylesDir, fileName);
    const style = readYaml(file, styleConfigSchema, errors);
    if (!style) {
      continue;
    }

    const expectedId = path.basename(fileName, '.yaml');
    if (style.id !== expectedId) {
      errors.push(`${file}: id: "${style.id}" должен совпадать с именем файла "${expectedId}"`);
    }
    if (styles.has(style.id)) {
      errors.push(`${file}: id: стиль "${style.id}" уже определён в другом файле`);
    }
    if (formats) {
      for (const format of style.allowed_formats) {
        if (!(format in formats.formats)) {
          errors.push(`${file}: allowed_formats: неизвестный формат "${format}"`);
        }
      }
    }
    if (style.fact_policy === 'experience_only' && style.inputs.illustrative_allowed === true) {
      errors.push(
        `${file}: inputs.illustrative_allowed: должен быть false при fact_policy experience_only`,
      );
    }
    styles.set(style.id, style);
  }

  if (!formats || !checks || errors.length > 0) {
    throw new ConfigError(
      ['Ошибки конфигурации:', ...errors.map((line) => `  - ${line}`)].join('\n'),
    );
  }
  return { configDir, formats, styles, checks };
}

function readYaml<T>(file: string, schema: z.ZodType<T>, errors: string[]): T | undefined {
  if (!existsSync(file)) {
    errors.push(`${file}: файл не найден`);
    return undefined;
  }

  let raw: unknown;
  try {
    raw = parse(readFileSync(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    errors.push(`${file}: ошибка разбора YAML: ${reason}`);
    return undefined;
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    for (const line of describeIssues(result.error.issues)) {
      errors.push(`${file}: ${line}`);
    }
    return undefined;
  }
  return result.data;
}
