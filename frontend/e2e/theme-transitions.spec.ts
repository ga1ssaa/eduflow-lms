import { expect, test, type Page } from '@playwright/test';
import { installUiFixtures, fixtureCourseId } from './fixtures/atmosphere.ts';
import { chooseTheme } from './theme';

type Audit = {
  firstRootTheme: string | null;
  nativeCalls: number;
  events: Array<{
    id: number;
    direction: string;
    destination: string;
    width: number;
    height: number;
    time: number;
  }>;
  resizes: Array<{
    width: number;
    height: number;
    time: number;
    active?: string;
  }>;
  exits: Array<{ id: number; theme: string; left: number; top: number }>;
};
async function initializeAudit(
  page: Page,
  saved = 'light',
  recordGeometry = false,
) {
  await page.addInitScript(
    ({ preference, record }) => {
      localStorage.setItem('eduflow-theme', preference);
      const audit: Audit = {
        firstRootTheme: null,
        nativeCalls: 0,
        events: [],
        resizes: [],
        exits: [],
      };
      Object.assign(window, { __themeAudit: audit });
      new MutationObserver(() => {
        if (
          audit.firstRootTheme === null &&
          document.getElementById('root')?.firstElementChild
        )
          audit.firstRootTheme =
            document.documentElement.dataset.theme ?? 'missing';
      }).observe(document, { subtree: true, childList: true });
      document.addEventListener('eduflow:theme-transition-start', (event) => {
        const scene = (event as CustomEvent).detail;
        audit.events.push({
          id: scene.id,
          direction: scene.direction,
          destination: scene.destination,
          width: innerWidth,
          height: innerHeight,
          time: performance.now(),
        });
      });
      window.addEventListener('resize', () =>
        audit.resizes.push({
          width: innerWidth,
          height: innerHeight,
          time: performance.now(),
          active: document.documentElement.dataset.themeTransition,
        }),
      );
      const native = document.startViewTransition;
      if (native)
        Object.defineProperty(document, 'startViewTransition', {
          configurable: true,
          value: (...args: Parameters<typeof native>) => {
            audit.nativeCalls++;
            return Reflect.apply(native, document, args);
          },
        });
      if (record) {
        const rect = Element.prototype.getBoundingClientRect;
        Element.prototype.getBoundingClientRect = function () {
          const bounds = Reflect.apply(rect, this, []) as DOMRect;
          if (
            this.hasAttribute('data-hero-carrier') &&
            bounds.left > innerWidth &&
            bounds.top > innerHeight
          )
            audit.exits.push({
              id: audit.events.at(-1)?.id ?? -1,
              theme: document.documentElement.dataset.theme ?? '',
              left: bounds.left,
              top: bounds.top,
            });
          return bounds;
        };
      }
    },
    { preference: saved, record: recordGeometry },
  );
}
async function audit(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __themeAudit: Audit }).__themeAudit,
  );
}
async function settled(page: Page) {
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-theme-transition',
  );
  await expect(
    page.locator(
      '[data-hero-orbit], [data-hero-phase], [data-theme-scene-atmosphere], [data-theme-scene-layer]',
    ),
  ).toHaveCount(0);
  await expect(page.locator('.theme-scene-background-muted')).toHaveCount(0);
  for (const carrier of await page.locator('[data-hero-carrier]').all()) {
    await expect(carrier).toHaveCSS('transform', 'none');
    expect(
      await carrier.evaluate(
        (element) => (element as HTMLElement).style.position,
      ),
    ).not.toBe('fixed');
  }
}
for (const [preference, os, expected] of [
  ['light', 'dark', 'light'],
  ['dark', 'light', 'dark'],
  ['system', 'light', 'light'],
  ['system', 'dark', 'dark'],
] as const) {
  test(`initial ${preference} / OS ${os} applies before React without a scene, route replay or refresh entrance`, async ({
    page,
  }) => {
    await page.emulateMedia({
      colorScheme: os,
      reducedMotion: 'no-preference',
    });
    await initializeAudit(page, preference);
    await page.goto('/');
    await expect(page.locator('[data-theme-hero=home]')).toBeVisible();
    await expect
      .poll(async () => (await audit(page)).firstRootTheme)
      .toBe(expected);
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
    await settled(page);
    expect((await audit(page)).events).toEqual([]);
    await page
      .getByRole('link', { name: 'Explore courses', exact: true })
      .last()
      .click();
    await expect(page.locator('[data-theme-hero=catalog]')).toBeVisible();
    await settled(page);
    expect((await audit(page)).events).toEqual([]);
    await page.reload();
    await expect(page.locator('[data-theme-hero=catalog]')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
    await settled(page);
    expect((await audit(page)).events).toEqual([]);
    expect((await audit(page)).nativeCalls).toBe(0);
  });
}

for (const path of ['/', '/courses']) {
  test(`actual ${path === '/' ? 'Home' : 'Catalog'} hero and approved atmospheres share one approved-duration scene progress`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await initializeAudit(page, 'light', true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(path);
    const wrapper = page.locator('[data-theme-hero]'),
      heading = wrapper.locator('h1');
    await expect(heading).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect
      .poll(() =>
        heading.evaluate((element) =>
          element.closest('[data-reveal]')?.getAttribute('data-reveal-state'),
        ),
      )
      .toBe('revealed');
    const seed = new Date('2026-11-06T00:00:00Z');
    await page.clock.install({ time: seed });
    await page.clock.pauseAt(new Date(seed.getTime() + 4096));
    const records = [];
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.runFor(32);
      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: 'instant' }),
      );
      for (const destination of ['dark', 'light']) {
        const previous = destination === 'dark' ? 'light' : 'dark';
        const original = await wrapper.evaluate((element) => {
          const section = element.closest('.landing-hero,.catalog-hero')!,
            shell = element.closest('.catalog-shell,.product-shell')!;
          return {
            styles: [
              document.getElementById('root')!,
              shell,
              section,
              element,
              element.querySelector('[data-hero-carrier]')!,
              ...section.querySelectorAll(
                ':scope > .catalog-hero-pixels, :scope > .atmosphere-decoration',
              ),
            ].map((node) => node.getAttribute('style') ?? ''),
            sourceGradient: getComputedStyle(section).backgroundImage,
            groups: Object.fromEntries(
              Object.entries({
                heading: 'h1',
                subtitle: '.landing-description,.catalog-hero-description',
                cta: 'a.button',
                art: '.landing-art,.catalog-sculpture',
              }).map(([key, selector]) => {
                const box = element
                  .querySelector(selector)!
                  .getBoundingClientRect();
                return [
                  key,
                  { x: box.x, y: box.y, width: box.width, height: box.height },
                ];
              }),
            ),
            nav: (() => {
              const b = document
                .querySelector('.floating-navbar .header-inner')!
                .getBoundingClientRect();
              return { x: b.x, y: b.y, width: b.width, height: b.height };
            })(),
          };
        });
        // DOM-dispatched real menu events avoid actionability RAF waits while the
        // official browser clock is paused for deterministic frame inspection.
        await page
          .getByRole('button', { name: 'Color theme', exact: true })
          .dispatchEvent('click');
        await page
          .getByRole('menuitemradio', {
            name: destination === 'dark' ? 'Dark' : 'Light',
            exact: true,
          })
          .dispatchEvent('click');
        await expect(wrapper).toHaveAttribute(
          'data-hero-orbit',
          destination === 'dark' ? 'sunset' : 'sunrise',
        );
        const id = (await audit(page)).events.at(-1)!.id;
        const handoff = Number(
          await page
            .locator('[data-theme-scene-atmosphere]')
            .getAttribute('data-scene-handoff'),
        );
        const duration = 1312 / 1.08 / (1 - handoff);
        expect(duration).toBeGreaterThan(2350);
        expect(duration).toBeLessThan(2500);
        let elapsed = 0;
        const samples = [];
        for (const requested of [
          ...new Set([
            0,
            0.15,
            0.35,
            0.5,
            0.7,
            0.85,
            1,
            Number(handoff.toFixed(10)),
          ]),
        ].sort((a, b) => a - b)) {
          const next = Math.ceil((requested * duration) / 16) * 16;
          if (next > elapsed) await page.clock.runFor(next - elapsed);
          elapsed = next;
          if (requested === 1) {
            await settled(page);
            samples.push({ requested, complete: true });
            continue;
          }
          const sample = await wrapper.evaluate((element, requested) => {
            const carrier = element.querySelector('[data-hero-carrier]')!,
              style = getComputedStyle(carrier),
              m = new DOMMatrixReadOnly(style.transform);
            const box = (node: Element) => {
              const b = node.getBoundingClientRect();
              return {
                x: b.x,
                y: b.y,
                width: b.width,
                height: b.height,
                right: b.right,
                top: b.top,
              };
            };
            const canvas = document.querySelector<HTMLElement>(
              '[data-theme-scene-atmosphere]',
            )!;
            if (!canvas)
              throw new Error(
                JSON.stringify({
                  audit: (window as unknown as { __themeAudit: Audit })
                    .__themeAudit,
                  requested,
                  now: performance.now(),
                  y: scrollY,
                  x: scrollX,
                  theme: document.documentElement.dataset.theme,
                  active: document.documentElement.dataset.themeTransition,
                  phase: element.getAttribute('data-hero-phase'),
                }),
              );
            const layers = Array.from(
              canvas.querySelectorAll<HTMLElement>('[data-theme-scene-layer]'),
            ).map((layer) => {
              const s = getComputedStyle(layer),
                gradient = layer.querySelector<HTMLElement>(
                  '[data-theme-scene-gradient]',
                )!;
              return {
                role: layer.dataset.themeSceneLayer,
                theme: layer.dataset.sceneTheme,
                progress: Number(s.getPropertyValue('--theme-scene-progress')),
                dataProgress: Number(layer.dataset.sceneProgress),
                maskProgress: Number(
                  s.getPropertyValue('--theme-scene-mask-progress'),
                ),
                mask: s.maskImage,
                pointer: s.pointerEvents,
                gradient: getComputedStyle(gradient).backgroundImage,
                pixels: gradient.querySelectorAll('i').length,
                rays: gradient.querySelectorAll('[data-theme-scene-rays]')
                  .length,
                businessNodes:
                  layer.querySelectorAll('h1,button,input,a').length,
              };
            });
            return {
              progress: Number(
                (element as HTMLElement).style.getPropertyValue(
                  '--hero-scene-progress',
                ),
              ),
              theme: document.documentElement.dataset.theme,
              phase: element.getAttribute('data-hero-phase'),
              carrier: box(carrier),
              matrix: [
                m.m11,
                m.m12,
                m.m13,
                m.m14,
                m.m21,
                m.m22,
                m.m23,
                m.m24,
                m.m31,
                m.m32,
                m.m33,
                m.m34,
                m.m43,
                m.m44,
              ],
              face: getComputedStyle(element.querySelector('[data-hero-face]')!)
                .transform,
              perspective: getComputedStyle(element).perspective,
              groups: Object.fromEntries(
                Object.entries({
                  heading: 'h1',
                  subtitle: '.landing-description,.catalog-hero-description',
                  cta: 'a.button',
                  art: '.landing-art,.catalog-sculpture',
                }).map(([key, selector]) => [
                  key,
                  box(element.querySelector(selector)!),
                ]),
              ),
              nav: box(
                document.querySelector('.floating-navbar .header-inner')!,
              ),
              layers,
              canvasProgress: Number(canvas.dataset.sceneProgress),
              ariaHidden: canvas.getAttribute('aria-hidden'),
            };
          }, requested);
          expect(Math.abs(sample.progress - requested)).toBeLessThanOrEqual(
            16 / duration + 0.00001,
          );
          expect(sample.canvasProgress).toBe(sample.progress);
          expect(sample.matrix).toEqual([
            1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1,
          ]);
          expect(sample.face).toBe('none');
          expect(sample.perspective).toBe('none');
          expect(sample.ariaHidden).toBe('true');
          expect(sample.layers).toHaveLength(2);
          for (const layer of sample.layers) {
            expect(layer.progress).toBe(sample.progress);
            expect(layer.dataProgress).toBe(sample.progress);
            expect(layer.maskProgress).toBeCloseTo(
              sample.progress ** 2 * (3 - 2 * sample.progress),
              6,
            );
            expect(layer.pointer).toBe('none');
            expect(layer.gradient).toContain('gradient(');
            expect(layer.pixels).toBeGreaterThan(0);
            expect(layer.businessNodes).toBe(0);
          }
          const source = sample.layers.find(
              (layer) => layer.role === 'source',
            )!,
            dest = sample.layers.find((layer) => layer.role === 'destination')!;
          expect(source.theme).toBe(previous);
          expect(dest.theme).toBe(destination);
          expect(source.gradient).not.toBe(dest.gradient);
          expect(source.gradient).toBe(original.sourceGradient);
          if (requested > 0 && requested < 1) {
            const stops = [...dest.mask.matchAll(/(-?[\d.]+)%/g)].map((match) =>
              Number(match[1]),
            );
            expect(stops.length).toBeGreaterThanOrEqual(2);
            expect(stops[0]).toBeLessThan(100);
            expect(stops.at(-1)!).toBeGreaterThan(0);
          }
          expect(sample.theme).toBe(
            sample.progress < handoff ? previous : destination,
          );
          if (requested === Number(handoff.toFixed(10))) {
            expect(sample.carrier.right).toBeLessThan(0);
            expect(sample.carrier.top).toBeGreaterThan(900);
          }
          const delta = {
            x: sample.groups.heading.x - original.groups.heading.x,
            y: sample.groups.heading.y - original.groups.heading.y,
          };
          for (const [name, before] of Object.entries(original.groups)) {
            if (!before.width || !before.height) continue;
            const moved = sample.groups[name];
            expect(moved.x - before.x, name).toBeCloseTo(delta.x, 1);
            expect(moved.y - before.y, name).toBeCloseTo(delta.y, 1);
            expect(moved.width, name).toBeCloseTo(before.width, 1);
            expect(moved.height, name).toBeCloseTo(before.height, 1);
          }
          for (const key of ['x', 'y', 'width', 'height'] as const)
            expect(sample.nav[key]).toBeCloseTo(original.nav[key], 1);
          if (
            process.env.EDUFLOW_CAPTURE_VISUALS === '1' &&
            (width === 320 || width === 1440) &&
            (requested === 0.35 || requested === 0.7)
          )
            await page.screenshot({
              path: testInfo.outputPath(
                `${path === '/' ? 'home' : 'catalog'}-${width}-${destination}-p${requested}.png`,
              ),
            });
          samples.push({ requested, ...sample });
        }
        const exits = (await audit(page)).exits.filter(
          (exit) => exit.id === id && exit.theme === previous,
        );
        expect(exits.length).toBeGreaterThan(0);
        const final = await wrapper.evaluate((element) => {
          const section = element.closest('.landing-hero,.catalog-hero')!,
            shell = element.closest('.catalog-shell,.product-shell')!;
          return {
            styles: [
              document.getElementById('root')!,
              shell,
              section,
              element,
              element.querySelector('[data-hero-carrier]')!,
              ...section.querySelectorAll(
                ':scope > .catalog-hero-pixels, :scope > .atmosphere-decoration',
              ),
            ].map((node) => node.getAttribute('style') ?? ''),
            gradient: getComputedStyle(section).backgroundImage,
            groups: Object.fromEntries(
              Object.entries({
                heading: 'h1',
                subtitle: '.landing-description,.catalog-hero-description',
                cta: 'a.button',
                art: '.landing-art,.catalog-sculpture',
              }).map(([key, selector]) => {
                const b = element
                  .querySelector(selector)!
                  .getBoundingClientRect();
                return [
                  key,
                  { x: b.x, y: b.y, width: b.width, height: b.height },
                ];
              }),
            ),
          };
        });
        expect(final.styles).toEqual(original.styles);
        const counts = await wrapper.evaluate((element) => {
          const section = element.closest('.landing-hero,.catalog-hero')!;
          return [
            document.getElementById('root')!,
            element.closest('.catalog-shell,.product-shell')!,
            section,
            element,
            element.querySelector('[data-hero-carrier]')!,
            ...section.querySelectorAll(
              ':scope > .catalog-hero-pixels, :scope > .atmosphere-decoration',
            ),
          ].map((node) => (node as HTMLElement).style.length);
        });
        final.styles.forEach((text, index) => {
          if (text === '') expect(counts[index]).toBe(0);
        });
        for (const [name, before] of Object.entries(original.groups))
          for (const key of ['x', 'y', 'width', 'height'] as const)
            expect(final.groups[name][key]).toBeCloseTo(before[key], 1);
        const middle = samples.find((sample) => sample.requested === 0.5)!;
        if ('layers' in middle)
          expect(final.gradient).toBe(
            middle.layers.find((layer) => layer.role === 'destination')!
              .gradient,
          );
        expect((await audit(page)).nativeCalls).toBe(0);
        records.push({ width, destination, samples, exits });
      }
    }
    await testInfo.attach('one-progress-hero-and-atmosphere', {
      body: JSON.stringify(records, null, 2),
      contentType: 'application/json',
    });
  });
}

