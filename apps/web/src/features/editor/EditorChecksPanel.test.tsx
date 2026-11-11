import type { VersionCheck } from '@dzenwriter/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorChecksPanel } from './EditorChecksPanel';

const BLOCKING: VersionCheck = {
  id: 'numbers_must_map_to_facts',
  severity: 'block',
  message: 'Число 42 не найдено в фактах',
  start: 10,
  end: 12,
  excerpt: '42',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('панель проверок редактора', () => {
  it('показывает «Подтвердить» и отправляет комментарий', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<EditorChecksPanel checks={[BLOCKING]} onFocus={vi.fn()} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    const comment = screen.getByLabelText('Почему проверку можно снять');
    fireEvent.change(comment, { target: { value: 'Коротко' } });
    const send = screen.getByRole('button', { name: 'Отправить' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.change(comment, {
      target: { value: 'Число 42 — это номер пункта правил' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(0, 'Число 42 — это номер пункта правил'),
    );
    await waitFor(() => expect(screen.queryByLabelText('Почему проверку можно снять')).toBeNull());
  });

  it('не предлагает подтвердить уже подтверждённую проверку', () => {
    render(
      <EditorChecksPanel
        checks={[{ ...BLOCKING, decision: 'confirmed', comment: 'Проверено' }]}
        onFocus={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Подтвердить' })).toBeNull();
    expect(screen.getByText(/подтверждено/)).toBeTruthy();
  });

  it('без onConfirm кнопка не показывается', () => {
    render(<EditorChecksPanel checks={[BLOCKING]} onFocus={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Подтвердить' })).toBeNull();
  });
});
