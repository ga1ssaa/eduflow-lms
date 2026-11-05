import { readFileSync } from 'node:fs';
import { test, expect, type Page, type Response } from '@playwright/test';
import { chooseTheme } from './theme';

const fixturePath = process.env.EDUFLOW_E2E_FIXTURE_FILE;
const fixtures: {
  catalog?: { category: string; search: string; total: number };
} | null = fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;
test.skip(
  !fixtures?.catalog,
  'Requires the isolated real-API catalog fixture dataset.',
);

function catalogResponse(response: Response, page: number, level?: string) {
  const url = new URL(response.url());
  const fixture = fixtures!.catalog!;
  return (
    url.pathname === '/api/v1/courses' &&
    url.searchParams.get('page') === String(page) &&
    url.searchParams.get('page_size') === '9' &&
    url.searchParams.get('search') === fixture.search &&
    url.searchParams.get('category') === fixture.category &&
    (level === undefined || url.searchParams.get('level') === level)
  );
}

async function openCatalog(page: Page) {
  const fixture = fixtures!.catalog!;
  const loaded = page.waitForResponse(
    async (response) =>
      catalogResponse(response, 1) && (await response.finished()) === null,
  );
  await page.goto(
    `/courses?${new URLSearchParams({ search: fixture.search, category: fixture.category })}`,
  );
  const response = await loaded;
  expect(response.status()).toBe(200);
  await expect(page.locator('.catalog-course-card')).toHaveCount(9);
  return response;
}

test('real catalog loads a limited first page, appends unique courses and resets pagination with preserved filters', async ({
  page,
}) => {
  const fixture = fixtures!.catalog!;
  const first = await openCatalog(page);
  expect((await first.json()).items).toHaveLength(9);
  await expect(
    page.getByText(`${fixture.total} courses available`, { exact: true }),
  ).toBeVisible();
  const nextPage = page.waitForResponse((response) =>
    catalogResponse(response, 2),
  );
  await page.locator('.catalog-sentinel').scrollIntoViewIfNeeded();
  const second = await nextPage;
  expect(second.status()).toBe(200);
  await expect(page.locator('.catalog-course-card')).toHaveCount(fixture.total);
  const hrefs = await page
    .locator('.catalog-course-card h3 a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
  expect(new Set(hrefs).size).toBe(fixture.total);

  await page
    .getByRole('combobox', { name: 'Level', exact: true })
    .selectOption('beginner');
  const reset = page.waitForResponse((response) =>
    catalogResponse(response, 1, 'beginner'),
  );
  await page.getByRole('button', { name: 'Find courses', exact: true }).click();
  expect((await reset).status()).toBe(200);
  await expect(page.locator('.catalog-course-card')).toHaveCount(9);
  await expect(page.getByLabel('Search courses', { exact: true })).toHaveValue(
    fixture.search,
  );
  await expect(page.getByLabel('Category', { exact: true })).toHaveValue(
    fixture.category,
  );
  await expect(
    page.getByRole('combobox', { name: 'Level', exact: true }),
  ).toHaveValue('beginner');
  const url = new URL(page.url());
  expect(url.searchParams.get('search')).toBe(fixture.search);
  expect(url.searchParams.get('category')).toBe(fixture.category);
  expect(url.searchParams.get('level')).toBe('beginner');
  expect(url.searchParams.has('page')).toBe(false);

  await page
    .getByLabel('Search courses', { exact: true })
    .fill(`absent-${crypto.randomUUID()}`);
  await page.getByRole('button', { name: 'Find courses', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'No courses found' }),
  ).toBeVisible();
  await expect(page.locator('.catalog-course-card')).toHaveCount(0);
  await expect(
    page.getByText('0 courses available', { exact: true }),
  ).toBeVisible();
});

test('catalog supports both themes, responsive widths, compact navigation and keyboard dismissal', async ({
  page,
}) => {
  await openCatalog(page);
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await chooseTheme(page, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
  const header = page.locator('.catalog-page-header');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(header).not.toHaveClass(/is-compact/);
  await page.evaluate(() => window.scrollTo(0, 160));
  await expect(header).toHaveClass(/is-compact/);
  const menu = page.getByRole('button', {
    name: 'Open navigation',
    exact: true,
  });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('navigation', { name: 'Mobile navigation' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('navigation', { name: 'Mobile navigation' }),
  ).toHaveCount(0);
});

test('reduced-motion catalog keeps its cards visible and usable', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openCatalog(page);
  const first = page.locator('.catalog-course-card').first();
  await expect(first).toBeVisible();
  await expect(first).toHaveCSS('opacity', '1');
  const link = first.locator('h3 a');
  const href = await link.getAttribute('href');
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
