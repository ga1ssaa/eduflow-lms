import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type {
  ThemeHeroTransition,
  ThemeScene,
} from '../theme/theme-transition-controller';

const driver = vi.hoisted(() => ({
  start: undefined as undefined | ((scene: ThemeScene) => ThemeHeroTransition),
  snapshot: {
    preference: 'light',
    effective: 'light',
    applied: 'light',
    scene: null,
  },
}));
vi.mock('../theme/theme-transition-controller', () => ({
  THEME_TRANSITION_DURATION: 1600,
  getThemeSnapshot: () => driver.snapshot,
  subscribeTheme: () => () => undefined,
  registerThemeHero: (registration: { start: typeof driver.start }) => {
    driver.start = registration.start;
    return () => undefined;
  },
}));
vi.mock('../theme/theme-scene-atmosphere', () => ({
  createThemeSceneAtmosphere: () => ({ render: vi.fn(), cleanup: vi.fn() }),
}));
import { ThemeTransition } from '../theme/ThemeTransition';

it.each(
  (['home', 'catalog'] as const).flatMap((name) =>
    [0, 240, -50].map((scrollDelta) => [name, scrollDelta] as const),
  ),
)(
  '%s preserves viewport endpoints and natural rest after scrolling %spx',
  (name, scrollDelta) => {
    vi.stubGlobal('innerWidth', 1280);
    vi.stubGlobal('innerHeight', 720);
    vi.stubGlobal('scrollY', 100);
    const view = render(<ThemeTransition name={name}>Hero</ThemeTransition>);
    const carrier = view.container.querySelector<HTMLElement>(
      '[data-hero-carrier]',
    )!;
    const wrapper =
      view.container.querySelector<HTMLElement>('[data-theme-hero]')!;
    const point = () => {
      const parts = carrier.style.transform.match(
        /translate3d\(([-\d.e]+)px, ([-\d.e]+)px, 0\)/,
      )!;
      return { x: Number(parts[1]), y: Number(parts[2]) };
    };
    vi.spyOn(carrier, 'getBoundingClientRect').mockImplementation(() => {
      if (carrier.style.position !== 'fixed')
        return new DOMRect(24, 176 - window.scrollY, 1232, 735);
      const offset = point();
      return new DOMRect(
        Number.parseFloat(carrier.style.left) + offset.x,
        Number.parseFloat(carrier.style.top) + offset.y,
        1232,
        735,
      );
    });
    const plan = driver.start!({
      id: 1,
      destination: 'dark',
      direction: 'sunset',
    });
    plan.render(0);
    expect(carrier.getBoundingClientRect().top).toBe(76);
    vi.stubGlobal('scrollY', 100 + scrollDelta);
    plan.render(plan.handoffAt);
    expect(carrier.getBoundingClientRect().top).toBeCloseTo(752, 8);
    expect(carrier.getBoundingClientRect().left).toBeCloseTo(1312, 8);
    expect(plan.prepareHandoff()).toBe(true);
    plan.render(plan.handoffAt);
    expect(carrier.getBoundingClientRect().right).toBeCloseTo(-32, 8);
    expect(carrier.getBoundingClientRect().top).toBeCloseTo(752, 8);
    plan.render(1);
    const before = carrier.getBoundingClientRect();
    expect(before.top).toBeCloseTo(176 - window.scrollY, 8);
    expect(point()).toEqual({ x: 0, y: 0 });
    plan.cleanup();
    const after = carrier.getBoundingClientRect();
    expect(after.top - before.top).toBeCloseTo(0, 8);
    expect(after.left - before.left).toBeCloseTo(0, 8);
    expect(carrier.getAttribute('style')).toBeNull();
    expect(wrapper.getAttribute('style')).toBeNull();
    expect(wrapper).not.toHaveAttribute('data-hero-phase');
    view.unmount();
  },
);
