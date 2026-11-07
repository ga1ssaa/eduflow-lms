import { act, render, screen, within } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, useLocation } from 'react-router-dom';
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

async function mountNavbar(
  path = '/',
  loggingOut = false,
  content?: ReactNode,
  strict = false,
) {
  const { Navbar } = await import('../components/navigation/Navbar');
  const onLogout = vi.fn();
  const tree = (
    <MemoryRouter initialEntries={[path]}>
      <Navbar loggingOut={loggingOut} onLogout={onLogout} />
      {content}
      <button>Outside the navbar</button>
    </MemoryRouter>
  );
  const view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
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

function DiscoverySections({ catalog }: { catalog: boolean }) {
  const location = useLocation();
  return (
    <>
      <main>
        <section className={catalog ? 'catalog-hero' : 'landing-hero'}>
          <div data-hero-carrier />
        </section>
        <section className={catalog ? 'catalog-listing' : 'landing-featured'} />
        {['how-it-works', 'for-instructors', 'about'].map((id) => (
          <section key={id} id={id} style={{ scrollMarginTop: 120 }} />
        ))}
      </main>
      <output data-testid="router-location">
        {location.key}|{location.pathname}
        {location.search}
        {location.hash}
      </output>
      <Link to="/login">Leave discovery</Link>
    </>
  );
}

function scrollGeometry(indicators = false) {
  vi.stubGlobal('scrollY', 0);
  vi.stubGlobal('innerHeight', 800);
  const positions: Record<string, number> = {
    'how-it-works': 1200,
    'for-instructors': 1800,
    about: 2400,
  };
  let capsuleBottom = 100;
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
    4000,
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (indicators) {
        const mobile = this.closest('.mobile-nav');
        if (this.matches('nav.desktop-nav, nav.mobile-nav'))
          return new DOMRect(100, 100, 600, 300);
        if (this.matches('nav > a')) {
          const index = [...this.parentElement!.querySelectorAll('a')].indexOf(
            this as HTMLAnchorElement,
          );
          return new DOMRect(
            mobile ? 116 : 100 + index * 120,
            mobile ? 116 + index * 52 : 100,
            mobile ? 568 : 100 + index * 2,
            44,
          );
        }
      }
      if (this.classList.contains('header-inner'))
        return new DOMRect(0, 20, 1000, capsuleBottom - 20);
      if (this.tagName === 'HEADER') return new DOMRect(0, 20, 1000, 780);
      if (this.hasAttribute('data-hero-carrier'))
        return new DOMRect(5000, 5000, 1000, 600);
      if (this.id in positions)
        return new DOMRect(
          0,
          positions[this.id] - window.scrollY,
          1000,
          this.id === 'about' ? 300 : 600,
        );
      return new DOMRect(0, 0, 0, 0);
    },
  );
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => {
      frames.delete(id);
    }),
  );
  const observers: {
    notify: () => void;
    disconnect: ReturnType<typeof vi.fn>;
  }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(notify: () => void) {
        observers.push({ notify, disconnect: this.disconnect });
      }
    },
  );
  const flush = () =>
    act(() => {
      const queued = [...frames.values()];
      frames.clear();
      queued.forEach((callback) => callback(performance.now()));
    });
  const scroll = (y: number) => {
    vi.stubGlobal('scrollY', y);
    act(() => window.dispatchEvent(new Event('scroll')));
    flush();
  };
  const resize = () => {
    act(() => observers.forEach((observer) => observer.notify()));
    flush();
  };
  return {
    positions,
    frames,
    observers,
    flush,
    scroll,
    resize,
    setCapsuleBottom: (bottom: number) => {
      capsuleBottom = bottom;
    },
  };
}

function expectCurrent(label: string, navigation = 'Main navigation') {
  const nav = screen.getByRole('navigation', {
    name: navigation,
    hidden: true,
  });
  expect(
    within(nav).getByRole('link', { name: label, hidden: true }),
  ).toHaveClass('active');
  expect(nav.querySelectorAll('a.active')).toHaveLength(1);
  expect(nav.querySelectorAll('a[aria-current]')).toHaveLength(1);
}

