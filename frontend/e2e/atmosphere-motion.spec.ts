import { test, expect, type Page } from '@playwright/test';
import {
  installUiFixtures,
  fixtureCourseId,
  type UiFixtureRole,
  installPublicUiFixtures,
} from './fixtures/atmosphere.ts';
import { chooseTheme } from './theme';

async function auditFixtureLayout(page: Page, path: string) {
  await page.goto(path);
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1 }),
  ).toBeVisible();
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await chooseTheme(page, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `FIXTURE ${path} ${width}px ${theme}: page overflow`,
      ).toBe(true);
      const capsule = (await page
        .locator('.floating-navbar .header-inner')
        .boundingBox())!;
      expect(capsule.x).toBeGreaterThanOrEqual(8);
      expect(capsule.x + capsule.width).toBeLessThanOrEqual(width - 8);
      const stats = await page.locator('.stat').evaluateAll((cards) =>
        cards.map((card) => {
          const value = card.querySelector('strong');
          const label = card.querySelector(
            ':scope > span, .learning-stat-top > span',
          );
          const icon = card
            .querySelector('.stat-symbol')
            ?.getBoundingClientRect();
          const number = value?.getBoundingClientRect();
          const range = document.createRange();
          if (label) range.selectNodeContents(label);
          const overlaps = (a: DOMRect, b: DOMRect) =>
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
          return {
            value: value?.textContent,
            valueOverlap: !!icon && !!number && overlaps(icon, number),
            labelOverlap:
              !!icon &&
              !!label &&
              Array.from(range.getClientRects()).some((box) =>
                overlaps(icon, box),
              ),
          };
        }),
      );
      for (const stat of stats) {
        expect(stat.value).toMatch(/^\d+(?:\.\d+)?%?$/);
        expect(
          stat.valueOverlap,
          `FIXTURE ${path} ${width}px ${theme}: stat value/icon overlap`,
        ).toBe(false);
        expect(
          stat.labelOverlap,
          `FIXTURE ${path} ${width}px ${theme}: stat label/icon overlap`,
        ).toBe(false);
      }
      expect(
        await page
          .getByRole('banner')
          .evaluate((header) => header.closest('[data-reveal]') === null),
      ).toBe(true);
      expect(
        await page
          .locator('main form')
          .evaluateAll((forms) =>
            forms.every(
              (form) =>
                !form.closest(
                  '[data-reveal-state="observed"], [data-reveal-state="revealing"]',
                ),
            ),
          ),
      ).toBe(true);
    }
  }
}

for (const [role, empty, paths] of [
  ['student', false, ['/learning', `/learn/${fixtureCourseId}`]],
  ['student', true, ['/learning']],
  [
    'instructor',
    false,
    [
      '/instructor',
      '/instructor/courses',
      '/instructor/courses/new',
      `/instructor/courses/${fixtureCourseId}`,
      `/instructor/courses/${fixtureCourseId}/edit`,
      `/instructor/courses/${fixtureCourseId}/curriculum`,
      `/instructor/courses/${fixtureCourseId}/students`,
    ],
  ],
  [
    'admin',
    false,
    ['/admin', '/admin/courses', `/admin/courses/${fixtureCourseId}`],
  ],
] as const) {
  test(`ISOLATED FIXTURE UI ${role} ${empty ? 'empty' : 'populated'} pages fit both themes and five widths`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    test.info().annotations.push({
      type: 'data-source',
      description:
        'Clearly labelled isolated API fixtures; not live authentication or production learner data.',
    });
    const fixture = await installUiFixtures(page, role as UiFixtureRole, empty);
    for (const path of paths) {
      await auditFixtureLayout(page, path);
      if (path === '/learning') {
        if (empty)
          await expect(
            page.getByRole('heading', {
              name: 'Your learning journey starts here',
            }),
          ).toBeVisible();
        else {
          await expect(
            page.getByRole('heading', {
              name: '[Fixture] Interface foundations',
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            page.getByText(
              'This course is currently unavailable. Your progress is saved.',
              { exact: true },
            ),
          ).toBeVisible();
        }
        expect(
          await page.locator('.learning-stat strong').allTextContents(),
        ).toEqual(empty ? ['0', '0', '0'] : ['3', '2', '1']);
      }
      if (path.startsWith('/learn/')) {
        await expect(
          page.getByText(
            '[Fixture] Learn through a small, focused example. This is isolated demonstration content.',
            { exact: true },
          ),
        ).toBeVisible();
        expect(
          await page
            .locator('.lesson-content, .lesson-text')
            .evaluateAll((elements) =>
              elements.every(
                (element) => element.closest('[data-reveal]') === null,
              ),
            ),
        ).toBe(true);
      }
    }
    expect(fixture.unexpected).toEqual([]);
  });
}

test('ISOLATED UI FIXTURE catalog keeps nine-item pages, appends unique cards and resets all filters', async ({
  page,
}) => {
  test.info().annotations.push({
    type: 'data-source',
    description:
      'Isolated public API fixtures exercise real UI pagination and filters; no live backend records or writes.',
  });
  const fixture = await installPublicUiFixtures(page);
  const first = fixture.courses[0];
  const pages: number[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/courses')
      pages.push(Number(url.searchParams.get('page')));
  });
  await page.goto('/courses');
  await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(9);
  await page.locator('.catalog-sentinel').scrollIntoViewIfNeeded();
  await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(18);
  const hrefs = await page
    .locator('.catalog-course-card h3 a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(new Set(hrefs).size).toBe(18);
  expect(pages.filter((page) => page === 2)).toHaveLength(1);
  const dynamicCard = page.locator('.catalog-course-card').nth(9);
  await expect(dynamicCard).toHaveAttribute(
    'data-reveal-state',
    /^(observed|revealing|revealed)$/,
  );
  expect(
    await dynamicCard.evaluate((element) =>
      (element as HTMLElement).style.getPropertyValue('--reveal-delay'),
    ),
  ).toBe('400ms');
  await page
    .getByRole('textbox', { name: 'Search courses', exact: true })
    .fill(first.title);
  await page
    .getByRole('textbox', { name: 'Category', exact: true })
    .fill(first.category);
  await page
    .getByRole('combobox', { name: 'Level', exact: true })
    .selectOption(first.level);
  const filtered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/v1/courses' &&
      url.searchParams.get('search') === first.title &&
      url.searchParams.get('page') === '1' &&
      url.searchParams.get('page_size') === '9'
    );
  });
  await page.getByRole('button', { name: 'Find courses', exact: true }).click();
  expect((await filtered).status()).toBe(200);
  const url = new URL(page.url());
  expect(url.searchParams.get('search')).toBe(first.title);
  expect(url.searchParams.get('category')).toBe(first.category);
  expect(url.searchParams.get('level')).toBe(first.level);
  expect(url.searchParams.has('page')).toBe(false);
  await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(1);
  await expect(page.locator('.catalog-course-card h3 a')).toHaveText(
    first.title,
  );
  expect(fixture.unexpected).toEqual([]);
});

