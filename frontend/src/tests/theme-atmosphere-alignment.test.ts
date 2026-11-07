import { expect, it, vi } from 'vitest';
import { createThemeSceneAtmosphere } from '../theme/theme-scene-atmosphere';

it.each(
  (['home', 'catalog'] as const).flatMap((route) =>
    (['light', 'dark'] as const).flatMap((destination) =>
      [-24, 0, 24].map((delta) => [route, destination, delta] as const),
    ),
  ),
)(
  '%s to %s keeps atmospheric layers aligned after %spx scrolling',
  (route, destination, delta) => {
    vi.stubGlobal('scrollY', 100);
    const root = document.createElement('div');
    root.id = 'root';
    const shell = document.createElement('div');
    shell.className =
      route === 'home' ? 'product-shell landing-shell' : 'catalog-shell';
    const section = document.createElement('section');
    section.className = route === 'home' ? 'landing-hero' : 'catalog-hero';
    const hero = document.createElement('div');
    const decor = document.createElement('div');
    decor.className =
      route === 'home' ? 'atmosphere-decoration' : 'catalog-hero-pixels';
    decor.append(document.createElement('i'));
    section.append(hero, decor);
    shell.append(section);
    root.append(shell);
    document.body.append(root);
    vi.spyOn(section, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, -100, 1280, 900),
    );
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, -100, 1280, 3200),
    );
    // jsdom has no pseudo-element layout; browser regressions cover actual rays.
    const computedStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) =>
      computedStyle(element),
    );
    const scene = createThemeSceneAtmosphere(
      {
        id: 1,
        destination,
        direction: destination === 'light' ? 'sunrise' : 'sunset',
      },
      hero,
      0.5,
    );
    try {
      vi.stubGlobal('scrollY', 100 + delta);
      for (const progress of [0.1, 0.45, 0.55, 0.9, 1]) {
        scene.render(progress);
        const layers = document.querySelectorAll<HTMLElement>(
          '[data-theme-scene-layer]',
        );
        expect(layers).toHaveLength(2);
        layers.forEach((layer) => {
          const gradient = layer.querySelector<HTMLElement>(
            '[data-theme-scene-gradient]',
          )!;
          const continuation = layer.querySelector<HTMLElement>(
            '[data-theme-scene-continuation]',
          )!;
          const page = layer.querySelector<HTMLElement>(
            '[data-theme-scene-page]',
          )!;
          expect(gradient.style.top).toBe(`${-100 - delta}px`);
          expect(continuation.style.top).toBe(gradient.style.top);
          expect(page.style.top).toBe(gradient.style.top);
          expect(gradient.querySelector(`.${decor.className}`)).not.toBeNull();
          expect(layer.dataset.sceneProgress).toBe(String(progress));
          if (layer.dataset.themeSceneLayer === 'destination')
            expect(layer.style.maskImage).not.toBe('');
        });
      }
    } finally {
      scene.cleanup();
      root.remove();
    }
    expect(document.querySelector('[data-theme-scene-atmosphere]')).toBeNull();
    expect(shell.getAttribute('style')).toBeNull();
    expect(section.getAttribute('style')).toBeNull();
  },
);
