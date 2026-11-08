import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { chooseTheme } from './theme';

type Account = { email: string; password: string };
type Course = { id: string; slug: string; title: string };
const fixturePath = process.env.EDUFLOW_E2E_FIXTURE_FILE;
const fixtures: {
  student: Account;
  instructor: Account;
  admin: Account;
  course: Course;
  draft: Course;
} | null = fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;
test.skip(
  !fixtures,
  'Requires private accounts on the isolated real EduFlow API.',
);

async function login(page: Page, account: Account) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Account menu')).toBeVisible();
}

async function auditResponsive(
  page: Page,
  path: string,
  options: { account?: boolean; dialog?: boolean } = {},
) {
  await page.goto(path);
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1 }),
  ).toBeVisible();
  const expectsStats =
    ['/learning', '/instructor', '/admin'].includes(path) ||
    /^\/(instructor|admin)\/courses\/[0-9a-f-]{36}(?:\/students)?$/.test(path);
  if (expectsStats)
    await expect(page.locator('.stat strong').first()).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await chooseTheme(page, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${path}: ${width}px ${theme} has horizontal overflow`,
      ).toBe(true);
      const statistics = await page.locator('.stat').evaluateAll((cards) =>
        cards.map((card) => {
          const bounds = card.getBoundingClientRect();
          const value = card.querySelector('strong');
          const icon = card.querySelector('.stat-symbol');
          const label = card.querySelector(':scope > span');
          const valueBounds = value?.getBoundingClientRect();
          const iconBounds = icon?.getBoundingClientRect();
          const overlaps = (a: DOMRect, b: DOMRect) =>
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
          const contained = (box: DOMRect) =>
            box.left >= bounds.left - 0.5 &&
            box.right <= bounds.right + 0.5 &&
            box.top >= bounds.top - 0.5 &&
            box.bottom <= bounds.bottom + 0.5;
          const labelRange = document.createRange();
          if (label) labelRange.selectNodeContents(label);
          const labelTextBounds = label
            ? Array.from(labelRange.getClientRects())
            : [];
          return {
            label: label?.textContent?.trim(),
            value: value?.textContent?.trim(),
            valueOverlapsIcon:
              !!valueBounds &&
              !!iconBounds &&
              overlaps(valueBounds, iconBounds),
            labelOverlapsIcon:
              !!iconBounds &&
              labelTextBounds.some((box) => overlaps(box, iconBounds)),
            contentFitsCard:
              !!valueBounds &&
              contained(valueBounds) &&
              labelTextBounds.every(contained),
          };
        }),
      );
      if (expectsStats) expect(statistics.length).toBeGreaterThan(0);
      for (const stat of statistics) {
        const context = `${path}: ${stat.label} at ${width}px ${theme}`;
        expect(
          stat.value,
          `${context} must retain its actual numeric value`,
        ).toMatch(/^\d+(?:\.\d+)?%?$/);
        expect(
          stat.valueOverlapsIcon,
          `${context} numeric value overlaps its icon`,
        ).toBe(false);
        expect(
          stat.labelOverlapsIcon,
          `${context} label text overlaps its icon`,
        ).toBe(false);
        expect(
          stat.contentFitsCard,
          `${context} content overflows its statistic card`,
        ).toBe(true);
      }
      for (const landmark of [
        page.getByRole('banner'),
        page.getByRole('main'),
      ]) {
        const bounds = await landmark.boundingBox();
        expect(
          bounds,
          `${path}: missing landmark at ${width}px ${theme}`,
        ).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(-1);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      }
      const trigger = page.getByRole('button', {
        name: 'Color theme',
        exact: true,
      });
      await trigger.click();
      const menu = page.getByRole('menu', { name: 'Color theme', exact: true });
      const bounds = await menu.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(8);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width - 8);
      await expect(
        page.getByRole('menuitemradio', {
          name: theme === 'light' ? 'Light' : 'Dark',
          exact: true,
        }),
      ).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      const mobileTrigger = page.getByRole('button', {
        name: 'Open navigation',
        exact: true,
      });
      const authPage = path === '/login' || path === '/register';
      if (authPage) {
        await expect(
          page
            .getByRole('navigation', { name: 'Authentication navigation' })
            .getByRole('link', { name: 'Back to Home', exact: true }),
        ).toHaveAttribute('href', '/');
        await expect(mobileTrigger).toHaveCount(0);
      } else if (width <= 375) await expect(mobileTrigger).toBeVisible();
      if (await mobileTrigger.isVisible()) {
        await mobileTrigger.click();
        const mobileNav = page.getByRole('navigation', {
          name: 'Mobile navigation',
        });
        await expect(mobileNav).toBeVisible();
        if (options.account)
          await expect(
            mobileNav.getByRole('link', {
              name: 'Go to workspace',
              exact: true,
            }),
          ).toBeVisible();
        else {
          await expect(
            mobileNav.getByRole('link', { name: 'Sign in', exact: true }),
          ).toHaveAttribute('href', '/login');
          await expect(
            mobileNav.getByRole('link', { name: 'Get Started', exact: true }),
          ).toHaveAttribute('href', '/register');
        }
        await mobileNav.locator('a').first().focus();
        await page.keyboard.press('Escape');
        await expect(mobileTrigger).toBeFocused();
      }
      if (options.account) {
        const account = page.getByLabel('Account menu');
        await account.click();
        const panel = await page.locator('.account-panel').boundingBox();
        expect(
          panel!.x,
          `${path}: account panel clips left at ${width}px ${theme}`,
        ).toBeGreaterThanOrEqual(8);
        expect(
          panel!.x + panel!.width,
          `${path}: account panel clips right at ${width}px ${theme}`,
        ).toBeLessThanOrEqual(width - 8);
        await page
          .getByRole('button', { name: 'Sign out', exact: true })
          .focus();
        await page.keyboard.press('Escape');
        await expect(account).toBeFocused();
      }
      if (options.dialog) {
        await page
          .getByRole('button', { name: /^(Publish course|Unpublish course)$/ })
          .click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(8);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width - 8);
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click();
      }
    }
  }
}

test('public landing, auth and real course details fit both themes at all supported widths', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const f = fixtures!;
  for (const path of ['/', '/login', '/register', `/courses/${f.course.slug}`])
    await auditResponsive(page, path);
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1 }),
  ).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await page
    .getByRole('button', { name: 'Open navigation', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Mobile navigation' })
    .getByRole('link', { name: 'Sign in', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back.', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Create an account', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Create your account', exact: true }),
  ).toBeVisible();
});

test('System follows emulated OS preference while explicit choice and Tab focus remain stable', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/login');
  await chooseTheme(page, 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await chooseTheme(page, 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const trigger = page.getByRole('button', {
    name: 'Color theme',
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Email address', exact: true }),
  ).toBeFocused();
});

test('student dashboard and enrolled classroom remain usable across themes and widths', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const f = fixtures!;
  await login(page, f.student);
  await page.goto(`/courses/${f.course.slug}`);
  await page
    .getByRole('button', { name: 'Enroll and start learning', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/learn/${f.course.id}`));
  for (const path of ['/learning', `/learn/${f.course.id}`])
    await auditResponsive(page, path, { account: true });
  await expect(
    page.getByRole('button', { name: /^Mark as (complete|incomplete)$/ }),
  ).toBeVisible();
});

test('instructor overview, management, editor and curriculum fit responsive layouts and dialogs', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const f = fixtures!;
  await login(page, f.instructor);
  for (const path of [
    '/instructor',
    '/instructor/courses',
    '/instructor/courses/new',
    `/instructor/courses/${f.course.id}`,
    `/instructor/courses/${f.course.id}/edit`,
    `/instructor/courses/${f.course.id}/curriculum`,
    `/instructor/courses/${f.course.id}/students`,
  ]) {
    await auditResponsive(page, path, {
      account: true,
      dialog: path === `/instructor/courses/${f.course.id}`,
    });
  }
});

test('administrator overview, moderation list and confirmation dialog fit both themes', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const f = fixtures!;
  await login(page, f.admin);
  for (const path of [
    '/admin',
    '/admin/courses',
    `/admin/courses/${f.draft.id}`,
  ]) {
    await auditResponsive(page, path, {
      account: true,
      dialog: path === `/admin/courses/${f.draft.id}`,
    });
  }
});
