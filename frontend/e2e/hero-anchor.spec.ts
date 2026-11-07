import { expect, test } from '@playwright/test';
import { chooseTheme, installSceneClock, pauseSceneClock } from './theme';

type Rectangle = { top: number; left: number; width: number; height: number };
type Measurement = {
  progress: number;
  boundary: number;
  scrollY: number;
  before: Rectangle;
  natural: Rectangle;
  after?: Rectangle;
};

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 375, height: 812 },
]) {
  for (const path of ['/', '/courses']) {
    for (const destination of ['light', 'dark'] as const) {
      for (const mode of [
        'no-scroll',
        'slow-scroll',
        'boundary-crossing',
      ] as const) {
        test(`${viewport.width}px ${path} ${destination} ${mode}: cleanup matches natural flow`, async ({
          page,
        }, testInfo) => {
          await page.setViewportSize(viewport);
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await page.addInitScript(
            (theme) => localStorage.setItem('eduflow-theme', theme),
            destination === 'light' ? 'dark' : 'light',
          );
          await page.goto(path);
          await expect(page.locator('[data-theme-hero]')).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          await page.mouse.move(20, 500);
          await page.mouse.wheel(0, 100);
          await expect.poll(() => page.evaluate(() => scrollY)).toBe(100);
          await page.evaluate(() => {
            const records: Measurement[] = [];
            Object.assign(window, { heroAnchorCleanup: records });
            let pending: Measurement | undefined;
            const rect = (element: Element): Rectangle => {
              const { top, left, width, height } =
                element.getBoundingClientRect();
              return { top, left, width, height };
            };
            const removeAttribute = Element.prototype.removeAttribute;
            const setAttribute = Element.prototype.setAttribute;
            const observeRestore = (
              element: Element,
              name: string,
              restore: () => void,
            ) => {
              const wrapper =
                document.querySelector<HTMLElement>('[data-theme-hero]')!;
              const carrier = wrapper.querySelector<HTMLElement>(
                '[data-hero-carrier]',
              )!;
              const restoringWrapper =
                name === 'style' &&
                element === wrapper &&
                carrier.style.position === 'fixed';
              const restoringCarrier =
                name === 'style' &&
                element === carrier &&
                carrier.style.position === 'fixed';
              if (restoringWrapper) {
                pending = {
                  progress: Number(
                    wrapper.style.getPropertyValue('--hero-scene-progress'),
                  ),
                  boundary: wrapper
                    .closest('section')!
                    .nextElementSibling!.getBoundingClientRect().top,
                  scrollY,
                  before: rect(carrier),
                  natural: rect(wrapper),
                };
              }
              // Do not force layout between restoring the placeholder and its
              // carrier: that intermediate, empty footprint is never painted.
              restore();
              if (restoringCarrier && pending) {
                pending.after = rect(carrier);
                records.push(pending);
                pending = undefined;
              }
            };
            Element.prototype.removeAttribute = function (name) {
              observeRestore(this, name, () =>
                removeAttribute.call(this, name),
              );
            };
            Element.prototype.setAttribute = function (name, value) {
              observeRestore(this, name, () =>
                setAttribute.call(this, name, value),
              );
            };
          });
          await installSceneClock(page);
          await chooseTheme(page, destination);
          await pauseSceneClock(page);
          await expect(
            page.locator('[data-theme-scene-atmosphere]'),
          ).toHaveCount(1);
          await page.mouse.move(20, 500);
          if (mode === 'slow-scroll') {
            for (let index = 0; index < 30; index++) {
              await page.mouse.wheel(0, 8);
              await expect
                .poll(() => page.evaluate(() => scrollY))
                .toBe(108 + index * 8);
              await page.clock.runFor(48);
            }
            await expect.poll(() => page.evaluate(() => scrollY)).toBe(340);
            // The full displacement must happen before completion, even on a
            // slow test host. No geometry assertions are deferred or relaxed.
            await expect(
              page.locator('[data-theme-scene-atmosphere]'),
            ).toHaveCount(1);
          } else if (mode === 'boundary-crossing') {
            const distance = await page.evaluate(
              () =>
                document
                  .querySelector('[data-theme-hero]')!
                  .closest('section')!
                  .nextElementSibling!.getBoundingClientRect().top + 10,
            );
            for (let index = 0; index < 12; index++) {
              await page.mouse.wheel(0, distance / 12);
              await page.clock.runFor(48);
            }
          }
          await page.clock.runFor(3000);
          await expect(
            page.locator('[data-theme-scene-atmosphere]'),
          ).toHaveCount(0);
          const measurements = await page.evaluate(
            () =>
              (window as unknown as { heroAnchorCleanup: Measurement[] })
                .heroAnchorCleanup,
          );
          await testInfo.attach('cleanup-rectangles', {
            body: JSON.stringify(measurements, null, 2),
            contentType: 'application/json',
          });
          expect(measurements).toHaveLength(1);
          const measured = measurements[0];
          expect(measured.after).toBeDefined();
          if (mode !== 'boundary-crossing') {
            console.info(
              JSON.stringify({
                viewport: viewport.width,
                path,
                destination,
                mode,
                beforeTop: measured.before.top,
                afterTop: measured.after!.top,
                cleanupDeltaY: measured.after!.top - measured.before.top,
                cleanupDeltaX: measured.after!.left - measured.before.left,
              }),
            );
          }
          if (mode === 'boundary-crossing') {
            expect(measured.progress).toBeLessThan(1);
            expect(measured.boundary).toBeLessThanOrEqual(0);
          } else {
            expect(measured.progress).toBe(1);
            expect(measured.scrollY).toBe(mode === 'slow-scroll' ? 340 : 100);
            for (const coordinate of [
              'top',
              'left',
              'width',
              'height',
            ] as const) {
              expect(
                Math.abs(
                  measured.after![coordinate] - measured.before[coordinate],
                ),
                JSON.stringify(measured),
              ).toBeLessThan(0.1);
            }
          }
          expect(
            Math.abs(measured.after!.top - measured.natural.top),
          ).toBeLessThan(0.1);
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
          await expect(
            page.getByRole('button', { name: 'Color theme', exact: true }),
          ).toBeFocused();
          const finalY = await page.evaluate(() => scrollY);
          await page.waitForTimeout(100);
          expect(await page.evaluate(() => scrollY)).toBe(finalY);
        });
      }
    }
  }
}
