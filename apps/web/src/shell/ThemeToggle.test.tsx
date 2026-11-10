import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from './ThemeToggle';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
});

describe('переключатель темы', () => {
  it('переключает тёмную тему и сохраняет выбор', async () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Включить тёмную тему' }));

    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('dzenwriter:theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Включить светлую тему' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Включить светлую тему' }));

    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('dzenwriter:theme')).toBe('light');
  });

  it('восстанавливает сохранённую тему', async () => {
    window.localStorage.setItem('dzenwriter:theme', 'dark');
    render(<ThemeToggle />);

    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Включить светлую тему' })).toBeTruthy();
  });
});
