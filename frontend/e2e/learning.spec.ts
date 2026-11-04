import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

// Supply a private fixture file for a disposable eduflow_test_* database.
// Never record traces: authentication network responses contain access tokens.
const fixturePath = process.env.EDUFLOW_E2E_FIXTURE_FILE;
type Account = { email: string; password: string };
type Course = { id: string; slug: string; title: string };
const fixtures: {
  student: Account;
  instructor: Account;
  admin: Account;
  course: Course;
  draft: Course;
} | null = fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;
test.skip(
  !fixtures,
  'Requires an isolated API, private fixtures and running Vite proxy.',
);

async function login(page: Page, account: Account) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Account menu')).toBeVisible();
}

test('public registration creates a working student session', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('New Learner');
  await page
    .getByLabel('Email address')
    .fill(`browser-${crypto.randomUUID()}@example.com`);
  await page.getByLabel(/^Password/).fill(`Study-${crypto.randomUUID()}!`);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page.getByLabel('Account menu')).toBeVisible();
  await expect(page).toHaveURL(/\/learning$/);
  await expect(
    page.getByText('Your learning journey starts here'),
  ).toBeVisible();
});

test('catalog, cookie authentication, enrollment and completion use the real API', async ({
  page,
  context,
}) => {
  const f = fixtures!;
  await page.goto('/courses');
  await page.getByLabel('Search courses').fill(f.course.title);
  await page.getByRole('button', { name: 'Find courses' }).click();
  await page.locator(`h3 a[href="/courses/${f.course.slug}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/courses/${f.course.slug}$`));
  await expect(
    page.getByText('Private lesson 1.', { exact: false }),
  ).toHaveCount(0);
  await login(page, f.student);
  await page.goto(`/courses/${f.course.slug}`);
  await page.getByRole('button', { name: 'Enroll and start learning' }).click();
  await expect(page).toHaveURL(new RegExp(`/learn/${f.course.id}`));
  await expect(
    page.getByText('Private lesson 1.', { exact: false }),
  ).toBeVisible();
  if (
    await page.getByRole('button', { name: 'Mark as incomplete' }).isVisible()
  ) {
    await page.getByRole('button', { name: 'Mark as incomplete' }).click();
  }
  await page
    .getByRole('button', { name: 'Mark as complete', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Mark as incomplete' }),
  ).toBeVisible();
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/classroom.png', fullPage: true });
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Mark as incomplete' }),
  ).toBeVisible();
  const refresh = (await context.cookies()).find(
    (c) => c.name === 'eduflow_refresh',
  );
  expect(refresh?.httpOnly).toBe(true);
  expect(refresh?.path).toBe('/api/v1/auth');
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([
    'eduflow-theme',
  ]);
  await page.getByRole('button', { name: 'Mark as incomplete' }).click();
  await expect(page.getByText('0%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next lesson' }).click();
  await expect(
    page.getByText('Private lesson 2.', { exact: false }),
  ).toBeVisible();
  await page.goto('/admin/courses');
  await expect(
    page.getByRole('heading', { name: 'This page is for a different role' }),
  ).toBeVisible();
  await page.getByLabel('Account menu').click();
  const logout = page.waitForResponse((r) => r.url().endsWith('/auth/logout'));
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  expect((await logout).status()).toBe(204);
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  expect(
    (await context.cookies()).some((c) => c.name === 'eduflow_refresh'),
  ).toBe(false);
});

test('instructor statistics and admin moderation respect role workspaces', async ({
  page,
}) => {
  const f = fixtures!;
  // Establish this test's enrollment independently of the learning test.
  await login(page, f.student);
  await page.goto(`/courses/${f.course.slug}`);
  await page.getByRole('button', { name: 'Enroll and start learning' }).click();
  await expect(page).toHaveURL(new RegExp(`/learn/${f.course.id}`));
  await page.getByLabel('Account menu').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  await login(page, f.instructor);
  await page.goto(`/instructor/courses/${f.course.id}`);
  await expect(
    page.getByText('Enrolled learners', { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('rowheader', { name: 'Frontend Student' }),
  ).toBeVisible();
  await page.getByLabel('Account menu').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  await login(page, f.admin);
  await page.goto(`/admin/courses/${f.draft.id}`);
  await expect(
    page.getByRole('heading', { name: f.draft.title, exact: true }),
  ).toBeVisible();
  if (
    await page.getByRole('button', { name: 'Unpublish course' }).isVisible()
  ) {
    await page.getByRole('button', { name: 'Unpublish course' }).click();
    await page
      .getByRole('dialog', { name: 'Unpublish course', exact: true })
      .getByRole('button', { name: 'Unpublish course', exact: true })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await page
    .getByRole('button', { name: 'Publish course', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Publish course', exact: true })
    .getByRole('button', { name: 'Publish course', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Unpublish course' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Unpublish course' }).click();
  await page
    .getByRole('dialog', { name: 'Unpublish course', exact: true })
    .getByRole('button', { name: 'Unpublish course', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Publish course', exact: true }),
  ).toBeVisible();
});

test('light, dark and mobile layouts remain usable', async ({ page }) => {
  await page.goto('/courses');
  await expect(page.locator('.course-card').first()).toBeVisible();
  await page.getByLabel('Color theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.screenshot({
    path: 'test-results/catalog-light.png',
    fullPage: true,
  });
  await page.getByLabel('Color theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: 'test-results/catalog-dark.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Mobile navigation' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.screenshot({
    path: 'test-results/catalog-mobile.png',
    fullPage: true,
  });
});
