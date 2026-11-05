import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  fixtureCourseId,
  fixtureCourseSlug,
  installUiFixtures,
  type UiFixtureRole,
} from './fixtures/atmosphere.ts';
import { chooseTheme } from './theme';

const widths = [320, 375, 768, 1024, 1440];
const accent = (theme: string) =>
  theme === 'light' ? 'rgb(253, 145, 204)' : 'rgb(252, 115, 77)';
const primarySelector = [
  '.button.primary',
  '.button.accent',
  '.navbar-start',
  '.catalog-teach-action',
  '.catalog-loadmore > .button',
  '.catalog-shell .error .button.secondary',
  '.learning-hero-action',
  '.learning-card-bottom .button.secondary',
]
  .map((selector) => `${selector}:visible`)
  .join(',');

// Measures solid rendered backgrounds, compositing transparent ancestors.
// Gradients are explicitly reported as unmeasured, never assumed to be a flat color.
async function contrast(element: Locator, parentBackground = false) {
  const sample = await element.evaluate((node, useParent) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const rgba = (css: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((v) => v / 255);
    };
    const layers: number[][] = [];
    let current: Element | null = useParent ? node.parentElement : node;
    let reason: string | null = null;
    while (current) {
      const style = getComputedStyle(current);
      if (style.backgroundImage !== 'none') {
        reason = 'Gradient/image requires pixel-background inspection';
        break;
      }
      const color = rgba(style.backgroundColor);
      layers.push(color);
      if (color[3] === 1) break;
      current = current.parentElement;
    }
    if (!reason && layers.at(-1)?.[3] !== 1)
      reason = 'No opaque background found';
    const composite = (front: number[], back: number[]) => [
      ...front
        .slice(0, 3)
        .map((v, i) => v * front[3] + back[i] * (1 - front[3])),
      1,
    ];
    let background = [1, 1, 1, 1];
    for (const layer of layers.reverse())
      background = composite(layer, background);
    const style = getComputedStyle(node);
    const foreground = composite(
      rgba(useParent ? style.outlineColor : style.color),
      background,
    );
    const luminance = (color: number[]) =>
      color
        .slice(0, 3)
        .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const brightness = style.filter.match(/^brightness\(([\d.]+)\)$/);
    if (style.filter !== 'none' && !brightness)
      reason = `Unsupported color filter: ${style.filter}`;
    const filtered = (color: number[]) =>
      brightness && !useParent
        ? color.map((value, index) =>
            index < 3 ? Math.min(1, value * Number(brightness[1])) : value,
          )
        : color;
    const light = luminance(filtered(foreground)),
      dark = luminance(filtered(background));
    return {
      path: location.pathname,
      width: innerWidth,
      theme: document.documentElement.dataset.theme,
      text: node.textContent?.trim().slice(0, 70),
      color: style.color,
      background: style.backgroundColor,
      ratio: reason
        ? null
        : (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
      reason,
      opacity: style.opacity,
      filter: style.filter,
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
    };
  }, parentBackground);
  if (!parentBackground && sample.reason?.startsWith('Gradient/image')) {
    await element.scrollIntoViewIfNeeded();
    const original = await element.evaluate((node) => {
      const style = (node as HTMLElement).style;
      const previous = {
        value: style.getPropertyValue('color'),
        priority: style.getPropertyPriority('color'),
      };
      style.setProperty('color', 'transparent', 'important');
      return previous;
    });
    let pixels: Buffer;
    try {
      pixels = await element.screenshot({
        animations: 'disabled',
        scale: 'css',
      });
    } finally {
      await element.evaluate((node, previous) => {
        const style = (node as HTMLElement).style;
        if (previous.value)
          style.setProperty('color', previous.value, previous.priority);
        else style.removeProperty('color');
      }, original);
    }
    const measured = await element.evaluate(
      async (node, input) => {
        const image = await createImageBitmap(
          new Blob([new Uint8Array(input.png)], { type: 'image/png' }),
        );
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const background = context.getImageData(
          0,
          0,
          image.width,
          image.height,
        ).data;
        context.clearRect(0, 0, image.width, image.height);
        context.fillStyle = input.foreground;
        context.fillRect(0, 0, 1, 1);
        const foreground = [...context.getImageData(0, 0, 1, 1).data].map(
          (v) => v / 255,
        );
        const luminance = (rgb: number[]) =>
          rgb
            .slice(0, 3)
            .map((v) =>
              v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
            )
            .reduce(
              (sum, value, index) =>
                sum + value * [0.2126, 0.7152, 0.0722][index],
              0,
            );
        const box = node.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(node);
        let minimum = Infinity,
          count = 0;
        for (const rect of range.getClientRects()) {
          for (
            let y = Math.max(0, Math.ceil(rect.top - box.top));
            y < Math.min(image.height, rect.bottom - box.top);
            y++
          ) {
            for (
              let x = Math.max(0, Math.ceil(rect.left - box.left));
              x < Math.min(image.width, rect.right - box.left);
              x++
            ) {
              const index = (y * image.width + x) * 4;
              const bg = [...background.slice(index, index + 3)].map(
                (v) => v / 255,
              );
              const fg = foreground
                .slice(0, 3)
                .map((v, i) => v * foreground[3] + bg[i] * (1 - foreground[3]));
              const a = luminance(fg),
                b = luminance(bg);
              minimum = Math.min(
                minimum,
                (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
              );
              count++;
            }
          }
        }
        image.close();
        return { ratio: count ? minimum : null, count };
      },
      { png: [...pixels], foreground: sample.color },
    );
    return {
      ...sample,
      ratio: measured.ratio,
      reason: measured.count
        ? null
        : 'No rendered text-background pixels measured',
      method:
        'Minimum rendered screenshot background contrast across text ranges; text temporarily transparent in test only',
    };
  }
  return sample;
}

async function auditPrimary(page: Page, theme: string) {
  const reports = [];
  const actions = page.locator(primarySelector);
  expect(await actions.count()).toBeGreaterThan(0);
  for (const action of await actions.all()) {
    await expect(action).toHaveCSS('background-color', accent(theme));
    await expect(action).toHaveCSS('color', 'rgb(2, 7, 10)');
    const sample = await contrast(action);
    const disabled = await action.isDisabled();
    reports.push({ ...sample, disabled });
    if (disabled) {
      expect(parseFloat(sample.opacity)).toBeLessThan(1);
    } else {
      expect(sample.reason, JSON.stringify(sample)).toBeNull();
      expect(sample.ratio!, JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
    }
  }
  for (const supporting of await page
    .locator('.badge:visible, .surface a.text-link:visible')
    .all()) {
    const sample = await contrast(supporting);
    reports.push({ ...sample, disabled: false });
    expect(sample.reason, JSON.stringify(sample)).toBeNull();
    expect(sample.ratio!, JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  return reports;
}

async function anonymousFixtures(page: Page) {
  const fixture = await installUiFixtures(page, 'student');
  await page.route('**/api/v1/auth/refresh', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Not authenticated' }),
    }),
  );
  return fixture;
}

for (const [role, paths] of [
  [
    'public',
    ['/', '/courses', '/login', '/register', `/courses/${fixtureCourseSlug}`],
  ],
  [
    'student',
    ['/learning', `/courses/${fixtureCourseSlug}`, `/learn/${fixtureCourseId}`],
  ],
  [
    'instructor',
    [
      '/instructor',
      '/instructor/courses/new',
      `/instructor/courses/${fixtureCourseId}/edit`,
      `/instructor/courses/${fixtureCourseId}`,
      '/instructor/courses/60000000-0000-4000-8000-000000000012',
    ],
  ],
  [
    'admin',
    [
      '/admin',
      `/admin/courses/${fixtureCourseId}`,
      '/admin/courses/60000000-0000-4000-8000-000000000012',
    ],
  ],
] as const) {
  test(`ISOLATED UI FIXTURE ${role}: primary actions retain accent and AA text across themes and widths`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const fixture =
      role === 'public'
        ? await anonymousFixtures(page)
        : await installUiFixtures(page, role as UiFixtureRole);
    const reports = [];
    for (const path of paths) {
      await page.goto(path);
      await expect(
        page.getByRole('main').getByRole('heading', { level: 1 }),
      ).toBeVisible();
      if (role === 'student' && path.startsWith('/learn/')) {
        await page
          .getByRole('button', {
            name: '[Fixture] Put your learning into practice',
            exact: true,
          })
          .click();
        await expect(
          page.getByRole('button', {
            name: 'Mark as complete',
            exact: true,
          }),
        ).toBeVisible();
      }
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 });
        for (const theme of ['light', 'dark']) {
          await chooseTheme(page, theme);
          if (
            role === 'public' &&
            ['/courses', '/login', '/register'].includes(path)
          ) {
            const catalog = path === '/courses';
            const art = page.locator(
              catalog ? '.catalog-teach-art' : '.auth-visual',
            );
            const panel = art.locator('span:nth-child(3)');
            await expect(panel).toHaveCSS(
              'background-color',
              theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(16, 26, 36)',
            );
            await expect(art.locator('svg')).toHaveCSS('color', accent(theme));
            await expect(panel).toHaveCSS('width', catalog ? '175px' : '126px');
            await expect(panel).toHaveCSS(
              'height',
              catalog ? '205px' : '150px',
            );
            await expect(panel).toHaveCSS('border-radius', '12px');
            if (await art.isVisible()) {
              await expect(panel).toHaveCSS(
                'transform',
                catalog
                  ? 'matrix(0.978148, 0.207912, -0.207912, 0.978148, 27.3881, 5.82153)'
                  : 'matrix(0.970296, 0.241922, -0.241922, 0.970296, 0, 0)',
              );
            } else {
              await expect(art).toBeHidden();
            }
            expect(await art.getAttribute('aria-hidden')).toBe('true');
          }
          reports.push({
            path,
            width,
            theme,
            actions: await auditPrimary(page, theme),
          });
          if (role === 'student' && path === '/learning') {
            for (const label of ['Continue learning', 'Review course']) {
              const link = page.getByRole('link', { name: label, exact: true });
              await link.hover();
              await expect(link).toHaveCSS('background-color', accent(theme));
              await expect(link).toHaveCSS('color', 'rgb(2, 7, 10)');
              const hover = await contrast(link);
              expect(hover.reason).toBeNull();
              expect(
                hover.ratio!,
                JSON.stringify(hover),
              ).toBeGreaterThanOrEqual(4.5);
              reports.push({
                path,
                width,
                theme,
                actions: [{ ...hover, disabled: false }],
              });
            }
          }
          // At compact widths the same CTA remains reachable in the mobile menu.
          if (width <= 540) {
            await page
              .getByRole('button', { name: 'Open navigation', exact: true })
              .click();
            await auditPrimary(page, theme);
            await page.keyboard.press('Escape');
          }
        }
      }
    }
    expect(fixture.unexpected).toEqual([]);
    await testInfo.attach(`${role}-solid-action-contrast`, {
      body: JSON.stringify(reports, null, 2),
      contentType: 'application/json',
    });
  });
}

