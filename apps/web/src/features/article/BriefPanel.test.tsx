import { articleDetailSchema, type ArticleDetail } from '@dzenwriter/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BriefPanel } from './BriefPanel';

const api = vi.hoisted(() => ({
  generateBrief: vi.fn(),
  updateArticle: vi.fn(),
  fetchArticle: vi.fn(),
}));

vi.mock('../../api/articles', () => api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeArticle(brief: string | null = null): ArticleDetail {
  return articleDetailSchema.parse({
    id: '11111111-1111-4111-8111-111111111111',
    topic: 'Регулирование ИИ в ЕС',
    keywords: ['ИИ'],
    title: null,
    brief,
    styleId: 'industry-news',
    styleName: 'Новости индустрии',
    format: 'news',
    tone: 'neutral',
    lengthMin: 4000,
    lengthMax: 6000,
    productId: null,
    status: 'drafting',
    owner: { id: '22222222-2222-4222-8222-222222222222', login: 'anna', name: null },
    reviewer: null,
    plannedAt: null,
    currentVersionNumber: null,
    blockingChecks: 0,
    version: 3,
    createdAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z',
    requirements: [],
    transitions: [],
    versions: [],
    reviews: [],
    publications: [],
    facts: [],
    checks: [],
    generation: { allowed: true, reason: null, outOfFocus: false, confirmed: false },
  });
}

describe('панель брифа', () => {
  it('показывает бриф и количество символов', () => {
    render(<BriefPanel article={makeArticle('## План')} canEdit onChanged={vi.fn()} />);

    expect(screen.getByLabelText('Текст брифа')).toHaveProperty('value', '## План');
    expect(screen.getByText('Символов: 7')).toBeTruthy();
  });

  it('сохраняет ручную правку через PATCH материала', async () => {
    const onChanged = vi.fn();
    const updated = makeArticle('## Новый план');
    api.updateArticle.mockResolvedValue(updated);
    render(<BriefPanel article={makeArticle()} canEdit onChanged={onChanged} />);

    fireEvent.change(screen.getByLabelText('Текст брифа'), {
      target: { value: '## Новый план' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => {
      expect(api.updateArticle).toHaveBeenCalledWith(updated.id, {
        expectedVersion: 3,
        brief: '## Новый план',
      });
    });
    expect(onChanged).toHaveBeenCalledWith(updated);
  });

  it('генерирует бриф и обновляет материал', async () => {
    const onChanged = vi.fn();
    const generated = makeArticle('## Бриф от модели');
    api.generateBrief.mockResolvedValue({ brief: '## Бриф от модели' });
    api.fetchArticle.mockResolvedValue(generated);
    render(<BriefPanel article={makeArticle()} canEdit onChanged={onChanged} />);

    fireEvent.click(screen.getByRole('button', { name: 'Сгенерировать бриф' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Текст брифа')).toHaveProperty('value', '## Бриф от модели');
    });
    expect(api.generateBrief).toHaveBeenCalledWith(generated.id);
    expect(onChanged).toHaveBeenCalledWith(generated);
  });

  it('без права правки показывает бриф только для чтения', () => {
    render(<BriefPanel article={makeArticle('## План')} canEdit={false} onChanged={vi.fn()} />);

    expect(screen.getByLabelText('Текст брифа')).toHaveProperty('readOnly', true);
    expect(screen.queryByRole('button', { name: 'Сгенерировать бриф' })).toBeNull();
  });
});
