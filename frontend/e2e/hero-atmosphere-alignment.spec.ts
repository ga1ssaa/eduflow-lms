import { expect, test } from '@playwright/test';
import { chooseTheme } from './theme';

type Sample = {
  kind: 'frame' | 'cleanup';
  progress: number;
  y: number;
  layers: {
    role: string;
    gap: number;
    anchorError: number;
    decorOffsets: number[];
  }[];
};

for (const path of ['/', '/courses']) {
  for (const destination of ['light', 'dark'] as const) {
    for (const motion of ['none', 'up', 'down'] as const) {
      test(`${path} to ${destination}, ${motion}: atmospheric gap stays zero through cleanup`, async ({
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
        const below = await page.evaluate(
          () =>
            Math.round(
              document
                .querySelector('[data-theme-hero]')!
                .closest('section')!
                .nextElementSibling!.getBoundingClientRect().top + scrollY,
            ) + 80,
        );
        await page.mouse.move(20, 600);
        await page.mouse.wheel(0, below);
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(below);
        // Enter the Hero from the following section, as in the manual report.
        await page.mouse.wheel(0, -200);
        const initialY = below - 200;
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(initialY);
        await page.evaluate(() => {
          const samples: Sample[] = [];
          let running = true;
          const capture = (kind: Sample['kind']) => {
            const layers = [
              ...document.querySelectorAll<HTMLElement>(
                '[data-theme-scene-layer]',
              ),
            ];
            if (layers.length !== 2) return;
            const section = document
              .querySelector('[data-theme-hero]')!
              .closest('section')!;
            samples.push({
              kind,
              y: scrollY,
              progress: Number(layers[0].dataset.sceneProgress),
              layers: layers.map((layer) => {
                const gradient = layer.querySelector<HTMLElement>(
                  '[data-theme-scene-gradient]',
                )!;
                const bounds = gradient.getBoundingClientRect();
                const continuation = layer
                  .querySelector('[data-theme-scene-continuation]')!
                  .getBoundingClientRect();
                return {
                  role: layer.dataset.themeSceneLayer!,
                  gap: continuation.top - bounds.bottom,
                  anchorError: bounds.top - section.getBoundingClientRect().top,
                  decorOffsets: [...gradient.children].map(
                    (element) =>
                      element.getBoundingClientRect().top - bounds.top,
                  ),
                };
              }),
            });
          };
          const remove = Element.prototype.remove;
          Element.prototype.remove = function () {
            if (this.matches('[data-theme-scene-atmosphere]'))
              capture('cleanup');
            remove.call(this);
          };
          Object.assign(window, {
            atmosphereAlignment: {
              samples,
              stop: () => {
                running = false;
              },
            },
          });
          const frame = () => {
            if (!running) return;
            capture('frame');
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
        await chooseTheme(page, destination);
        await expect(page.locator('[data-theme-scene-layer]')).toHaveCount(2);
        await page.mouse.move(20, 600);
        if (motion !== 'none') {
          for (let index = 0; index < 3; index++) {
            await page.mouse.wheel(0, motion === 'up' ? -8 : 8);
            await page.waitForTimeout(40);
          }
        }
        const expectedY =
          initialY + (motion === 'up' ? -24 : motion === 'down' ? 24 : 0);
        await expect.poll(() => page.evaluate(() => scrollY)).toBe(expectedY);
        await expect
          .poll(() =>
            page.evaluate(() => {
              const section = document
                .querySelector('[data-theme-hero]')!
                .closest('section')!;
              return Math.max(
                ...[
                  ...document.querySelectorAll('[data-theme-scene-gradient]'),
                ].map((gradient) =>
                  Math.abs(
                    gradient.getBoundingClientRect().top -
                      section.getBoundingClientRect().top,
                  ),
                ),
              );
            }),
          )
          .toBeLessThan(0.1);
        await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(
          0,
        );
        const samples = await page.evaluate(() => {
          const trace = (
            window as unknown as {
              atmosphereAlignment: { samples: Sample[]; stop: () => void };
            }
          ).atmosphereAlignment;
          trace.stop();
          return trace.samples;
        });
        expect(samples.length).toBeGreaterThan(10);
        const cleanup = samples.filter((sample) => sample.kind === 'cleanup');
        expect(cleanup).toHaveLength(1);
        expect(cleanup[0].progress).toBe(1);
        expect(cleanup[0].y).toBe(expectedY);
        const maxGap = Math.max(
          ...samples.flatMap((sample) =>
            sample.layers.map((layer) => Math.abs(layer.gap)),
          ),
        );
        expect(maxGap, JSON.stringify(samples)).toBeLessThan(0.1);
        for (const sample of samples) {
          for (const layer of sample.layers) {
            const baseline = samples[0].layers.find(
              (initial) => initial.role === layer.role,
            )!;
            expect(layer.decorOffsets).toHaveLength(
              baseline.decorOffsets.length,
            );
            layer.decorOffsets.forEach((offset, index) =>
              expect(
                Math.abs(offset - baseline.decorOffsets[index]),
              ).toBeLessThan(0.1),
            );
          }
        }
        cleanup[0].layers.forEach((layer) =>
          expect(Math.abs(layer.anchorError)).toBeLessThan(0.1),
        );
        console.info(
          JSON.stringify({
            path,
            destination,
            motion,
            measuredFrames: samples.length,
            maxGap,
          }),
        );
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          destination,
        );
        expect(await page.evaluate(() => scrollY)).toBe(expectedY);
      });
    }
  }
}
