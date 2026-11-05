import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../lib/types';
import { admin, instructor, student } from './fixtures';

const { auth } = vi.hoisted(() => ({
  auth: {
    status: 'anonymous' as 'anonymous' | 'loading' | 'authenticated',
    user: null as User | null,
    error: null as Error | null,
    retry: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth }));
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', undefined);
  auth.status = 'anonymous';
  auth.user = null;
  auth.error = null;
  auth.retry.mockClear();
  auth.logout.mockClear();
});

async function mountNavbar(path = '/', loggingOut = false) {
  const { Navbar } = await import('../components/navigation/Navbar');
  const onLogout = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Navbar loggingOut={loggingOut} onLogout={onLogout} />
      <button>Outside the navbar</button>
    </MemoryRouter>,
  );
  return { ...view, onLogout };
}

describe('shared floating navbar', () => {
  it.each(['/', '/courses?search=Data&category=Engineering'])(
    'provides the same complete public navigation and real auth destinations at %s',
    async (path) => {
      await mountNavbar(path);
      const nav = within(
        screen.getByRole('navigation', {
          name: 'Main navigation',
          hidden: true,
        }),
      );
      expect(
        nav
          .getAllByRole('link', { hidden: true })
          .map((link) => link.textContent?.trim()),
      ).toEqual([
        'Home',
        'Explore Courses',
        'How It Works',
        'For Instructors',
        'About',
      ]);
      expect(
        screen.getByRole('link', { name: 'EduFlow home', hidden: true }),
      ).toHaveAttribute('href', '/');
      expect(screen.getByRole('banner')).toHaveClass('floating-navbar');
      expect(
        screen.getByRole('link', { name: 'Sign in', hidden: true }),
      ).toHaveAttribute('href', '/login');
      expect(
        screen.getByRole('link', { name: /Get Started/, hidden: true }),
      ).toHaveAttribute('href', '/register');
      if (path.startsWith('/courses')) {
        for (const label of ['How It Works', 'For Instructors', 'About']) {
          const url = new URL(
            nav
              .getByRole('link', { name: label, hidden: true })
              .getAttribute('href')!,
            'http://localhost',
          );
          expect(url.searchParams.get('search')).toBe('Data');
          expect(url.searchParams.get('category')).toBe('Engineering');
        }
      }
    },
  );

  it.each([
    [
      student,
      '/learning',
      ['/learning', '/learn/00000000-0000-4000-8000-000000000010'],
    ],
    [
      instructor,
      '/instructor',
      [
        '/instructor',
        '/instructor/courses',
        '/instructor/courses/new',
        '/instructor/courses/00000000-0000-4000-8000-000000000010/edit',
        '/instructor/courses/00000000-0000-4000-8000-000000000010/curriculum',
        '/instructor/courses/00000000-0000-4000-8000-000000000010/students',
      ],
    ],
    [
      admin,
      '/admin',
      [
        '/admin',
        '/admin/courses',
        '/admin/courses/00000000-0000-4000-8000-000000000010',
      ],
    ],
  ] as const)(
    'keeps the %s workspace destination and delegates sign-out to the existing guarded handler',
    async (user, destination, routes) => {
      auth.user = user;
      auth.status = 'authenticated';
      for (const route of routes) {
        const view = await mountNavbar(route);
        await userEvent.click(screen.getByLabelText('Account menu'));
        expect(
          screen.getByRole('link', { name: 'Go to my workspace' }),
        ).toHaveAttribute('href', destination);
        await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
        expect(view.onLogout).toHaveBeenCalledOnce();
        expect(auth.logout).not.toHaveBeenCalled();
        view.unmount();
      }
    },
  );

  it('shows loading and logout progress without exposing a premature sign-in action', async () => {
    auth.status = 'loading';
    const first = await mountNavbar();
    expect(screen.getByText(/Checking session/)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Sign in', hidden: true }),
    ).not.toBeInTheDocument();
    first.unmount();
    auth.status = 'anonymous';
    await mountNavbar('/', true);
    expect(screen.getByRole('status')).toHaveTextContent('Signing out');
    expect(
      screen.queryByRole('link', { name: 'Sign in', hidden: true }),
    ).not.toBeInTheDocument();
  });

  it('retains a working session retry action', async () => {
    auth.error = new Error('Network unavailable');
    await mountNavbar();
    await userEvent.click(
      screen.getByRole('button', { name: 'Retry session', hidden: true }),
    );
    expect(auth.retry).toHaveBeenCalledOnce();
    await userEvent.click(
      screen.getByRole('button', { name: 'Open navigation', hidden: true }),
    );
    const mobile = within(
      screen.getByRole('navigation', {
        name: 'Mobile navigation',
        hidden: true,
      }),
    );
    await userEvent.click(
      mobile.getByRole('button', { name: 'Retry session', hidden: true }),
    );
    expect(auth.retry).toHaveBeenCalledTimes(2);
  });

  it('opens the mobile navigation and restores trigger focus on Escape', async () => {
    await mountNavbar();
    const trigger = screen.getByRole('button', {
      name: 'Open navigation',
      hidden: true,
    });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const mobile = within(
      screen.getByRole('navigation', {
        name: 'Mobile navigation',
        hidden: true,
      }),
    );
    expect(
      mobile.getByRole('link', { name: 'Sign in', hidden: true }),
    ).toHaveAttribute('href', '/login');
    expect(
      mobile.getByRole('link', { name: 'Get Started', hidden: true }),
    ).toHaveAttribute('href', '/register');
    mobile.getByRole('link', { name: 'Home', hidden: true }).focus();
    await userEvent.keyboard('{Escape}');
    expect(
      screen.queryByRole('navigation', {
        name: 'Mobile navigation',
        hidden: true,
      }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes mobile navigation after an outside pointer action without stealing focus', async () => {
    await mountNavbar();
    await userEvent.click(
      screen.getByRole('button', { name: 'Open navigation', hidden: true }),
    );
    const outside = screen.getByRole('button', { name: 'Outside the navbar' });
    await userEvent.click(outside);
    expect(
      screen.queryByRole('navigation', {
        name: 'Mobile navigation',
        hidden: true,
      }),
    ).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
  });

  it('closes the account menu on Escape or outside pointer input with the expected focus behavior', async () => {
    auth.user = student;
    auth.status = 'authenticated';
    await mountNavbar('/learning');
    const trigger = screen.getByLabelText('Account menu');
    await userEvent.click(trigger);
    screen.getByRole('link', { name: 'Go to my workspace' }).focus();
    await userEvent.keyboard('{Escape}');
    expect(trigger.closest('details')).not.toHaveAttribute('open');
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    const outside = screen.getByRole('button', { name: 'Outside the navbar' });
    await userEvent.click(outside);
    expect(trigger.closest('details')).not.toHaveAttribute('open');
    expect(outside).toHaveFocus();
    expect(auth.logout).not.toHaveBeenCalled();
  });
});
