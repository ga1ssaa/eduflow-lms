import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { chooseTheme } from './theme';

const path = process.env.EDUFLOW_E2E_FIXTURE_FILE;
const captureReview = process.env.EDUFLOW_CAPTURE_REVIEW === 'true';
const fixtures: {
  instructor: { email: string; password: string };
  course: { id: string; title: string };
  draft: { id: string };
} | null = path ? JSON.parse(readFileSync(path, 'utf8')) : null;
test.skip(
  !fixtures,
  'Requires private isolated test accounts and two instructor-owned courses.',
);

for (const touch of [false, true]) {
  test.describe(touch ? 'touch activation' : 'pointer activation', () => {
    test.use({
      hasTouch: touch,
      viewport: { width: touch ? 375 : 1440, height: 900 },
    });

    test('first activation of an entering course link navigates without losing the click', async ({
      page,
    }) => {
      const f = fixtures!;
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto('/login');
      await page.getByLabel('Email address').fill(f.instructor.email);
      await page.getByLabel(/^Password/).fill(f.instructor.password);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page).toHaveURL(/\/instructor$/);
      await page.goto('/instructor/courses');
      const link = page.getByRole('link', {
        name: f.course.title,
        exact: true,
      });
      const card = page.locator('.course-row').filter({ has: link });
      await card.scrollIntoViewIfNeeded();
      await expect(card).toHaveAttribute('data-reveal-state', 'revealing');
      // Hold the actual CSS entrance early enough to expose a focus-induced
      // transform reset between press and release, without timing a fast click.
      await card.evaluate((element) => {
        element.addEventListener(
          'pointerdown',
          () => {
            document.documentElement.dataset.pressedReveal = (
              element as HTMLElement
            ).dataset.revealState;
          },
          { once: true },
        );
        const animation = element.getAnimations()[0];
        if (!animation) throw new Error('Expected an active course entrance');
        animation.pause();
        animation.currentTime = (animation.effect!.getTiming().delay ?? 0) + 1;
      });
      if (touch) await link.tap();
      else await link.click();
      await expect(page.locator('html')).toHaveAttribute(
        'data-pressed-reveal',
        'revealing',
      );
      await expect(page).toHaveURL(
        new RegExp(`/instructor/courses/${f.course.id}$`),
      );
      await expect(
        page.getByRole('link', { name: 'Edit curriculum', exact: true }),
      ).toBeVisible();
    });
  });
}

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
    if (captureReview)
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
    if (captureReview)
      await page.screenshot({
        path: `test-results/authoring-${theme}-mobile.png`,
        fullPage: true,
      });
    await page.setViewportSize({ width: 1440, height: 900 });
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
    .getByRole('link', { name: 'Explore Courses', exact: true })
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
