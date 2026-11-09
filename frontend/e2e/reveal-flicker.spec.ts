import { expect, test } from '@playwright/test';
import { installPublicUiFixtures } from './fixtures/atmosphere';
import { chooseTheme } from './theme';

test.use({ screenshot: 'off', video: 'off', trace: 'off' });

type Entrance = {
  state: string | undefined;
  pendingFlash: boolean;
  started?: number;
  elapsed?: number;
  duration?: number;
  delay?: number;
  intermediate: boolean;
};
type AuditWindow = { revealAudit: Map<Element, Entrance> };

for (const path of ['/', '/courses']) {
  for (const width of [375, 1440]) {
    for (const theme of ['light', 'dark']) {
      test(`${path} ${width}px ${theme}: no pre-entry flash or premature production cleanup`, async ({
        page,
      }) => {
        await installPublicUiFixtures(page);
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.addInitScript((preference) => {
          localStorage.setItem('eduflow-theme', preference);
          const audit = new Map<Element, Entrance>();
          (window as unknown as AuditWindow).revealAudit = audit;
          const frame = () => {
            for (const element of document.querySelectorAll<HTMLElement>(
              '[data-reveal]',
            )) {
              const state = element.dataset.revealState;
              const opacity = Number(getComputedStyle(element).opacity);
              const sample = audit.get(element) ?? {
                state,
                pendingFlash: false,
                intermediate: false,
              };
              sample.pendingFlash ||=
                (!state || state === 'observed') && opacity > 0;
              if (state === 'revealing') {
                sample.started ??= performance.now();
                const animation = element
                  .getAnimations()
                  .find(
                    (item) =>
                      (item as CSSAnimation).animationName ===
                      'scroll-reveal-enter',
                  );
                if (animation) {
                  const timing = animation.effect!.getTiming();
                  sample.duration = Number(timing.duration);
                  sample.delay = timing.delay;
                }
                sample.intermediate ||= opacity > 0.05 && opacity < 0.95;
              } else if (state === 'revealed' && sample.state === 'revealing') {
                sample.elapsed = performance.now() - sample.started!;
              }
              sample.state = state;
              audit.set(element, sample);
            }
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        }, theme);
        await page.goto(path);
        const selectors = [
          '[data-hero-face]',
          path === '/' ? '.section-heading' : '.catalog-results-heading',
          path === '/' ? '.featured-card' : '.catalog-course-card',
        ];
        for (const selector of selectors) {
          const target = page.locator(selector).first();
          await target.evaluate((element) =>
            element.scrollIntoView({ block: 'center', behavior: 'instant' }),
          );
          await expect(target).toHaveAttribute('data-reveal-state', 'revealed');
          await expect
            .poll(() =>
              target.evaluate(
                (element) =>
                  (window as unknown as AuditWindow).revealAudit.get(element)
                    ?.elapsed,
              ),
            )
            .toBeDefined();
          const sample = await target.evaluate((element) =>
            (window as unknown as AuditWindow).revealAudit.get(element),
          );
          expect(sample!.pendingFlash).toBe(false);
          expect(sample!.duration).toBe(selector.includes('card') ? 600 : 1050);
          expect(sample!.elapsed).toBeGreaterThanOrEqual(
            sample!.duration! + sample!.delay! - 50,
          );
          expect(sample!.intermediate).toBe(true);
          await expect(target).toHaveCSS('opacity', '1');
          await expect(target).toHaveCSS('transform', 'none');
          await expect(target).toHaveCSS('clip-path', 'none');
        }
        const flashes = await page.evaluate(
          () =>
            [...(window as unknown as AuditWindow).revealAudit.values()].filter(
              (sample) => sample.pendingFlash,
            ).length,
        );
        expect(flashes).toBe(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    }
  }
}

for (const path of ['/', '/courses']) {
  test(`${path}: reduced motion displays content immediately`, async ({
    page,
  }) => {
    await installPublicUiFixtures(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(path);
    const hero = page.locator('[data-hero-face]');
    await expect(hero).toHaveAttribute('data-reveal-state', 'revealed');
    await expect(hero).toHaveCSS('opacity', '1');
    await expect(hero).toHaveCSS('animation-name', 'none');
  });
}

test('content stays visible when IntersectionObserver is unavailable', async ({
  page,
}) => {
  await installPublicUiFixtures(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', { value: undefined });
  });
  await page.goto('/');
  await expect(page.locator('[data-hero-face]')).toHaveCSS('opacity', '1');
  await expect(page.locator('.section-heading')).toHaveCSS('opacity', '1');
});

for (const path of ['/', '/courses']) {
  test(`${path}: theme motion settles the entrance without restarting it`, async ({
    page,
  }) => {
    await installPublicUiFixtures(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.addInitScript(() =>
      localStorage.setItem('eduflow-theme', 'light'),
    );
    await page.goto(path);
    const hero = page.locator('[data-hero-face]');
    await expect(hero).toHaveAttribute('data-reveal-state', 'revealing');
    await chooseTheme(page, 'dark');
    await expect(hero).toHaveAttribute('data-reveal-state', 'revealed');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-theme-transition',
    );
    await expect(hero).toHaveCSS('opacity', '1');
    await expect(hero).toHaveCSS('animation-name', 'none');
    await chooseTheme(page, 'light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).not.toHaveAttribute(
      'data-theme-transition',
    );
    await expect(hero).toHaveAttribute('data-reveal-state', 'revealed');
    await expect(hero).toHaveCSS('opacity', '1');
  });
}
