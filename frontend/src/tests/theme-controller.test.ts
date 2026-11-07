import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Controller = typeof import('../theme/theme-transition-controller');
let controller: Controller | undefined;
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
function media(initial: boolean) {
  const callbacks = new Set<() => void>();
  return {
    matches: initial,
    addEventListener: vi.fn((_event: string, callback: () => void) =>
      callbacks.add(callback),
    ),
    removeEventListener: vi.fn((_event: string, callback: () => void) =>
      callbacks.delete(callback),
    ),
    change(value: boolean) {
      this.matches = value;
      callbacks.forEach((callback) => callback());
    },
  };
}
let scheme: ReturnType<typeof media>, reduced: ReturnType<typeof media>;
async function initialize(preference = 'light', dark = false, motion = false) {
  localStorage.setItem('eduflow-theme', preference);
  scheme.matches = dark;
  reduced.matches = motion;
  controller = await import('../theme/theme-transition-controller');
  controller.initializeThemeTransition();
  return controller;
}
function hero(theme: Controller) {
  const element = document.createElement('section');
  document.body.append(element);
  const rect = vi
    .spyOn(element, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(0, 100, 600, 300));
  const render = vi.fn((_progress: number) => undefined),
    prepare = vi.fn(() => true),
    cleanup = vi.fn();
  const start = vi.fn(
    (
      scene: Parameters<
        Parameters<Controller['registerThemeHero']>[0]['start']
      >[0],
    ) => ({
      render,
      handoffAt: scene.direction === 'sunrise' ? 0.18 : 0.78,
      prepareHandoff: prepare,
      cleanup,
    }),
  );
  const unregister = theme.registerThemeHero({ element, start });
  return { element, rect, start, render, prepare, cleanup, unregister };
}
function frame(timestamp = performance.now()) {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(timestamp));
}
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  frame();
  await vi.advanceTimersByTimeAsync(0);
}
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({
    toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'],
  });
  frames = new Map();
  nextFrame = 0;
  scheme = media(false);
  reduced = media(false);
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) =>
      query.includes('reduced-motion') ? reduced : scheme,
    ),
  );
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
    vi.fn((id: number) => frames.delete(id)),
  );
  delete document.documentElement.dataset.themeTransition;
});
afterEach(() => {
  controller?.disposeThemeTransition();
  controller = undefined;
  document.querySelectorAll('section').forEach((element) => element.remove());
  delete document.documentElement.dataset.themeTransition;
  document.documentElement.style.removeProperty('color-scheme');
  vi.useRealTimers();
});

