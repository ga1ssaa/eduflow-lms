import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('theme preference', () => {
  it('restores and persists only the display preference', async () => {
    window.localStorage.setItem('eduflow-theme', 'dark');
    const { ThemeControl } = await import('../theme/ThemeControl');
    render(<ThemeControl />);
    expect(screen.getByRole('combobox', { name: 'Color theme' })).toHaveValue(
      'dark',
    );
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Color theme' }),
      'light',
    );
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('eduflow-theme')).toBe('light');
    expect(window.localStorage.length).toBe(1);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('follows operating system changes when System is selected', async () => {
    let listener: (() => void) | undefined;
    const media = {
      matches: false,
      addEventListener: vi.fn((_event: string, callback: () => void) => {
        listener = callback;
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => media),
    );
    const { ThemeControl } = await import('../theme/ThemeControl');
    const view = render(<ThemeControl />);
    expect(screen.getByRole('combobox', { name: 'Color theme' })).toHaveValue(
      'system',
    );
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    act(() => {
      media.matches = true;
      listener?.();
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
  });
});