test('ISOLATED UI FIXTURE catalog stays visible and manually paginates without IntersectionObserver', async ({
  page,
}) => {
  const fixture = await installPublicUiFixtures(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', {
      value: undefined,
      configurable: true,
    });
  });
  await page.goto('/courses');
  await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(9);
  await expect(page.locator('.catalog-course-card').first()).toHaveCSS(
    'opacity',
    '1',
  );
  await page
    .getByRole('button', { name: 'Load more courses', exact: true })
    .click();
  await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(18);
  await expect(page.locator('[data-reveal-state="revealing"]')).toHaveCount(0);
  expect(
    new Set(
      await page
        .locator('.catalog-course-card h3 a')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
    ).size,
  ).toBe(18);
  expect(fixture.unexpected).toEqual([]);
});

test('REAL Home below-fold content animates once with the shared 600ms, 24px entrance', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const target = page.locator('.landing-how > [data-reveal]').first();
  await expect(target).toHaveAttribute('data-reveal-state', 'observed');
  await expect(target).toHaveCSS('opacity', '1');
  expect(
    await target.evaluate(
      (element) => element.getBoundingClientRect().top > innerHeight,
    ),
  ).toBe(true);
  await target.evaluate((element) => {
    const target = element as HTMLElement;
    target.dataset.testAnimationCount = '0';
    target.addEventListener('animationstart', (event) => {
      if ((event as AnimationEvent).animationName !== 'scroll-reveal-enter')
        return;
      target.dataset.testAnimationCount = String(
        Number(target.dataset.testAnimationCount) + 1,
      );
      const animation = target
        .getAnimations()
        .find(
          (animation) =>
            (animation as CSSAnimation).animationName === 'scroll-reveal-enter',
        )!;
      const frames = (animation.effect as KeyframeEffect).getKeyframes();
      target.dataset.testMotion = JSON.stringify({
        duration: animation.effect!.getTiming().duration,
        easing: getComputedStyle(target).animationTimingFunction,
        fromOpacity: frames[0].opacity,
        toOpacity: frames.at(-1)!.opacity,
        fromY: new DOMMatrixReadOnly(String(frames[0].transform)).m42,
        toY: new DOMMatrixReadOnly(String(frames.at(-1)!.transform)).m42,
      });
    });
  });
  await target.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await expect(target).toHaveAttribute('data-test-motion', /duration/);
  const motion = JSON.parse((await target.getAttribute('data-test-motion'))!);
  expect(motion.duration).toBe(600);
  expect(motion.easing.replace(/\s/g, '')).toBe('cubic-bezier(0.22,1,0.36,1)');
  expect(Number(motion.fromOpacity)).toBe(0);
  expect(Number(motion.toOpacity)).toBe(1);
  expect(motion.fromY).toBe(24);
  expect(motion.toY).toBe(0);
  await expect(target).toHaveAttribute('data-reveal-state', 'revealed');
  await expect(target).toHaveCSS('animation-name', 'none');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await target.evaluate((element) =>
    element.scrollIntoView({ block: 'center', behavior: 'instant' }),
  );
  await expect(target).toHaveAttribute('data-test-animation-count', '1');
});

test('REAL Home respects initial and runtime reduced-motion preferences without fading content', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const target = page.locator('.landing-how > [data-reveal]').first();
  await expect(target).toHaveAttribute('data-reveal-state', 'revealed');
  await expect(target).toHaveCSS('animation-name', 'none');
  await expect(target).toHaveCSS('opacity', '1');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await expect(target).toHaveAttribute('data-reveal-state', 'observed');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(target).toHaveAttribute('data-reveal-state', 'revealed');
  await expect(
    page.locator('main [data-reveal-state="revealing"]'),
  ).toHaveCount(0);
});
