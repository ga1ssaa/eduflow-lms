import { test, expect, type Page } from '@playwright/test';
import { chooseTheme } from './theme';

// This suite uses existing public records only. It never registers, logs in,
// creates fixtures, or changes the database. Authenticated roles are unit-tested.
let courseSlug: string | undefined;
test.beforeAll(async ({ request }) => {
  const response = await request.get('/api/v1/courses?page=1&page_size=1');
  expect(response.status()).toBe(200);
  const body = await response.json();
  courseSlug = body.items[0]?.slug;
});

async function openPublic(page: Page, path: string) {
  await page.goto(path);
  const navbar = page.locator('.floating-navbar');
  await expect(navbar).toBeVisible();
  await expect(
    navbar.getByRole('link', {
      name: 'Get Started',
      exact: true,
      includeHidden: true,
    }),
  ).toBeAttached();
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  await expect(navbar).not.toHaveClass(/is-compact/);
  return navbar;
}

test('public routes share one centered three-zone capsule and collapse before controls overlap', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const paths = [
    '/',
    '/courses',
    '/login',
    '/register',
    ...(courseSlug ? [`/courses/${courseSlug}`] : []),
  ];
  if (!courseSlug)
    test.info().annotations.push({
      type: 'limitation',
      description:
        'The existing API has no published course; real course-detail navbar was unavailable.',
    });
  const reference = new Map<
    string,
    {
      x: number;
      y: number;
      width: number;
      height: number;
      radius: string;
      background: string;
    }
  >();
  for (const path of paths) {
    await openPublic(page, path);
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await chooseTheme(page, theme);
        await page.evaluate(() => window.scrollTo(0, 0));
        const navbar = page.locator('.floating-navbar');
        await expect(navbar).not.toHaveClass(/is-compact/);
        const capsule = navbar.locator('.header-inner');
        const box = (await capsule.boundingBox())!;
        expect(box.x, `${path} ${width}px ${theme}`).toBeGreaterThanOrEqual(8);
        expect(
          box.x + box.width,
          `${path} ${width}px ${theme}`,
        ).toBeLessThanOrEqual(width - 8);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        const styles = await capsule.evaluate((element) => ({
          display: getComputedStyle(element).display,
          columns: getComputedStyle(element)
            .gridTemplateColumns.split(' ')
            .map(Number.parseFloat),
          radius: getComputedStyle(element).borderRadius,
          background: getComputedStyle(element).backgroundColor,
        }));
        const signature = {
          ...box,
          radius: styles.radius,
          background: styles.background,
        };
        const key = `${width}-${theme}`;
        if (!reference.has(key)) reference.set(key, signature);
        else {
          const first = reference.get(key)!;
          for (const dimension of ['x', 'y', 'width', 'height'] as const)
            expect(
              signature[dimension],
              `${path}: navbar ${dimension} differs from home at ${key}`,
            ).toBeCloseTo(first[dimension], 1);
          expect(signature.radius).toBe(first.radius);
          expect(signature.background).toBe(first.background);
        }
        const mainNav = navbar.getByRole('navigation', {
          name: 'Main navigation',
          includeHidden: true,
        });
        expect(await mainNav.locator('a').allTextContents()).toEqual([
          'Home',
          'Explore Courses',
          'How It Works',
          'For Instructors',
          'About',
        ]);
        const toggle = navbar.getByRole('button', {
          name: 'Open navigation',
          exact: true,
        });
        if (width === 1440) {
          await expect(mainNav).toBeVisible();
          expect(styles.display).toBe('grid');
          expect(styles.columns).toHaveLength(3);
          expect(styles.columns[0]).toBeCloseTo(styles.columns[2], 1);
          const nav = (await mainNav.boundingBox())!;
          const brand = (await navbar.locator('.brand').boundingBox())!;
          const actions = (await navbar
            .locator('.header-actions')
            .boundingBox())!;
          expect(
            Math.abs(nav.x + nav.width / 2 - (box.x + box.width / 2)),
          ).toBeLessThanOrEqual(1);
          expect(brand.x + brand.width + 8).toBeLessThanOrEqual(nav.x);
          expect(nav.x + nav.width + 8).toBeLessThanOrEqual(actions.x);
          await expect(toggle).not.toBeVisible();
        } else {
          await expect(mainNav).not.toBeVisible();
          await expect(toggle).toBeVisible();
          await toggle.click();
          const menu = navbar.getByRole('navigation', {
            name: 'Mobile navigation',
          });
          const menuBox = (await menu.boundingBox())!;
          expect(menuBox.x).toBeGreaterThanOrEqual(8);
          expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width - 8);
          await expect(
            menu.getByRole('link', { name: 'Sign in', exact: true }),
          ).toHaveAttribute('href', '/login');
          await expect(
            menu.getByRole('link', { name: 'Get Started', exact: true }),
          ).toHaveAttribute('href', '/register');
          await menu.getByRole('link', { name: 'Home', exact: true }).focus();
          await page.keyboard.press('Escape');
          await expect(toggle).toBeFocused();
        }
        const signIn = navbar
          .getByRole('link', {
            name: 'Sign in',
            exact: true,
            includeHidden: true,
          })
          .first();
        if (await signIn.isVisible()) {
          await expect(signIn).toHaveCSS(
            'background-color',
            'rgb(255, 255, 255)',
          );
          await expect(signIn).toHaveCSS('color', 'rgb(9, 49, 141)');
        }
        const cta = navbar.locator('.catalog-start');
        if (await cta.isVisible())
          await expect(cta).toHaveCSS(
            'background-color',
            theme === 'light' ? 'rgb(253, 145, 204)' : 'rgb(252, 115, 77)',
          );
      }
    }
  }
});

test('shared catalog links preserve filters and Back remains inside router history', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const warnings: string[] = [];
  page.on('console', (event) => {
    if (/blocker/i.test(event.text()) && /\bPOP\b/.test(event.text()))
      warnings.push(event.text());
  });
  await openPublic(
    page,
    '/courses?search=Studio&category=Creative%20technology',
  );
  const mainNav = page
    .locator('.floating-navbar')
    .getByRole('navigation', { name: 'Main navigation' });
  for (const hash of [
    '#courses',
    '#how-it-works',
    '#for-instructors',
    '#about',
  ]) {
    await mainNav.locator(`a[href$="${hash}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
    const url = new URL(page.url());
    expect(url.searchParams.get('search')).toBe('Studio');
    expect(url.searchParams.get('category')).toBe('Creative technology');
  }
  await page.goBack();
  await expect(page).toHaveURL(/#for-instructors$/);
  expect(warnings).toEqual([]);
});

test('mobile outside dismissal and the reused theme menu preserve focus and real destinations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await openPublic(page, '/login');
  const navbar = page.locator('.floating-navbar');
  const toggle = navbar.getByRole('button', {
    name: 'Open navigation',
    exact: true,
  });
  await toggle.click();
  await page.getByLabel('Email address').click();
  await expect(
    navbar.getByRole('navigation', { name: 'Mobile navigation' }),
  ).toHaveCount(0);
  await expect(page.getByLabel('Email address')).toBeFocused();
  const theme = navbar.getByRole('button', {
    name: 'Color theme',
    exact: true,
  });
  await theme.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(theme).toBeFocused();
  await theme.click();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(toggle).toBeFocused();
  await toggle.click();
  await navbar
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Get Started', exact: true })
    .click();
  await expect(page).toHaveURL(/\/register$/);
});