test('ISOLATED UI FIXTURE destructive dialogs, error messages and keyboard focus retain semantic contrast', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await installUiFixtures(page, 'instructor');
  const reports = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/instructor/courses/60000000-0000-4000-8000-000000000012');
    await expect(
      page.getByRole('button', { name: 'Delete draft', exact: true }),
    ).toBeEnabled();
    for (const theme of ['light', 'dark']) {
      await chooseTheme(page, theme);
      await page
        .getByRole('button', { name: 'Delete draft', exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const destructive = dialog.getByRole('button', {
        name: 'Delete draft',
        exact: true,
      });
      const sample = await contrast(destructive);
      expect(sample.color).not.toBe(accent(theme));
      expect(sample.background).not.toBe(accent(theme));
      expect(sample.reason).toBeNull();
      expect(sample.ratio!, JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
      await page.keyboard.press('Tab');
      await destructive.focus();
      const focus = await contrast(destructive, true);
      expect(parseFloat(focus.outlineWidth)).toBeGreaterThanOrEqual(2);
      expect(focus.outlineStyle).toBe('solid');
      expect(focus.reason).toBeNull();
      expect(focus.ratio!, JSON.stringify(focus)).toBeGreaterThanOrEqual(3);
      reports.push({ width, theme, destructive: sample, focus });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  }
  await page.goto('/courses/fixture-missing-course');
  const error = page.locator('.error');
  await expect(error).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await chooseTheme(page, theme);
    const sample = await contrast(error);
    expect(sample.color).not.toBe(accent(theme));
    expect(sample.reason).toBeNull();
    expect(sample.ratio!, JSON.stringify(sample)).toBeGreaterThanOrEqual(4.5);
    reports.push({ theme, error: sample });
  }
  expect(fixture.unexpected).toEqual([]);
  await testInfo.attach('semantic-solid-contrast', {
    body: JSON.stringify(reports, null, 2),
    contentType: 'application/json',
  });
});

test('REAL READ-ONLY catalog illustration changes only surface and decorative arrow colors', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Approved pre-edit geometry, captured at viewport height 1000px.
  const baseline: Record<number, number[]> = {
    // CSS width, height, left, right; transformed x, y, width, height.
    320: [
      92.4688, 160, 89.75, 89.7812, 112.360847, 694.752136, 95.247047,
      161.589478,
    ],
    375: [
      111.172, 160, 107.906, 107.922, 130.518524, 610.385803, 113.947327,
      161.915894,
    ],
    768: [
      239.359, 220, 232.312, 232.328, 262.41095, 579.67804, 243.162476,
      224.143921,
    ],
    1024: [
      285.594, 220, 277.188, 277.219, 367.28949, 607.993347, 289.389771,
      224.950806,
    ],
    1440: [
      285.594, 220, 277.188, 277.219, 575.28949, 661.430847, 289.389771,
      224.950806,
    ],
  };
  const reports = [];
  await page.goto('/courses');
  const card = page.locator('.catalog-path-step.step-four');
  await expect(card).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await chooseTheme(page, theme);
      await page.evaluate(async () => {
        await document.fonts.ready;
        window.scrollTo(0, 0);
      });
      await expect(card).toHaveCSS(
        'background-color',
        theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(16, 26, 36)',
      );
      await expect(card.locator('svg')).toHaveCSS('color', accent(theme));
      const geometry = await card.evaluate((element) => {
        const style = getComputedStyle(element),
          rect = element.getBoundingClientRect();
        return {
          values: [
            parseFloat(style.width),
            parseFloat(style.height),
            parseFloat(style.left),
            parseFloat(style.right),
            rect.x,
            rect.y,
            rect.width,
            rect.height,
          ],
          transform: style.transform,
          radius: style.borderRadius,
          position: style.position,
          top: style.top,
          bottom: style.bottom,
          image: style.backgroundImage,
        };
      });
      geometry.values.forEach((value, index) =>
        expect(value, `${width}px ${theme} dimension ${index}`).toBeCloseTo(
          baseline[width][index],
          1,
        ),
      );
      expect(geometry.transform).toBe(
        'matrix(0.999848, 0.0174524, -0.0174524, 0.999848, 0, 0)',
      );
      expect(geometry.radius).toBe('12px');
      expect(geometry.position).toBe('absolute');
      expect(geometry.top).toBe('0px');
      expect(geometry.bottom).toBe('10px');
      expect(geometry.image).toBe('none');
      expect(
        await card.evaluate(
          (element) => element.closest('[aria-hidden="true"]') !== null,
        ),
      ).toBe(true);
      reports.push({
        width,
        theme,
        geometry,
        decorativeArrow: 'aria-hidden; decorative contrast exemption',
      });
    }
  }
  await testInfo.attach('central-card-pre-edit-geometry-comparison', {
    body: JSON.stringify(reports, null, 2),
    contentType: 'application/json',
  });
});