test('System, same-effective choices and reduced motion avoid unnecessary or lingering hero animation', async ({
  page,
}) => {
  await initializeAudit(page, 'light');
  await page.emulateMedia({
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
  await page.goto('/courses');
  await expect(page.locator('[data-theme-hero]')).toBeVisible();
  await chooseTheme(page, 'system');
  await settled(page);
  expect((await audit(page)).events).toHaveLength(0);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('[data-hero-orbit]')).toHaveAttribute(
    'data-hero-orbit',
    'sunset',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settled(page);
  await chooseTheme(page, 'light');
  await settled(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('eduflow-theme'))).toBe(
    'light',
  );
});

test('an offscreen hero or a route without a hero changes palette immediately', async ({
  page,
}) => {
  await initializeAudit(page);
  await page.goto('/courses');
  await expect(page.locator('[data-theme-hero]')).toBeVisible();
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }),
  );
  expect(
    await page
      .locator('[data-theme-hero]')
      .evaluate((element) => element.getBoundingClientRect().bottom),
  ).toBeLessThanOrEqual(0);
  await chooseTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settled(page);
  expect((await audit(page)).events).toEqual([]);
  await page.goto('/login');
  await expect(page.locator('.auth-card')).toBeVisible();
  await chooseTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await settled(page);
  expect((await audit(page)).events).toEqual([]);
  await page.goto('/courses');
  await expect(page.locator('[data-theme-hero=catalog]')).toBeVisible();
  await chooseTheme(page, 'dark');
  await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(1);
  await page.getByRole('link', { name: 'EduFlow home', exact: true }).click();
  await expect(page.locator('[data-theme-hero=home]')).toBeVisible();
  await settled(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await audit(page)).events).toHaveLength(1);
});

