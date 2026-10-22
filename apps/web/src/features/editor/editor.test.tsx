import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaimsEditor, type ClaimDraft } from './ClaimsEditor';
import { CommandPalette } from './CommandPalette';

afterEach(() => {
  cleanup();
});

describe('палитра команд', () => {
  it('показывает команды и закрывается по Escape', () => {
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={[
          { id: 'save', title: 'Сохранить версию', hint: 'Ctrl+S', run: vi.fn() },
          { id: 'generate', title: 'Сгенерировать заново', run: vi.fn() },
        ]}
      />,
    );

    expect(screen.getByText('Сохранить версию')).toBeTruthy();
    expect(screen.getByText('Сгенерировать заново')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('фильтрует по запросу и выполняет выбранную команду', () => {
    const run = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette
        open
        onClose={onClose}
        commands={[
          { id: 'save', title: 'Сохранить версию', run: vi.fn() },
          { id: 'history', title: 'История версий', run },
        ]}
      />,
    );

    fireEvent.change(screen.getByLabelText('Поиск команды'), { target: { value: 'истор' } });
    expect(screen.queryByText('Сохранить версию')).toBeNull();

    fireEvent.click(screen.getByText('История версий'));
    expect(run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('закрытая палитра ничего не показывает', () => {
    render(<CommandPalette open={false} onClose={vi.fn()} commands={[]} />);

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('редактор утверждений', () => {
  const facts = [
    { label: 'F1', text: 'Пакет правил принят.', status: 'approved' },
    { label: 'F2', text: 'Сроки известны.', status: 'approved' },
  ];

  it('привязывает утверждение к факту', () => {
    const claims: ClaimDraft[] = [{ text: 'Пакет правил принят.', type: 'fact', factIds: [] }];
    const onChange = vi.fn();
    render(<ClaimsEditor claims={claims} facts={facts} onChange={onChange} />);

    // По одному флажку на факт: берём первый.
    fireEvent.click(screen.getAllByRole('checkbox')[0] as HTMLInputElement);

    expect(onChange).toHaveBeenCalledWith([
      { text: 'Пакет правил принят.', type: 'fact', factIds: ['F1'] },
    ]);
  });

  it('снимает привязку, если факт уже выбран', () => {
    const claims: ClaimDraft[] = [{ text: 'Пакет правил принят.', type: 'fact', factIds: ['F1'] }];
    const onChange = vi.fn();
    render(<ClaimsEditor claims={claims} facts={facts} onChange={onChange} />);

    fireEvent.click(screen.getAllByRole('checkbox')[0] as HTMLInputElement);

    expect(onChange).toHaveBeenCalledWith([
      { text: 'Пакет правил принят.', type: 'fact', factIds: [] },
    ]);
  });

  it('без утверждений ничего не показывает', () => {
    const { container } = render(<ClaimsEditor claims={[]} facts={facts} onChange={vi.fn()} />);

    expect(container.textContent).toBe('');
  });
});
