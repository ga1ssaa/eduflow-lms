import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  chooseTheme,
  hasSceneClock,
  installSceneClock,
  pauseSceneClock,
} from './theme';
import {
  installUiFixtures,
  fixtureCourseId,
  fixtureCourseSlug,
} from './fixtures/atmosphere.ts';

async function originalStyles(page: Page) {
  return page.evaluate(() => {
    const hero = document.querySelector('[data-theme-hero]');
    const section = hero?.closest('.landing-hero,.catalog-hero');
    return [
      document.getElementById('root'),
      hero?.closest('.product-shell,.catalog-shell'),
      section,
      hero,
      hero?.querySelector('[data-hero-carrier]'),
      section?.querySelector('.atmosphere-decoration,.catalog-hero-pixels'),
    ].map((node) => ({
      text: node?.getAttribute('style') ?? '',
      properties: node ? (node as HTMLElement).style.length : 0,
    }));
  });
}

async function openScene(
  page: Page,
  destination: 'light' | 'dark',
  width = 1440,
  startY = 0,
  controlled = false,
) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(
    (saved) => localStorage.setItem('eduflow-theme', saved),
    destination === 'dark' ? 'light' : 'dark',
  );
  if (controlled) await installSceneClock(page);
  await page.goto('/');
  await expect(page.locator('[data-theme-hero=home]')).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.evaluate(
    (y) => window.scrollTo({ top: y, behavior: 'instant' }),
    startY,
  );
  await paint(page);
  const styles = await originalStyles(page);
  await chooseTheme(page, destination);
  if (controlled) await pauseSceneClock(page);
  await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(1);
  return styles;
}
async function state(page: Page) {
  return page.evaluate(() => {
    const carrier = document.querySelector<HTMLElement>('[data-hero-carrier]');
    return {
      scrollY,
      scrollX,
      canvas: document.querySelectorAll('[data-theme-scene-atmosphere]').length,
      phase: document
        .querySelector('[data-theme-hero]')
        ?.getAttribute('data-hero-phase'),
      fixed: carrier ? getComputedStyle(carrier).position : null,
      transform: carrier ? getComputedStyle(carrier).transform : null,
      theme: document.documentElement.dataset.theme,
      active: document.documentElement.dataset.themeTransition,
      progress: document
        .querySelector<HTMLElement>('[data-theme-hero]')
        ?.style.getPropertyValue('--hero-scene-progress'),
      boundary: document
        .querySelector('[data-theme-hero]')!
        .closest('section')!
        .nextElementSibling!.getBoundingClientRect().top,
    };
  });
}
async function paint(page: Page) {
  if (hasSceneClock(page)) {
    await page.clock.runFor(32);
    return;
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function settleNativeScroll(page: Page) {
  let lastY = -1;
  let stableSince = Date.now();
  await expect
    .poll(
      async () => {
        const y = await page.evaluate(() => scrollY);
        if (y !== lastY) {
          lastY = y;
          stableSince = Date.now();
        }
        return Date.now() - stableSince;
      },
      { intervals: [30] },
    )
    .toBeGreaterThanOrEqual(120);
}
for (const destination of ['dark', 'light'] as const) {
  test(`real viewport scroll cancels the active Home ${destination} scene before it can float over later sections`, async ({
    page,
  }, testInfo) => {
    await openScene(page, destination);
    const before = await state(page);
    await page
      .locator('#for-instructors')
      .evaluate((element) =>
        element.scrollIntoView({ block: 'start', behavior: 'instant' }),
      );
    await paint(page);
    const after = await state(page);
    const phase =
      process.env.EDUFLOW_STABILITY_PHASE === 'red'
        ? 'red-before-fix'
        : 'green-after-fix';
    const directory = join(process.cwd(), 'test-results', 'theme-stability');
    await mkdir(directory, { recursive: true });
    if (phase === 'green-after-fix')
      await expect(page.locator('#for-instructors .surface')).toHaveAttribute(
        'data-reveal-state',
        'revealed',
      );
    if (process.env.EDUFLOW_CAPTURE_VISUALS === '1')
      await page.screenshot({
        path: join(directory, `${phase}-home-${destination}-programmatic.png`),
      });
    await writeFile(
      join(directory, `${phase}-home-${destination}-programmatic.json`),
      JSON.stringify(
        {
          scenario: 'Public real UI; no live authentication or database writes',
          before,
          after,
        },
        null,
        2,
      ),
    );
    await testInfo.attach('viewport-scroll-state', {
      body: JSON.stringify({ before, after }),
      contentType: 'application/json',
    });
    expect(after.scrollY).toBeGreaterThan(500);
    expect(after.canvas, JSON.stringify(after)).toBe(0);
    expect(after.fixed).not.toBe('fixed');
    expect(after.active).toBeUndefined();
    expect(after.theme).toBe(destination);
  });
}

async function assertScrollCleanup(
  page: Page,
  destination: 'light' | 'dark',
  styles: Awaited<ReturnType<typeof originalStyles>>,
) {
  await paint(page);
  const after = await state(page);
  expect(after.canvas, JSON.stringify(after)).toBe(0);
  expect(after.fixed).not.toBe('fixed');
  expect(after.transform).toBe('none');
  expect(after.active).toBeUndefined();
  expect(after.phase).toBeNull();
  expect(after.theme).toBe(destination);
  const restored = await originalStyles(page);
  expect(restored).toEqual(styles);
  restored.forEach((entry, index) => {
    if (styles[index].text === '') expect(entry.properties).toBe(0);
  });
  await expect(
    page.locator('[data-theme-scene-layer], .theme-scene-background-muted'),
  ).toHaveCount(0);
  return after;
}
const methods = [
  'wheel-down',
  'wheel-up',
  'trackpad',
  'PageDown',
  'PageUp',
  'Space',
  'ArrowDown',
  'touch',
  'scrollbar',
  'programmatic-slow',
  'anchor',
] as const;
for (const destination of ['dark', 'light'] as const) {
  for (const method of methods) {
    test(`${method} preserves ${destination} inside Hero and cleans after crossing at five widths`, async ({
      page,
      context,
    }) => {
      test.setTimeout(90_000);
      for (const width of [320, 375, 768, 1024, 1440]) {
        const startY = method === 'wheel-up' || method === 'PageUp' ? 120 : 0;
        const styles = await openScene(page, destination, width, startY, true);
        if (['PageDown', 'PageUp', 'Space', 'ArrowDown'].includes(method))
          await page.evaluate(() =>
            (document.activeElement as HTMLElement)?.blur(),
          );
        await page.evaluate(() =>
          Object.assign(window, { __focusAtScroll: document.activeElement }),
        );
        if (method === 'wheel-down') await page.mouse.wheel(0, 600);
        else if (method === 'wheel-up') await page.mouse.wheel(0, -600);
        else if (method === 'trackpad') {
          for (let step = 0; step < 6; step++) {
            await page.mouse.wheel(0, 55);
            await paint(page);
          }
        } else if (method === 'programmatic-slow') {
          for (let step = 1; step <= 8; step++) {
            await page.evaluate(
              (y) => window.scrollTo({ top: y, behavior: 'instant' }),
              step * 20,
            );
            await paint(page);
          }
        } else if (method === 'anchor') {
          // Navigation clicks retain their real actionability/focus behavior.
          await page.clock.resume();
          const desktop = page.getByRole('navigation', {
            name: 'Main navigation',
          });
          if (await desktop.isVisible())
            await desktop
              .getByRole('link', { name: 'About', exact: true })
              .click();
          else {
            await page
              .getByRole('button', { name: 'Open navigation', exact: true })
              .click();
            await page
              .getByRole('navigation', { name: 'Mobile navigation' })
              .getByRole('link', { name: 'About', exact: true })
              .click();
          }
        } else if (method === 'touch') {
          const cdp = await context.newCDPSession(page);
          try {
            await cdp.send('Emulation.setTouchEmulationEnabled', {
              enabled: true,
              maxTouchPoints: 1,
            });
            await cdp.send('Input.synthesizeScrollGesture', {
              x: width / 2,
              y: 700,
              yDistance: -600,
              speed: 1800,
              gestureSourceType: 'touch',
            });
          } finally {
            await cdp.send('Emulation.setTouchEmulationEnabled', {
              enabled: false,
            });
            await cdp.detach();
          }
        } else if (method === 'scrollbar') {
          const dimensions = await page.evaluate(() => ({
            inner: innerWidth,
            client: document.documentElement.clientWidth,
          }));
          test.skip(
            dimensions.inner === dimensions.client,
            'Headless Chromium overlay scrollbar exposes no hit-testable native thumb; native scrollbar drag is unavailable.',
          );
          await page.mouse.move((dimensions.inner + dimensions.client) / 2, 80);
          await page.mouse.down();
          await page.mouse.move(
            (dimensions.inner + dimensions.client) / 2,
            650,
            { steps: 8 },
          );
          await page.mouse.up();
        } else await page.keyboard.press(method);
        await expect
          .poll(() => page.evaluate(() => scrollY), {
            message: `${method} must move the ${width}px viewport from ${startY}px`,
          })
          .not.toBe(startY);
        // Browser keyboard/touch inertia is native, not governed by page.clock.
        // Settle it before measuring the boundary for a second input gesture.
        await settleNativeScroll(page);
        await paint(page);
        const inside = await state(page);
        if (inside.boundary > 0) {
          expect(inside.canvas, JSON.stringify(inside)).toBe(1);
          expect(inside.fixed).toBe('fixed');
          expect(inside.active).toBe(
            destination === 'dark' ? 'sunset' : 'sunrise',
          );
          expect(Number(inside.progress)).toBeLessThan(1);
          if (!['touch', 'scrollbar'].includes(method))
            expect(
              await page.evaluate(
                () =>
                  document.activeElement ===
                  (window as unknown as { __focusAtScroll: Element })
                    .__focusAtScroll,
              ),
            ).toBe(true);
          await page.mouse.move(20, 700);
          await page.mouse.wheel(0, inside.boundary + 16);
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  document
                    .querySelector('[data-theme-hero]')!
                    .closest('section')!
                    .nextElementSibling!.getBoundingClientRect().top,
              ),
            )
            .toBeLessThanOrEqual(0);
        } else {
          // PageDown/Space may cross a shorter desktop Hero in one gesture.
          // The actual section boundary, not the input type, defines cleanup.
          expect(inside.canvas, JSON.stringify(inside)).toBe(0);
          expect(inside.fixed).not.toBe('fixed');
        }
        const scrollAtExit = await page.evaluate(() => scrollY);
        const after = await assertScrollCleanup(page, destination, styles);
        expect(after.boundary).toBeLessThanOrEqual(0);
        expect(after.scrollY).toBe(scrollAtExit);
        expect(after.scrollY).toBeGreaterThanOrEqual(0);
        if (!['anchor', 'touch', 'scrollbar'].includes(method))
          expect(
            await page.evaluate(
              () =>
                document.activeElement ===
                (window as unknown as { __focusAtScroll: Element })
                  .__focusAtScroll,
            ),
          ).toBe(true);
      }
    });
  }
  test(`after actual handoff, ${destination} survives rapid down/up inside Hero and cancels at the boundary without stale frames`, async ({
    page,
  }) => {
    test.setTimeout(30_000);
    for (const width of [320, 375, 768, 1024, 1440]) {
      const styles = await openScene(page, destination, width, 0, true);
      await page.clock.runFor(1300);
      await expect(page.locator('[data-theme-hero]')).toHaveAttribute(
        'data-hero-phase',
        'incoming',
      );
      await page.evaluate(() =>
        window.scrollTo({ top: 600, behavior: 'instant' }),
      );
      await paint(page);
      await page.evaluate(() =>
        window.scrollTo({ top: 200, behavior: 'instant' }),
      );
      await paint(page);
      const inside = await state(page);
      expect(inside.scrollY).toBe(200);
      expect(inside.boundary).toBeGreaterThan(0);
      expect(inside.canvas).toBe(1);
      expect(inside.phase).toBe('incoming');
      await page.mouse.move(20, 700);
      await page.mouse.wheel(0, inside.boundary + 16);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document
                .querySelector('[data-theme-hero]')!
                .closest('section')!
                .nextElementSibling!.getBoundingClientRect().top,
          ),
        )
        .toBeLessThanOrEqual(0);
      const after = await assertScrollCleanup(page, destination, styles);
      await expect(
        page.getByRole('button', { name: 'Color theme', exact: true }),
      ).toBeFocused();
      const scrollAtExit = after.scrollY;
      await page.clock.runFor(2800);
      await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(
        0,
      );
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        destination,
      );
      expect(await page.evaluate(() => scrollY)).toBe(scrollAtExit);
    }
  });
}