test('rapid reversal cancels stale work before and after the handoff', async ({
  page,
}) => {
  await initializeAudit(page);
  await page.goto('/courses');
  await expect(page.locator('[data-theme-hero]')).toBeVisible();
  await chooseTheme(page, 'dark');
  await chooseTheme(page, 'light');
  await settled(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await chooseTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await chooseTheme(page, 'light');
  await expect(page.locator('[data-hero-orbit]')).toHaveAttribute(
    'data-hero-orbit',
    'sunrise',
  );
  await settled(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('the shared progress scene does not depend on Web Animations support', async ({
  page,
}) => {
  await initializeAudit(page);
  await page.addInitScript(() =>
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: undefined,
    }),
  );
  await page.goto('/courses');
  await expect(page.locator('[data-theme-hero]')).toBeVisible();
  await chooseTheme(page, 'dark');
  await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(1);
  await settled(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('a renderer failure restores all original foreground and atmosphere styles without orphaned layers', async ({
  page,
}) => {
  await initializeAudit(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const set = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (
      property,
      value,
      priority,
    ) {
      if (property === '--hero-scene-progress')
        throw new Error('Isolated renderer failure');
      return Reflect.apply(set, this, [property, value, priority]);
    };
  });
  await page.goto('/courses');
  await expect(page.locator('[data-theme-hero]')).toBeVisible();
  await chooseTheme(page, 'dark');
  await settled(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('ISOLATED UI FIXTURE actual catalog orbit preserves focused filter values, DOM identity, scroll, session and cached requests', async ({
  page,
}) => {
  const fixture = await installUiFixtures(page, 'instructor');
  await page.emulateMedia({ colorScheme: 'light' });
  await initializeAudit(page, 'system');
  await page.goto('/courses');
  const search = page.getByRole('textbox', { name: 'Search courses' });
  await expect(search).toBeVisible();
  await expect(page.locator('.avatar')).toHaveText('FI');
  await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(2);
  // Automatic search is approved: settle that request before measuring whether
  // the theme scene itself causes additional catalog or authentication work.
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/v1/courses' &&
      url.searchParams.get('search') === '[Fixture] Automatic filter'
    );
  });
  await search.fill('[Fixture] Automatic filter');
  await filtered;
  await expect(page.locator('.catalog-result-count')).toHaveText(
    '2 courses match your filters',
  );
  await search.evaluate((element) => {
    Object.assign(window, { __preservedInput: element });
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  const beforeScroll = await page.evaluate(() => scrollY),
    beforeRequests = fixture.requests.length;
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('[data-hero-orbit]')).toHaveAttribute(
    'data-hero-orbit',
    'sunset',
  );
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('[Fixture] Automatic filter');
  expect(
    await search.evaluate(
      (element) =>
        element ===
        (window as unknown as { __preservedInput: Element }).__preservedInput,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(beforeScroll);
  await settled(page);
  expect(fixture.requests).toHaveLength(beforeRequests);
  await expect(page.locator('.avatar')).toHaveText('FI');
  await page.goto(`/instructor/courses/${fixtureCourseId}/edit`);
  const title = page.getByLabel('Course title', { exact: true });
  await title.fill('[Fixture] Unsaved title');
  const requests = fixture.requests.length;
  await title.focus();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(title).toBeFocused();
  await expect(title).toHaveValue('[Fixture] Unsaved title');
  expect(fixture.requests).toHaveLength(requests);
  expect(fixture.unexpected).toEqual([]);
  await settled(page);
});

test('head bootstrap resolves saved, invalid and blocked storage preferences without loading React', async ({
  browser,
}, testInfo) => {
  for (const scenario of [
    { saved: 'light', os: 'dark', expected: 'light' },
    { saved: 'dark', os: 'light', expected: 'dark' },
    { saved: 'system', os: 'dark', expected: 'dark' },
    { saved: 'invalid-value', os: 'dark', expected: 'dark' },
    { saved: 'light', os: 'dark', expected: 'dark', blocked: true },
  ] as const) {
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      colorScheme: scenario.os,
    });
    const page = await context.newPage();
    let intercepted = 0;
    await page.route(/\/src\/main\.tsx(?:\?.*)?$/, (route) => {
      intercepted++;
      return route.abort();
    });
    await page.addInitScript(
      ({ saved, blocked }) => {
        localStorage.setItem('eduflow-theme', saved);
        if (blocked)
          Object.defineProperty(Storage.prototype, 'getItem', {
            configurable: true,
            value: () => {
              throw new Error('Storage blocked for this test');
            },
          });
      },
      { saved: scenario.saved, blocked: 'blocked' in scenario },
    );
    await page.goto('/');
    expect(intercepted).toBeGreaterThan(0);
    await expect(page.locator('#root')).toBeEmpty();
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      scenario.expected,
    );
    await expect(page.locator('html')).toHaveCSS(
      'color-scheme',
      scenario.expected,
    );
    if (process.env.EDUFLOW_CAPTURE_VISUALS === '1')
      await page.screenshot({
        path: testInfo.outputPath(
          `head-only-${scenario.saved}-${'blocked' in scenario ? 'blocked' : 'available'}.png`,
        ),
      });
    await page.reload();
    await expect(page.locator('#root')).toBeEmpty();
    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      scenario.expected,
    );
    await context.close();
  }
});
