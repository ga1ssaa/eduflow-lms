import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { chooseTheme } from './theme';

const path = process.env.EDUFLOW_E2E_FIXTURE_FILE;
const fixtures: {
  instructor: { email: string; password: string };
  course: { id: string; title: string };
  draft: { id: string };
} | null = path ? JSON.parse(readFileSync(path, 'utf8')) : null;
test.skip(
  !fixtures,
  'Requires private isolated test accounts and two instructor-owned courses.',
);

test('unsaved curriculum survives cancelled navigation and resets after an approved course switch', async ({
  page,
}) => {
  const f = fixtures!;
  await page.goto('/login');
  await page.getByLabel('Email address').fill(f.instructor.email);
  await page.getByLabel(/^Password/).fill(f.instructor.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/instructor$/);
  await expect(page.getByText('Total courses', { exact: true })).toBeVisible();

  // Warm course B, then enter A using four real SPA links. A multi-step Back
  // can therefore land directly on cached B without going through another page.
  await page.goto(`/instructor/courses/${f.draft.id}/curriculum`);
  await page.getByRole('link', { name: '← Course overview' }).click();
  await page.getByRole('link', { name: '← Back to courses' }).click();
  await page.getByRole('link', { name: f.course.title, exact: true }).click();
  await page
    .getByRole('link', { name: 'Edit curriculum', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Manage curriculum' }),
  ).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await chooseTheme(page, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({
      path: `test-results/authoring-${theme}.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/authoring-${theme}-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
  }

  await page.getByLabel('New module title').fill('Keep this draft in course A');
  let dialogs = 0;
  let approveDiscard = false;
  page.on('dialog', async (dialog) => {
    if (approveDiscard) await dialog.accept();
    else await dialog.dismiss();
    dialogs += 1;
  });
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Catalog' })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`/courses/${f.course.id}/curriculum$`),
  );
  await expect(page.getByLabel('New module title')).toHaveValue(
    'Keep this draft in course A',
  );
  await expect.poll(() => dialogs).toBeGreaterThan(0);

  const beforeBack = dialogs;
  await page.evaluate(() => history.back());
  await expect.poll(() => dialogs).toBeGreaterThan(beforeBack);
  await expect(page.getByLabel('New module title')).toHaveValue(
    'Keep this draft in course A',
  );
  approveDiscard = true;
  await page.evaluate(() => history.go(-4));
  await expect(page).toHaveURL(
    new RegExp(`/courses/${f.draft.id}/curriculum$`),
  );
  await expect(page.getByLabel('New module title')).toHaveValue('');
});