describe('one-progress cinematic theme controller', () => {
  it.each(
    ['landing-hero', 'catalog-hero'].flatMap((sectionClass) =>
      ['light', 'dark'].flatMap((destination) =>
        [50, 150].flatMap((initialScroll) =>
          [100, 1000].map(
            (elapsed) =>
              [sectionClass, destination, initialScroll, elapsed] as const,
          ),
        ),
      ),
    ),
  )(
    '%s to %s from %spx: 2px stays active, crossing the section at %sms cleans up',
    async (sectionClass, destination, initialScroll, elapsed) => {
      const theme = await initialize(
        destination === 'light' ? 'dark' : 'light',
      );
      vi.stubGlobal('scrollY', initialScroll);
      const section = document.createElement('section');
      section.className = sectionClass;
      const element = document.createElement('div');
      const next = document.createElement('section');
      section.append(element);
      document.body.append(section, next);
      vi.spyOn(section, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(0, -window.scrollY, 600, 900),
      );
      vi.spyOn(next, 'getBoundingClientRect').mockImplementation(
        () => new DOMRect(0, 900 - window.scrollY, 600, 400),
      );
      const rect = vi
        .spyOn(element, 'getBoundingClientRect')
        .mockReturnValue(new DOMRect(0, 100 - initialScroll, 600, 600));
      const cleanup = vi.fn();
      theme.registerThemeHero({
        element,
        start: () => ({
          render: vi.fn(),
          cleanup,
          handoffAt: 0.5,
          prepareHandoff: () => true,
        }),
      });
      theme.setThemePreference(destination as 'light' | 'dark');
      const id = theme.getThemeSnapshot().scene!.id;
      const stale = [...frames.values()][0];
      await advance(elapsed);
      // The travelling composition can be offscreen while its section is current.
      rect.mockReturnValue(new DOMRect(2000, 2000, 600, 600));
      vi.stubGlobal('scrollY', initialScroll + 2);
      window.dispatchEvent(new Event('scroll'));
      await advance(50);
      expect(theme.getThemeSnapshot().scene?.id).toBe(id);
      expect(cleanup).not.toHaveBeenCalled();
      vi.stubGlobal('scrollY', 900);
      window.dispatchEvent(new Event('scroll'));
      expect(theme.getThemeSnapshot()).toMatchObject({
        effective: destination,
        applied: destination,
        scene: null,
      });
      expect(window.scrollY).toBe(900);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(frames.size).toBe(0);
      expect(document.documentElement).not.toHaveAttribute(
        'data-theme-transition',
      );
      stale(5000);
      window.dispatchEvent(new Event('scroll'));
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(document.documentElement.dataset.theme).toBe(destination);
    },
  );

  it.each(
    ['landing-hero', 'catalog-hero'].flatMap((sectionClass) =>
      ['light', 'dark'].flatMap((destination) =>
        [0, 80, 899, 900].map(
          (initialScroll) =>
            [sectionClass, destination, initialScroll] as const,
        ),
      ),
    ),
  )(
    '%s to %s at scroll %s uses the section boundary, not the composition box',
    async (sectionClass, destination, initialScroll) => {
      const theme = await initialize(
        destination === 'light' ? 'dark' : 'light',
      );
      vi.stubGlobal('scrollY', initialScroll);
      const section = document.createElement('section');
      section.className = sectionClass;
      const element = document.createElement('div');
      const next = document.createElement('section');
      section.append(element);
      document.body.append(section, next);
      vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, -initialScroll, 600, 900),
      );
      vi.spyOn(next, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 900 - initialScroll, 600, 400),
      );
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 100 - initialScroll, 600, 600),
      );
      const render = vi.fn(),
        cleanup = vi.fn();
      const start = vi.fn(() => ({
        render,
        cleanup,
        handoffAt: 0.5,
        prepareHandoff: () => true,
      }));
      theme.registerThemeHero({ element, start });
      theme.setThemePreference(destination as 'light' | 'dark');
      if (initialScroll === 900) {
        expect(start).not.toHaveBeenCalled();
        expect(theme.getThemeSnapshot().scene).toBeNull();
      } else {
        expect(start).toHaveBeenCalledTimes(1);
        window.dispatchEvent(new Event('scroll'));
        await advance(400);
        expect(theme.getThemeSnapshot().scene).not.toBeNull();
        expect(cleanup).not.toHaveBeenCalled();
        await advance(1200);
        expect(theme.getThemeSnapshot().scene).toBeNull();
        expect(cleanup).toHaveBeenCalledTimes(1);
      }
      expect(window.scrollY).toBe(initialScroll);
      expect(document.documentElement.dataset.theme).toBe(destination);
    },
  );

  it.each([
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ] as const)(
    'initial %s / OS dark=%s applies immediately without animation through subscription replay',
    async (preference, dark, expected) => {
      const theme = await initialize(preference, dark),
        registered = hero(theme);
      const first = theme.subscribeTheme(() => undefined);
      first();
      const second = theme.subscribeTheme(() => undefined);
      expect(theme.getThemeSnapshot()).toMatchObject({
        preference,
        effective: expected,
        applied: expected,
        scene: null,
      });
      expect(document.documentElement.dataset.theme).toBe(expected);
      expect(registered.start).not.toHaveBeenCalled();
      expect(frames.size).toBe(0);
      second();
    },
  );

  it('uses finite normalized progress for rendering, prepares at the handoff, and ends at 1600ms', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    theme.setThemePreference('dark');
    expect(theme.getThemeSnapshot()).toMatchObject({
      effective: 'dark',
      applied: 'light',
      scene: { direction: 'sunset' },
    });
    expect(registered.render).toHaveBeenLastCalledWith(0);
    await advance(1247);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(registered.prepare).not.toHaveBeenCalled();
    await advance(1);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(registered.prepare).toHaveBeenCalledTimes(1);
    expect(registered.render).toHaveBeenLastCalledWith(0.78);
    await advance(352);
    expect(registered.render).toHaveBeenLastCalledWith(1);
    expect(
      registered.render.mock.calls.every(
        ([p]) => Number.isFinite(p) && p >= 0 && p <= 1,
      ),
    ).toBe(true);
    expect(theme.getThemeSnapshot()).toMatchObject({
      applied: 'dark',
      scene: null,
    });
    expect(registered.cleanup).toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('a paused RAF cannot hand off from independent wall timers; the resumed frame drives hero and palette together', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    theme.setThemePreference('dark');
    await vi.advanceTimersByTimeAsync(1000);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(registered.render).toHaveBeenCalledTimes(1);
    frame();
    expect(registered.render).toHaveBeenLastCalledWith(0.625);
    expect(document.documentElement.dataset.theme).toBe('light');
    await advance(248);
    expect(registered.render).toHaveBeenLastCalledWith(0.78);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('same-effective System selection persists without creating a scene', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    theme.setThemePreference('system');
    expect(localStorage.getItem('eduflow-theme')).toBe('system');
    expect(registered.start).not.toHaveBeenCalled();
    expect(theme.getThemeSnapshot().scene).toBeNull();
  });

  it('follows OS only for System and uses the sunrise handoff at normalized .18', async () => {
    const theme = await initialize('system', true),
      registered = hero(theme);
    const unsubscribe = theme.subscribeTheme(() => undefined);
    scheme.change(false);
    await advance(287);
    expect(document.documentElement.dataset.theme).toBe('dark');
    await advance(1);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(registered.render).toHaveBeenLastCalledWith(0.18);
    await advance(1312);
    theme.setThemePreference('dark');
    await advance(1600);
    scheme.change(true);
    scheme.change(false);
    expect(theme.getThemeSnapshot().effective).toBe('dark');
    registered.unregister();
    unsubscribe();
    expect(scheme.removeEventListener).toHaveBeenCalled();
    expect(reduced.removeEventListener).toHaveBeenCalled();
  });

  it('a subscriber reversal prevents a superseded plan from starting', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    let reverse = true;
    const unsubscribe = theme.subscribeTheme(() => {
      if (reverse && theme.getThemeSnapshot().effective === 'dark') {
        reverse = false;
        theme.setThemePreference('light');
      }
    });
    theme.setThemePreference('dark');
    expect(theme.getThemeSnapshot()).toMatchObject({
      effective: 'light',
      applied: 'light',
      scene: null,
    });
    expect(registered.start).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    unsubscribe();
  });

  it('a start-event reversal creates no stale renderer', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    const reverse = () => theme.setThemePreference('light');
    document.addEventListener('eduflow:theme-transition-start', reverse, {
      once: true,
    });
    theme.setThemePreference('dark');
    document.removeEventListener('eduflow:theme-transition-start', reverse);
    expect(registered.start).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(theme.getThemeSnapshot()).toMatchObject({
      applied: 'light',
      scene: null,
    });
  });

  it('reversing before handoff cancels stale RAF work and restores the currently applied palette', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    theme.setThemePreference('dark');
    const stale = [...frames.values()][0];
    await advance(300);
    theme.setThemePreference('light');
    stale(1600);
    expect(theme.getThemeSnapshot()).toMatchObject({
      applied: 'light',
      effective: 'light',
      scene: null,
    });
    expect(registered.start).toHaveBeenCalledTimes(1);
    expect(registered.cleanup).toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('reversing after handoff starts the new direction and ignores the old RAF callback', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    theme.setThemePreference('dark');
    const stale = [...frames.values()][0];
    await advance(1300);
    theme.setThemePreference('light');
    const latest = theme.getThemeSnapshot().scene!;
    stale(3000);
    expect(theme.getThemeSnapshot().scene?.id).toBe(latest.id);
    await advance(288);
    expect(document.documentElement.dataset.theme).toBe('light');
    await advance(1312);
    expect(theme.getThemeSnapshot().scene).toBeNull();
    expect(registered.start).toHaveBeenCalledTimes(2);
  });

  it.each(['absent', 'offscreen', 'hidden', 'disconnected', 'no-raf'] as const)(
    'applies immediately for %s',
    async (condition) => {
      const theme = await initialize(),
        registered = condition === 'absent' ? undefined : hero(theme);
      if (condition === 'offscreen')
        registered!.rect.mockReturnValue(new DOMRect(0, -600, 600, 300));
      if (condition === 'hidden') registered!.element.style.display = 'none';
      if (condition === 'disconnected') registered!.element.remove();
      if (condition === 'no-raf')
        vi.stubGlobal('requestAnimationFrame', undefined);
      theme.setThemePreference('dark');
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(theme.getThemeSnapshot().scene).toBeNull();
      expect(registered?.start ?? vi.fn()).not.toHaveBeenCalled();
    },
  );

  it('reduced motion skips initialization and immediately cleans an active scene', async () => {
    const theme = await initialize('light', false, true),
      registered = hero(theme);
    const unsubscribe = theme.subscribeTheme(() => undefined);
    theme.setThemePreference('dark');
    expect(registered.start).not.toHaveBeenCalled();
    reduced.change(false);
    theme.setThemePreference('light');
    await advance(100);
    reduced.change(true);
    expect(theme.getThemeSnapshot()).toMatchObject({
      effective: 'light',
      applied: 'light',
      scene: null,
    });
    expect(registered.cleanup).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    unsubscribe();
  });

  it('route unregistration cleans the plan and registering the next hero never replays', async () => {
    const theme = await initialize(),
      first = hero(theme);
    theme.setThemePreference('dark');
    first.unregister();
    expect(first.cleanup).toHaveBeenCalled();
    expect(theme.getThemeSnapshot()).toMatchObject({
      applied: 'dark',
      scene: null,
    });
    const next = hero(theme);
    expect(next.start).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it.each([800, 1360])(
    'resizing during progress at %sms settles the latest palette and removes all scene resources',
    async (elapsed) => {
      const theme = await initialize(),
        registered = hero(theme);
      theme.setThemePreference('dark');
      const stale = [...frames.values()][0];
      await advance(elapsed);
      vi.stubGlobal('innerWidth', window.innerWidth + 120);
      window.dispatchEvent(new Event('resize'));
      expect(theme.getThemeSnapshot()).toMatchObject({
        applied: 'dark',
        scene: null,
      });
      expect(registered.cleanup).toHaveBeenCalled();
      expect(frames.size).toBe(0);
      stale(5000);
      expect(theme.getThemeSnapshot().scene).toBeNull();
    },
  );

  it('renderer failure and blocked preference storage leave the requested theme usable', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    registered.render.mockImplementation(() => {
      throw new Error('Render failure');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Blocked storage');
    });
    theme.setThemePreference('dark');
    expect(theme.getThemeSnapshot()).toMatchObject({
      effective: 'dark',
      applied: 'dark',
      scene: null,
    });
    expect(registered.cleanup).toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it.each(['scrollX', 'scrollY'] as const)(
    '%s movement outside the Hero cancels without forcing the user back',
    async (axis) => {
      const theme = await initialize(),
        registered = hero(theme);
      const forceScroll = vi
        .spyOn(window, 'scrollTo')
        .mockImplementation(() => undefined);
      theme.setThemePreference('dark');
      await advance(100);
      vi.stubGlobal(axis, 500);
      if (axis === 'scrollY')
        registered.rect.mockReturnValue(new DOMRect(0, -400, 600, 300));
      window.dispatchEvent(new Event('scroll'));
      expect(window[axis]).toBe(500);
      expect(theme.getThemeSnapshot()).toMatchObject({
        effective: 'dark',
        applied: 'dark',
        scene: null,
      });
      expect(registered.cleanup).toHaveBeenCalled();
      expect(frames.size).toBe(0);
      expect(forceScroll).not.toHaveBeenCalled();
    },
  );

  it('the next RAF catches a viewport movement even if its scroll event is delayed', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    theme.setThemePreference('dark');
    vi.stubGlobal('scrollY', 500);
    registered.rect.mockReturnValue(new DOMRect(0, -400, 600, 300));
    await advance(50);
    expect(theme.getThemeSnapshot()).toMatchObject({
      applied: 'dark',
      scene: null,
    });
    expect(registered.cleanup).toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('no-op viewport scroll events and nested scroller changes do not cancel uninterrupted motion', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    theme.setThemePreference('dark');
    const id = theme.getThemeSnapshot().scene!.id;
    window.dispatchEvent(new Event('scroll'));
    const nested = document.createElement('div');
    registered.element.append(nested);
    nested.scrollTop = 80;
    nested.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(theme.getThemeSnapshot().scene?.id).toBe(id);
    expect(registered.cleanup).not.toHaveBeenCalled();
    await advance(1600);
    expect(registered.render).toHaveBeenLastCalledWith(1);
    expect(theme.getThemeSnapshot()).toMatchObject({
      applied: 'dark',
      scene: null,
    });
  });

  it('a queued resize notification with the already measured viewport dimensions does not cancel the scene', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    vi.stubGlobal('innerWidth', 700);
    vi.stubGlobal('innerHeight', 900);
    theme.setThemePreference('dark');
    const id = theme.getThemeSnapshot().scene!.id;
    window.dispatchEvent(new Event('resize'));
    expect(theme.getThemeSnapshot().scene?.id).toBe(id);
    expect(registered.cleanup).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
  });

  it('a queued old RAF cannot erase the newer handle before viewport-scroll cleanup', async () => {
    const theme = await initialize(),
      registered = hero(theme);
    theme.setThemePreference('dark');
    const obsolete = [...frames.values()][0];
    await advance(1300);
    theme.setThemePreference('light');
    const activeId = [...frames.keys()][0];
    obsolete(1600);
    vi.stubGlobal('scrollY', 350);
    registered.rect.mockReturnValue(new DOMRect(0, -250, 600, 200));
    window.dispatchEvent(new Event('scroll'));
    expect(cancelAnimationFrame).toHaveBeenCalledWith(activeId);
    expect(frames.size).toBe(0);
    expect(registered.cleanup).toHaveBeenCalled();
    expect(theme.getThemeSnapshot()).toMatchObject({
      applied: 'light',
      effective: 'light',
      scene: null,
    });
    obsolete(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(theme.getThemeSnapshot()).toMatchObject({
      applied: 'light',
      scene: null,
    });
  });

  it('disposes the recovery watchdog, RAF, renderer and media listeners without stale updates', async () => {
    const theme = await initialize(),
      registered = hero(theme),
      notify = vi.fn();
    theme.subscribeTheme(notify);
    const scheduled = vi.spyOn(globalThis, 'setTimeout'),
      cleared = vi.spyOn(globalThis, 'clearTimeout');
    theme.setThemePreference('dark');
    const stale = [...frames.values()][0];
    theme.disposeThemeTransition();
    const owned = scheduled.mock.calls.map((call, index) => ({
      delay: call[1],
      id: scheduled.mock.results[index].value,
    }));
    expect(owned.map((timer) => timer.delay)).toContain(3200);
    for (const timer of owned.filter((timer) => timer.delay === 3200))
      expect(cleared).toHaveBeenCalledWith(timer.id);
    expect(registered.cleanup).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    const count = notify.mock.calls.length,
      rendered = registered.render.mock.calls.length;
    scheme.change(true);
    reduced.change(true);
    stale(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(notify).toHaveBeenCalledTimes(count);
    expect(registered.render).toHaveBeenCalledTimes(rendered);
  });
});