test('no-op and nested scroll preserve the approved uninterrupted timing and normalized trajectory', async ({
  page,
}) => {
  const styles = await openScene(page, 'dark');
  const samples = await page.evaluate(
    () =>
      new Promise<Array<{ p: number; t: number }>>((resolve) => {
        const result: Array<{ p: number; t: number }> = [];
        const sample = (t: number) => {
          result.push({
            t,
            p: Number(
              document
                .querySelector<HTMLElement>('[data-theme-hero]')!
                .style.getPropertyValue('--hero-scene-progress'),
            ),
          });
          if (result.length === 8) resolve(result);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  const duration =
    (samples.at(-1)!.t - samples[0].t) / (samples.at(-1)!.p - samples[0].p);
  expect(duration).toBeGreaterThan(2350);
  expect(duration).toBeLessThan(2500);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('scroll'));
    const scroller = document.createElement('div');
    scroller.id = 'isolated-nested-scroller';
    scroller.style.cssText =
      'height:30px;width:30px;overflow:auto;position:fixed;bottom:0;right:0';
    scroller.innerHTML =
      '<div style="height:300px">Isolated scroll fixture</div>';
    document.body.append(scroller);
    scroller.scrollTop = 90;
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(1);
  await expect
    .poll(() => page.locator('[data-theme-scene-atmosphere]').count())
    .toBe(0);
  await page
    .locator('#isolated-nested-scroller')
    .evaluate((element) => element.remove());
  const restored = await originalStyles(page);
  expect(restored).toEqual(styles);
  restored.forEach((entry, index) => {
    if (styles[index].text === '') expect(entry.properties).toBe(0);
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

for (const role of ['student', 'instructor', 'admin'] as const) {
  test(`ISOLATED UI FIXTURE ${role}: no-Hero business routes, repeated themes and System retain route and account`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const fixture = await installUiFixtures(page, role);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() =>
      localStorage.setItem('eduflow-theme', 'light'),
    );
    const routes =
      role === 'student'
        ? [
            '/learning',
            `/learn/${fixtureCourseId}`,
            `/courses/${fixtureCourseSlug}`,
          ]
        : role === 'instructor'
          ? [
              '/instructor',
              '/instructor/courses',
              '/instructor/courses/new',
              `/instructor/courses/${fixtureCourseId}`,
              `/instructor/courses/${fixtureCourseId}/edit`,
              `/instructor/courses/${fixtureCourseId}/curriculum`,
              `/instructor/courses/${fixtureCourseId}/students`,
            ]
          : ['/admin', '/admin/courses', `/admin/courses/${fixtureCourseId}`];
    for (const route of routes) {
      await page.goto(route);
      await expect(
        page.getByRole('main').getByRole('heading', { level: 1 }),
      ).toBeVisible();
      const url = page.url();
      for (const mode of ['dark', 'light', 'system']) {
        await chooseTheme(page, mode);
        await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(
          0,
        );
        expect(page.url()).toBe(url);
      }
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(
        0,
      );
      await expect(page.locator('.avatar')).toContainText('F');
      await page.emulateMedia({ colorScheme: 'light' });
    }
    expect(fixture.unexpected).toEqual([]);
  });
}

test('anonymous login/register and reduced-motion Home/catalog never create a fixed scene', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('eduflow-theme', 'light'),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const route of ['/login', '/register', '/', '/courses']) {
    await page.goto(route);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1 }),
    ).toBeVisible();
    await chooseTheme(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(0);
  }
});
