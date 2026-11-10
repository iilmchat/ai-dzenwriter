import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { useGlobalHotkeys } from './useGlobalHotkeys';

function Page({ label }: { readonly label: string }) {
  const [help, setHelp] = useState(false);
  useGlobalHotkeys({ onHelp: () => setHelp(true) });
  return (
    <div>
      <p>{label}</p>
      <input aria-label="Поле" />
      {help ? <p>Справка открыта</p> : null}
    </div>
  );
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/calendar" element={<Page label="Календарь" />} />
        <Route path="/" element={<Page label="Доска" />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('глобальные горячие клавиши', () => {
  it('Alt+B переводит на доску', async () => {
    renderAt('/calendar');

    fireEvent.keyDown(window, { key: 'b', altKey: true });

    expect(await screen.findByText('Доска')).toBeTruthy();
  });

  it('«?» открывает справку', async () => {
    renderAt('/calendar');

    fireEvent.keyDown(window, { key: '?' });

    expect(await screen.findByText('Справка открыта')).toBeTruthy();
  });

  it('не перехватывает клавиши в поле ввода', async () => {
    renderAt('/calendar');

    fireEvent.keyDown(screen.getByLabelText('Поле'), { key: 'b', altKey: true });

    await waitFor(() => expect(screen.getByText('Календарь')).toBeTruthy());
    expect(screen.queryByText('Доска')).toBeNull();
  });
});
