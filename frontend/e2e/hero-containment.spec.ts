import { expect, test, type Page } from '@playwright/test';
import { chooseTheme } from './theme';

async function inspectScene(page: Page) {
  return page.evaluate(() => {
    const hero = document.querySelector<HTMLElement>('[data-theme-hero]')!;
    const carrier = hero.querySelector<HTMLElement>('[data-hero-carrier]')!;
    const section = hero.closest('section')!;
    const next = section.nextElementSibling!;
    const bounds = carrier.getBoundingClientRect();
    const boundary = next.getBoundingClientRect().top;
    const active = Boolean(document.documentElement.dataset.themeTransition);
    // Hit testing respects browser paint clipping. Include normally decorative,
    // pointer-transparent artwork for this synchronous inspection only.
    const probe = document.createElement('style');
    probe.textContent =
      '[data-hero-carrier], [data-hero-carrier] * { pointer-events: auto !important; }';
    document.head.append(probe);
    let overlap: { x: number; y: number } | null = null;
    try {
      const left = Math.max(1, bounds.left);
      const right = Math.min(innerWidth - 1, bounds.right);
      const top = Math.max(1, boundary + 1, bounds.top);
      const bottom = Math.min(innerHeight - 1, bounds.bottom);
      for (let x = left; x < right && !overlap; x += 20) {
        for (let y = top; y < bottom; y += 20) {
          if (
            document
              .elementsFromPoint(x, y)
              .some((element) => carrier.contains(element))
          ) {
            overlap = { x, y };
            break;
          }
        }
      }
    } finally {
      probe.remove();
    }
    return {
      active,
      overlap,
      boundary,
      scrollY,
      carrier: bounds.toJSON(),
      position: getComputedStyle(carrier).position,
      transform: getComputedStyle(carrier).transform,
      clip: getComputedStyle(section).clipPath,
      overflow: getComputedStyle(section).overflow,
      zIndex: getComputedStyle(carrier).zIndex,
      viewportHeight: innerHeight,
      matrix: Array.from(
        new DOMMatrixReadOnly(
          getComputedStyle(carrier).transform,
        ).toFloat64Array(),
      ),
    };
  });
}

for (const path of ['/', '/courses']) {
  for (const destination of ['light', 'dark'] as const) {
    for (const direction of ['down', 'up', 'across-boundary'] as const) {
      test(`${path} ${destination}: continuous slow wheel ${direction} never paints Hero over next section`, async ({
        page,
      }) => {
        await page.addInitScript(
          (theme) => localStorage.setItem('eduflow-theme', theme),
          destination === 'light' ? 'dark' : 'light',
        );
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.goto(path);
        await expect(page.locator('[data-theme-hero]')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await page.mouse.move(20, 600);
        const boundaryY = await page.evaluate(
          () =>
            document
              .querySelector('[data-theme-hero]')!
              .closest('section')!
              .nextElementSibling!.getBoundingClientRect().top + scrollY,
        );
        const initialY =
          direction === 'down'
            ? 100
            : direction === 'up'
              ? 450
              : Math.round(boundaryY) - 120;
        await page.mouse.wheel(0, initialY);
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(initialY);
        const original = await page
          .locator('[data-hero-carrier]')
          .boundingBox();
        expect(original).not.toBeNull();
        await chooseTheme(page, destination);
        await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(
          1,
        );
        await page.mouse.move(20, 600);
        let activeFrames = 0;
        let nextSectionVisible = false;
        let crossedBoundary = false;
        for (let index = 0; index < 40; index++) {
          await page.mouse.wheel(0, direction === 'up' ? -8 : 8);
          await page.waitForTimeout(35);
          const state = await inspectScene(page);
          if (state.boundary <= 0) {
            crossedBoundary = true;
            expect(state.active, JSON.stringify(state)).toBe(false);
            await expect(
              page.locator('[data-theme-scene-atmosphere]'),
            ).toHaveCount(0, { timeout: 500 });
          }
          if (state.active) {
            activeFrames++;
            nextSectionVisible ||= state.boundary < state.viewportHeight;
            expect(state.overlap, JSON.stringify(state)).toBeNull();
            expect(state.position).toBe('fixed');
            expect(state.carrier.width).toBeCloseTo(original!.width, 1);
            expect(state.carrier.height).toBeCloseTo(original!.height, 1);
            // The containment must not create a new fixed containing block,
            // retune translation, or add any scale/rotation to approved motion.
            expect(state.matrix.slice(0, 12)).toEqual([
              1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0,
            ]);
            expect(state.carrier.left - state.matrix[12]).toBeCloseTo(
              original!.x,
              1,
            );
            expect(state.carrier.top - state.matrix[13]).toBeCloseTo(
              original!.y - (state.scrollY - initialY),
              1,
            );
          }
        }
        expect(crossedBoundary).toBe(direction === 'across-boundary');
        expect(activeFrames).toBeGreaterThan(5);
        expect(nextSectionVisible).toBe(true);
        await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(
          0,
        );
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          destination,
        );
        await expect(page.locator('[data-hero-carrier]')).toHaveCSS(
          'transform',
          'none',
        );
        await expect(page.locator('[data-hero-carrier]')).toHaveCSS(
          'position',
          'static',
        );
        const finalY = await page.evaluate(() => scrollY);
        const final = await page.locator('[data-hero-carrier]').boundingBox();
        expect(final!.x).toBeCloseTo(original!.x, 1);
        expect(final!.y + finalY).toBeCloseTo(original!.y + initialY, 1);
        expect(final!.width).toBeCloseTo(original!.width, 1);
        expect(final!.height).toBeCloseTo(original!.height, 1);
        expect((await inspectScene(page)).clip).toBe('none');
        await page.waitForTimeout(100);
        expect(await page.evaluate(() => scrollY)).toBe(finalY);
      });
    }
  }
}