describe('functional section highlighting', () => {
  it.each(['/', '/courses?search=Data&category=Design#about'])(
    'tracks real section geometry at %s without changing history or targets',
    async (path) => {
      const geometry = scrollGeometry();
      const catalog = path.startsWith('/courses');
      await mountNavbar(
        path,
        false,
        <DiscoverySections catalog={catalog} />,
        true,
      );
      geometry.flush();
      const location = screen.getByTestId('router-location').textContent;
      const base = catalog ? 'Explore Courses' : 'Home';
      expectCurrent(base);
      geometry.scroll(650);
      expectCurrent(base);
      for (const [y, label] of [
        [1100, 'How It Works'],
        [1700, 'For Instructors'],
        [2300, 'About'],
      ] as const) {
        geometry.scroll(y);
        expectCurrent(label);
        expect(screen.getByTestId('router-location')).toHaveTextContent(
          location!,
        );
        const link = within(
          screen.getByRole('navigation', {
            name: 'Main navigation',
            hidden: true,
          }),
        ).getByRole('link', { name: label, hidden: true });
        expect(link).toHaveAttribute('aria-current', 'location');
        const url = new URL(link.getAttribute('href')!, 'http://localhost');
        expect(url.pathname).toBe('/courses');
        expect(url.searchParams.get('search')).toBe(catalog ? 'Data' : null);
      }
      geometry.scroll(0);
      expectCurrent(base);
    },
  );

  it('selects a short visible About section at the footer, and responds to content resizing', async () => {
    const geometry = scrollGeometry();
    await mountNavbar('/', false, <DiscoverySections catalog={false} />, true);
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
      2800,
    );
    geometry.scroll(2000);
    expectCurrent('About');
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(
      4000,
    );
    geometry.resize();
    expectCurrent('For Instructors');
    geometry.positions['for-instructors'] = 2300;
    geometry.resize();
    expectCurrent('How It Works');
  });

  it('shares selection with mobile without using the expanded menu height or moving keyboard focus', async () => {
    const geometry = scrollGeometry();
    await mountNavbar('/', false, <DiscoverySections catalog={false} />, true);
    geometry.scroll(1100);
    await userEvent.click(
      screen.getByRole('button', { name: 'Open navigation', hidden: true }),
    );
    geometry.flush();
    expectCurrent('How It Works');
    expectCurrent('How It Works', 'Mobile navigation');
    geometry.scroll(1700);
    expectCurrent('For Instructors');
    expectCurrent('For Instructors', 'Mobile navigation');
    expect(
      screen.getByRole('button', { name: 'Close navigation', hidden: true }),
    ).toHaveFocus();
  });

  it('updates the activation line when the capsule resizes and ignores the animated Hero carrier', async () => {
    const geometry = scrollGeometry();
    await mountNavbar('/', false, <DiscoverySections catalog={false} />, true);
    geometry.flush();
    expectCurrent('Home');
    geometry.scroll(1600);
    expectCurrent('How It Works');
    geometry.setCapsuleBottom(240);
    geometry.resize();
    expectCurrent('For Instructors');
  });

  it('discards section selection on route changes and retains existing route highlighting', async () => {
    const geometry = scrollGeometry();
    await mountNavbar('/courses', false, <DiscoverySections catalog />, true);
    geometry.scroll(1700);
    expectCurrent('For Instructors');
    await userEvent.click(
      screen.getByRole('link', { name: 'Leave discovery' }),
    );
    geometry.flush();
    expect(screen.getByTestId('router-location')).toHaveTextContent('/login');
    const nav = screen.getByRole('navigation', {
      name: 'Main navigation',
      hidden: true,
    });
    expect(nav.querySelectorAll('a.active, a[aria-current]')).toHaveLength(0);
  });

  it('keeps route-based selection when role navigation hides marketing sections', async () => {
    const geometry = scrollGeometry();
    auth.user = student;
    auth.status = 'authenticated';
    await mountNavbar('/courses', false, <DiscoverySections catalog />, true);
    geometry.scroll(2300);
    expectCurrent('Explore Courses');
    expect(
      screen.queryByRole('link', { name: 'About', hidden: true }),
    ).not.toBeInTheDocument();
  });

  it.each(['/courses/existing-course', '/Courses/existing-course'])(
    'retains router-based Explore Courses selection at %s without spying on its content',
    async (path) => {
      const geometry = scrollGeometry();
      await mountNavbar(path, false, <DiscoverySections catalog />, true);
      geometry.scroll(2300);
      expectCurrent('Explore Courses');
    },
  );

  it('coalesces scroll work and cleans queued frames and resize observers on unmount', async () => {
    const geometry = scrollGeometry();
    const view = await mountNavbar(
      '/',
      false,
      <DiscoverySections catalog={false} />,
      true,
    );
    geometry.flush();
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
    });
    expect(geometry.frames.size).toBe(1);
    const stale = [...geometry.frames.values()][0];
    view.unmount();
    expect(geometry.frames.size).toBe(0);
    geometry.observers.forEach((observer) =>
      expect(observer.disconnect).toHaveBeenCalledOnce(),
    );
    act(() => {
      stale(performance.now());
      geometry.observers.forEach((observer) => observer.notify());
    });
    expect(geometry.frames.size).toBe(0);
  });
});

