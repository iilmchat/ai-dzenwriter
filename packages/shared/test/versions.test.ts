import { describe, expect, it } from 'vitest';
import { diffParagraphs } from '../src/versions';

describe('сравнение версий по абзацам', () => {
  it('одинаковые тексты дают только совпавшие абзацы', () => {
    const text = 'Первый абзац.\n\nВторой абзац.\n\nТретий абзац.';

    const pairs = diffParagraphs(text, text);

    expect(pairs.map((pair) => pair.kind)).toEqual(['same', 'same', 'same']);
  });

  it('добавленный абзац виден отдельно', () => {
    const before = 'Первый абзац.\n\nВторой абзац.';
    const after = 'Первый абзац.\n\nНовый абзац.\n\nВторой абзац.';

    const pairs = diffParagraphs(before, after);

    expect(pairs.map((pair) => pair.kind)).toEqual(['same', 'added', 'same']);
    expect(pairs[1]?.right).toBe('Новый абзац.');
    expect(pairs[1]?.left).toBeNull();
  });

  it('удалённый абзац виден отдельно', () => {
    const before = 'Первый абзац.\n\nЛишний абзац.\n\nВторой абзац.';
    const after = 'Первый абзац.\n\nВторой абзац.';

    const pairs = diffParagraphs(before, after);

    expect(pairs.map((pair) => pair.kind)).toEqual(['same', 'removed', 'same']);
    expect(pairs[1]?.left).toBe('Лишний абзац.');
  });

  it('изменённый абзац показан как изменённый', () => {
    const before = 'Первый абзац.\n\nВторой абзац.';
    const after = 'Первый абзац.\n\nВторой абзац с правкой.';

    const pairs = diffParagraphs(before, after);

    expect(pairs.map((pair) => pair.kind)).toEqual(['same', 'changed']);
    expect(pairs[1]?.left).toBe('Второй абзац.');
    expect(pairs[1]?.right).toBe('Второй абзац с правкой.');
  });

  it('заголовки считаются абзацами', () => {
    const before = '## Заголовок\n\nТекст.';
    const after = '## Заголовок\n\nДругой текст.';

    const pairs = diffParagraphs(before, after);

    expect(pairs.map((pair) => pair.kind)).toEqual(['same', 'changed']);
  });

  it('пустой текст не ломает сравнение', () => {
    expect(diffParagraphs('', 'Один абзац.')).toEqual([
      { kind: 'added', left: null, right: 'Один абзац.' },
    ]);
    expect(diffParagraphs('Один абзац.', '')).toEqual([
      { kind: 'removed', left: 'Один абзац.', right: null },
    ]);
    expect(diffParagraphs('', '')).toEqual([]);
  });
});
