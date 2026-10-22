import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAppConfig, resolveConfigDir } from '../src/config/app-config';
import { ConfigError } from '../src/config/errors';

describe('загрузка конфигурации стилей и форматов', () => {
  it('находит config/ репозитория и загружает все стили и форматы', () => {
    const config = loadAppConfig(resolveConfigDir());

    expect([...config.styles.keys()].sort()).toEqual([
      'company-achievements',
      'industry-news',
      'personal-experience',
      'product-description',
    ]);
    expect(Object.keys(config.formats.formats).sort()).toEqual([
      'article',
      'case',
      'longread',
      'news',
      'roundup',
    ]);
  });

  it('называет файл и поле для каждой ошибки', () => {
    const dir = path.resolve(__dirname, 'fixtures/invalid');

    let caught: unknown;
    try {
      loadAppConfig(dir);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    const message = (caught as ConfigError).message;
    expect(message).toContain('bad-style.yaml');
    expect(message).toContain('allowed_formats.0');
    expect(message).toContain('checks.made_up_check');
    expect(message).toContain('id-mismatch.yaml');
    expect(message).toContain('illustrative_allowed');
  });
});
