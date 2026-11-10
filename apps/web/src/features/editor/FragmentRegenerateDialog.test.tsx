import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { regenerateFragment } from '../../api/articles';
import { FragmentRegenerateDialog } from './FragmentRegenerateDialog';

vi.mock('../../api/articles', () => ({
  regenerateFragment: vi.fn(),
}));

const mockedRegenerate = vi.mocked(regenerateFragment);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDialog(onApply = vi.fn(), onClose = vi.fn()) {
  render(
    <FragmentRegenerateDialog
      articleId="article-1"
      selectedText="Старый фрагмент."
      contextBefore="До фрагмента."
      contextAfter="После фрагмента."
      onApply={onApply}
      onClose={onClose}
    />,
  );
  return { onApply, onClose };
}

describe('диалог перегенерации фрагмента', () => {
  it('показывает пресеты и «Было»', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: 'Перегенерация фрагмента' })).toBeTruthy();
    expect(screen.getByText('Улучшить')).toBeTruthy();
    expect(screen.getByText('Сократить')).toBeTruthy();
    expect(screen.getByText('Добавить деталей')).toBeTruthy();
    expect(screen.getByText('Сменить тон (экспертный/дружелюбный)')).toBeTruthy();
    expect(screen.getByLabelText('Было').textContent).toContain('Старый фрагмент.');
  });

  it('выбор пресета подставляет инструкцию, свой текст её заменяет', () => {
    renderDialog();

    fireEvent.click(screen.getByText('Сократить'));
    const field = screen.getByLabelText('Свой вариант') as HTMLTextAreaElement;
    expect(field.value).toContain('Сократить фрагмент');

    fireEvent.change(field, { target: { value: 'Сделать дружелюбнее' } });
    expect(field.value).toBe('Сделать дружелюбнее');
  });

  it('генерирует по своей инструкции и применяет предпросмотр', async () => {
    mockedRegenerate.mockResolvedValue({ text: 'Новый фрагмент.' });
    const { onApply } = renderDialog();

    fireEvent.change(screen.getByLabelText('Свой вариант'), {
      target: { value: 'Добавить пример' },
    });
    fireEvent.click(screen.getByText('Сгенерировать'));

    await waitFor(() =>
      expect(screen.getByLabelText('Стало').textContent).toContain('Новый фрагмент.'),
    );
    expect(mockedRegenerate).toHaveBeenCalledWith('article-1', {
      selectedText: 'Старый фрагмент.',
      contextBefore: 'До фрагмента.',
      contextAfter: 'После фрагмента.',
      instruction: 'Добавить пример',
    });

    fireEvent.click(screen.getByText('Применить'));

    expect(onApply).toHaveBeenCalledWith('Новый фрагмент.');
  });

  it('показывает ошибку API и не даёт применить пустой результат', async () => {
    mockedRegenerate.mockRejectedValue(new Error('Лимит генераций исчерпан'));
    renderDialog();

    fireEvent.click(screen.getByText('Улучшить'));
    fireEvent.click(screen.getByText('Сгенерировать'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Лимит'));
    expect((screen.getByText('Применить') as HTMLButtonElement).disabled).toBe(true);
  });
});