describe('sliding active navigation indicator', () => {
  it('retargets one decoration per container while preserving active semantics and focus', async () => {
    const geometry = scrollGeometry(true);
    await mountNavbar('/', false, <DiscoverySections catalog={false} />, true);
    geometry.flush();
    const nav = screen.getByRole('navigation', {
      name: 'Main navigation',
      hidden: true,
    });
    const indicator = nav.querySelector<HTMLElement>('.nav-active-indicator')!;
    expect(indicator).toHaveAttribute('aria-hidden', 'true');
    expect(indicator).not.toHaveAttribute('tabindex');
    expect(nav).toHaveAttribute('data-indicator-ready', 'true');
    expect(indicator.style.transform).toBe('translate3d(0px, 0px, 0)');
    expect(indicator.style.width).toBe('100px');
    geometry.scroll(1100);
    expect(indicator.style.transform).toBe('translate3d(240px, 0px, 0)');
    expect(indicator.style.width).toBe('104px');
    geometry.scroll(2300);
    geometry.scroll(1700);
    expect(indicator.style.transform).toBe('translate3d(360px, 0px, 0)');
    expect(nav.querySelectorAll('.nav-active-indicator')).toHaveLength(1);
    expectCurrent('For Instructors');
    await userEvent.click(
      screen.getByRole('button', { name: 'Open navigation', hidden: true }),
    );
    const mobile = screen.getByRole('navigation', {
      name: 'Mobile navigation',
    });
    const mobileIndicator = mobile.querySelector<HTMLElement>(
      '.nav-active-indicator',
    )!;
    expect(mobile.querySelectorAll('.nav-active-indicator')).toHaveLength(1);
    expect(mobileIndicator.style.transform).toBe('translate3d(16px, 172px, 0)');
    expect(mobileIndicator.style.width).toBe('568px');
    // A scrollable mobile menu measures in its content coordinates.
    mobile.scrollTop = 52;
    Object.defineProperty(mobile, 'clientTop', { value: 1 });
    Object.defineProperty(mobile, 'clientLeft', { value: 1 });
    geometry.resize();
    expect(mobileIndicator.style.transform).toBe('translate3d(15px, 223px, 0)');
    expect(
      screen.getByRole('button', { name: 'Close navigation', hidden: true }),
    ).toHaveFocus();
  });

  it('remeasures resized links and hidden navigation, and hides when no destination is active', async () => {
    const geometry = scrollGeometry(true);
    await mountNavbar('/courses', false, <DiscoverySections catalog />, true);
    geometry.flush();
    const nav = screen.getByRole('navigation', {
      name: 'Main navigation',
      hidden: true,
    });
    const active = within(nav).getByRole('link', {
      name: 'Explore Courses',
      hidden: true,
    });
    const rect = vi.fn<() => DOMRect>();
    Object.defineProperty(active, 'getBoundingClientRect', { value: rect });
    rect.mockReturnValue(new DOMRect(250, 102, 180, 48));
    geometry.resize();
    const indicator = nav.querySelector<HTMLElement>('.nav-active-indicator')!;
    expect(indicator.style.width).toBe('180px');
    expect(indicator.style.height).toBe('48px');
    expect(indicator.style.transform).toBe('translate3d(150px, 2px, 0)');
    rect.mockReturnValue(new DOMRect());
    geometry.resize();
    expect(nav).not.toHaveAttribute('data-indicator-ready');
    rect.mockReturnValue(new DOMRect(250, 102, 180, 48));
    geometry.resize();
    expect(nav).toHaveAttribute('data-indicator-ready');
    await userEvent.click(
      screen.getByRole('link', { name: 'Leave discovery' }),
    );
    geometry.flush();
    expect(nav).not.toHaveAttribute('data-indicator-ready');
  });
});
