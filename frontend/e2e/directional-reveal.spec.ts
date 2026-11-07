import { expect, test } from '@playwright/test';
import { installPublicUiFixtures } from './fixtures/atmosphere';

test.beforeEach(async ({ page }) => {
  await installPublicUiFixtures(page);
  await page.addInitScript(() => {
    document.addEventListener('animationstart', (event) => {
      const element = event.target;
      if (
        event.animationName !== 'scroll-reveal-enter' ||
        !(element instanceof HTMLElement)
      )
        return;
      const animation = element
        .getAnimations()
        .find(
          (item) =>
            (item as CSSAnimation).animationName === 'scroll-reveal-enter',
        )!;
      const frames = (animation.effect as KeyframeEffect).getKeyframes();
      const from = new DOMMatrixReadOnly(String(frames[0].transform));
      const to = new DOMMatrixReadOnly(String(frames.at(-1)!.transform));
      const rect = element.getBoundingClientRect();
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      const natural = {
        x: rect.x - matrix.m41 + scrollX,
        y: rect.y - matrix.m42 + scrollY,
      };
      element.dataset.qaRevealCount = String(
        Number(element.dataset.qaRevealCount ?? 0) + 1,
      );
      element.dataset.qaReveal = JSON.stringify({
        duration: animation.effect!.getTiming().duration,
        delay: animation.effect!.getTiming().delay,
        easing: getComputedStyle(element).animationTimingFunction,
        from: {
          x: from.m41,
          y: from.m42,
          opacity: Number(frames[0].opacity),
          clip: frames[0].clipPath,
        },
        to: { x: to.m41, y: to.m42, opacity: Number(frames.at(-1)!.opacity) },
      });
      let overflow = false;
      let intermediateOpacity = false;
      const sample = () => {
        overflow ||= document.documentElement.scrollWidth > innerWidth;
        const style = getComputedStyle(element);
        const opacity = Number(style.opacity);
        intermediateOpacity ||= opacity > 0 && opacity < 1;
        if (element.dataset.revealState === 'revealing') {
          requestAnimationFrame(sample);
          return;
        }
        const final = element.getBoundingClientRect();
        element.dataset.qaCleanup = JSON.stringify({
          x: final.x + scrollX - natural.x,
          y: final.y + scrollY - natural.y,
          overflow,
          intermediateOpacity,
          clip: style.clipPath,
          transform: style.transform,
          opacity,
        });
      };
      requestAnimationFrame(sample);
    });
  });
});

for (const path of ['/', '/courses']) {
  for (const width of [320, 375, 768, 1024, 1440]) {
    for (const theme of ['light', 'dark']) {
      test(`${path} ${width}px ${theme}: approved directions, masks, clean final geometry and unchanged cards`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.addInitScript(
          (saved) => localStorage.setItem('eduflow-theme', saved),
          theme,
        );
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        const home = path === '/';
        const targets = [
          { selector: '[data-hero-face]', x: -280, y: 0, mask: false },
          {
            selector: home ? '.section-heading' : '.catalog-results-heading',
            x: 0,
            y: -240,
            mask: true,
          },
          {
            selector: home ? '.landing-how > div' : '.catalog-section-intro',
            x: 240,
            y: 0,
            mask: true,
          },
          {
            selector: home
              ? '.landing-teach > .surface'
              : '.catalog-teach > div:first-child',
            x: 0,
            y: -200,
            mask: false,
          },
          {
            selector: home ? '.landing-about h2' : '.catalog-about h2',
            x: 0,
            y: 240,
            mask: true,
          },
        ];
        const location = page.url();
        for (const target of targets) {
          const element = page.locator(target.selector);
          await element.evaluate((node) =>
            node.scrollIntoView({ block: 'center', behavior: 'instant' }),
          );
          await expect(element).toHaveAttribute('data-qa-reveal');
          const motion = JSON.parse(
            (await element.getAttribute('data-qa-reveal'))!,
          );
          expect(motion.duration).toBe(1050);
          expect(motion.easing.replace(/\s/g, '')).toBe(
            'cubic-bezier(0.22,1,0.36,1)',
          );
          expect(motion.from.x).toBe(target.x);
          expect(motion.from.y).toBe(target.y);
          expect(motion.from.opacity).toBe(0);
          expect(motion.to).toEqual({ x: 0, y: 0, opacity: 1 });
          expect(motion.from.clip !== 'none').toBe(target.mask);
          await expect(element).toHaveAttribute(
            'data-reveal-state',
            'revealed',
          );
          await expect(element).toHaveAttribute('data-qa-cleanup');
          const cleanup = JSON.parse(
            (await element.getAttribute('data-qa-cleanup'))!,
          );
          expect(Math.abs(cleanup.x)).toBeLessThan(1);
          expect(Math.abs(cleanup.y)).toBeLessThan(1);
          expect(cleanup.overflow).toBe(false);
          expect(cleanup.intermediateOpacity).toBe(true);
          expect(cleanup.clip).toBe('none');
          expect(cleanup.transform).toBe('none');
          expect(cleanup.opacity).toBe(1);
          await expect(element).toHaveAttribute('data-qa-reveal-count', '1');
        }
        const cards = page.locator(
          home ? '.featured-card' : '.catalog-course-card',
        );
        for (const index of [0, 1]) {
          const card = cards.nth(index);
          await card.evaluate((node) =>
            node.scrollIntoView({ block: 'center', behavior: 'instant' }),
          );
          await expect(card).toHaveAttribute('data-qa-reveal');
          const motion = JSON.parse(
            (await card.getAttribute('data-qa-reveal'))!,
          );
          expect(motion.duration).toBe(600);
          expect(motion.delay).toBe(index * 80);
          expect(motion.from).toEqual({
            x: 0,
            y: 24,
            opacity: 0,
            clip: 'none',
          });
          await expect(card).toHaveAttribute('data-reveal-state', 'revealed');
        }
        await page.evaluate(() =>
          window.scrollTo({ top: 0, behavior: 'instant' }),
        );
        for (const target of targets)
          await expect(page.locator(target.selector)).toHaveAttribute(
            'data-qa-reveal-count',
            '1',
          );
        expect(page.url()).toBe(location);
        expect(
          await page
            .locator('section#about')
            .evaluate((node) => getComputedStyle(node).transform),
        ).toBe('none');
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    }
  }
}

test('focusing masked content settles its reveal immediately and removes clipping', async ({
  page,
}) => {
  await page.goto('/');
  const heading = page.locator('.section-heading');
  await heading.evaluate((node) =>
    node.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await expect(heading).toHaveAttribute('data-reveal-state', 'revealing');
  const link = heading.getByRole('link');
  await link.focus();
  await expect(link).toBeFocused();
  await expect(heading).toHaveAttribute('data-reveal-state', 'revealed');
  await expect(heading).toHaveCSS('clip-path', 'none');
  await expect(heading).toHaveCSS('opacity', '1');
});
