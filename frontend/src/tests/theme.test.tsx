import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  delete document.documentElement.dataset.themeEntrance;
});
afterEach(async () => {
  const { disposeThemeTransition } =
    await import('../theme/theme-transition-controller');
  disposeThemeTransition();
  delete document.documentElement.dataset.themeEntrance;
  delete document.documentElement.dataset.themeTransition;
  document.documentElement.style.removeProperty('color-scheme');
});

async function renderTheme(extra?: ReactNode) {
  const { ThemeControl } = await import('../theme/ThemeControl');
  return render(
    <>
      <ThemeControl />
      {extra}
    </>,
  );
}

describe('theme preference and icon menu', () => {
  it.each([false, true])(
    'closes the portal menu and preserves trigger-relative Tab order (reverse=%s)',
    async (reverse) => {
      const { ThemeControl } = await import('../theme/ThemeControl');
      render(
        <>
          <button>Before theme</button>
          <ThemeControl />
          <button>After theme</button>
        </>,
      );
      const trigger = screen.getByRole('button', { name: 'Color theme' });
      trigger.focus();
      await userEvent.keyboard('{ArrowDown}');
      expect(screen.getByRole('menu')).toBeInTheDocument();
      await userEvent.tab({ shift: reverse });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: reverse ? 'Before theme' : 'After theme',
        }),
      ).toHaveFocus();
    },
  );

  it('restores the saved preference, persists only the display setting and restores trigger focus on selection', async () => {
    localStorage.setItem('eduflow-theme', 'dark');
    await renderTheme();
    const trigger = screen.getByRole('button', { name: 'Color theme' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await userEvent.click(trigger);
    expect(
      screen.getByRole('menu', { name: 'Color theme' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('eduflow-theme')).toBe('light');
    expect(localStorage.length).toBe(1);
    expect(sessionStorage.length).toBe(0);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens with the selected radio focused and exposes the three real preferences', async () => {
    await renderTheme();
    await userEvent.click(screen.getByRole('button', { name: 'Color theme' }));
    expect(
      screen.getAllByRole('menuitemradio').map((item) => item.textContent),
    ).toEqual(['Light', 'Dark', 'System']);
    expect(
      screen.getByRole('menuitemradio', { name: 'System' }),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveFocus();
  });

  it('supports arrow wrapping, Home, End, Enter and Escape without native select popup behavior', async () => {
    await renderTheme();
    const trigger = screen.getByRole('button', { name: 'Color theme' });
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{Home}{ArrowDown}{Enter}');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(trigger).toHaveFocus();
  });

  it('supports Space activation and preserves focus on the outside pointer target', async () => {
    localStorage.setItem('eduflow-theme', 'light');
    await renderTheme(<button>Another control</button>);
    const trigger = screen.getByRole('button', { name: 'Color theme' });
    trigger.focus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown} ');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    const outside = screen.getByRole('button', { name: 'Another control' });
    await userEvent.click(outside);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
  });

  it('follows operating-system changes only while System is selected', async () => {
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
    const view = await renderTheme();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    act(() => {
      media.matches = true;
      listener?.();
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await userEvent.click(screen.getByRole('button', { name: 'Color theme' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    act(() => {
      listener?.();
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await userEvent.click(screen.getByRole('button', { name: 'Color theme' }));
    await userEvent.click(
      screen.getByRole('menuitemradio', { name: 'System' }),
    );
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    view.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
  });

  it('keeps theme changes usable when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    await renderTheme();
    await userEvent.click(screen.getByRole('button', { name: 'Color theme' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });
});
