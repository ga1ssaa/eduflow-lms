import { expect, test } from '@playwright/test';
import { chooseTheme } from './theme';

for (const path of ['/', '/courses']) {
  for (const destination of ['light', 'dark'] as const) {
    test(`${path} ${destination}: 2px wheel inside Hero continues, wheel into next section cancels safely`, async ({
      page,
    }) => {
      await page.addInitScript(
        (theme) => localStorage.setItem('eduflow-theme', theme),
        destination === 'light' ? 'dark' : 'light',
      );
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto(path);
      await expect(page.locator('[data-theme-hero]')).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.mouse.move(20, 600);
      await page.mouse.wheel(0, 100);
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(100);
      await chooseTheme(page, destination);
      await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(
        1,
      );
      await page.mouse.move(20, 600);
      await page.mouse.wheel(0, 2);
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(102);
      await page.waitForTimeout(150);
      await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(
        1,
      );
      await expect(page.locator('[data-hero-orbit]')).toHaveCount(1);
      const distance = await page.evaluate(() => {
        const section = document
          .querySelector('[data-theme-hero]')!
          .closest('section')!;
        return section.nextElementSibling!.getBoundingClientRect().top + 2;
      });
      await page.mouse.wheel(0, distance);
      await expect
        .poll(() => page.evaluate(() => scrollY))
        .toBeGreaterThan(102);
      await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(
        0,
        { timeout: 500 },
      );
      await expect(page.locator('[data-hero-orbit]')).toHaveCount(0);
      await expect(page.locator('[data-hero-carrier]')).toHaveCSS(
        'position',
        'static',
      );
      await expect(page.locator('[data-hero-carrier]')).toHaveCSS(
        'transform',
        'none',
      );
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        destination,
      );
      const finalY = await page.evaluate(() => scrollY);
      expect(
        await page.evaluate(
          () =>
            document
              .querySelector('[data-theme-hero]')!
              .closest('section')!
              .nextElementSibling!.getBoundingClientRect().top,
        ),
      ).toBeLessThanOrEqual(0);
      await expect(page.locator('html')).not.toHaveAttribute(
        'data-theme-transition',
      );
      await page.waitForTimeout(100);
      expect(await page.evaluate(() => scrollY)).toBe(finalY);
      await expect(
        page.getByRole('button', { name: 'Color theme', exact: true }),
      ).toBeFocused();
    });
    for (const position of [
      'top',
      'small-scroll',
      'lower-boundary',
      'next-section',
    ] as const) {
      test(`${path} ${destination} ${position}: section-based eligibility and cleanup`, async ({
        page,
      }) => {
        await page.addInitScript(
          (theme) => localStorage.setItem('eduflow-theme', theme),
          destination === 'light' ? 'dark' : 'light',
        );
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.goto(path);
        await expect(page.locator('[data-theme-hero]')).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        const initialY = await page.evaluate((position) => {
          const section = document
            .querySelector('[data-theme-hero]')!
            .closest('section')!;
          const boundary =
            section.nextElementSibling!.getBoundingClientRect().top + scrollY;
          const y =
            position === 'top'
              ? 0
              : position === 'small-scroll'
                ? 80
                : boundary + (position === 'next-section' ? 1 : -1);
          window.scrollTo({ top: y, behavior: 'instant' });
          return scrollY;
        }, position);
        await page.waitForTimeout(100);
        await page.evaluate(() => {
          const events: unknown[] = [];
          Object.assign(window, { boundaryEvents: events });
          window.addEventListener('scroll', () =>
            events.push({
              kind: 'scroll',
              y: scrollY,
              active: document.documentElement.dataset.themeTransition,
            }),
          );
          document.addEventListener('eduflow:theme-transition-start', () =>
            events.push({ kind: 'start', y: scrollY }),
          );
        });
        await chooseTheme(page, destination);
        if (position === 'next-section') {
          await expect(
            page.locator('[data-theme-scene-atmosphere]'),
          ).toHaveCount(0);
          await expect(page.locator('html')).toHaveAttribute(
            'data-theme',
            destination,
          );
          expect(await page.evaluate(() => scrollY)).toBe(initialY);
          return;
        }
        // A late scroll notification with unchanged coordinates must not cancel.
        await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
        await page.waitForTimeout(400);
        const current = await page.evaluate(() => ({
          y: scrollY,
          canvas: document.querySelectorAll('[data-theme-scene-atmosphere]')
            .length,
          events: (window as unknown as { boundaryEvents: unknown[] })
            .boundaryEvents,
        }));
        expect(current.canvas, JSON.stringify(current)).toBe(1);
        expect(current.y).toBe(initialY);
        await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(
          0,
        );
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          destination,
        );
        expect(await page.evaluate(() => scrollY)).toBe(initialY);
      });
    }
  }
}
