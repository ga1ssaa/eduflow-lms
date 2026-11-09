import { expect, test } from '@playwright/test';
import {
  fixtureCourseSlug,
  installPublicUiFixtures,
  installUiFixtures,
} from './fixtures/atmosphere';

test.use({ screenshot: 'off', video: 'off', trace: 'off' });

for (const theme of ['light', 'dark']) {
  for (const width of [320, 375, 768, 1024, 1440]) {
    for (const path of ['/', '/courses']) {
      test(`${path} ${width}px ${theme}: responsive three-column footer`, async ({
        page,
      }) => {
        await installPublicUiFixtures(page);
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(
          (saved) => localStorage.setItem('eduflow-theme', saved),
          theme,
        );
        await page.goto(path);
        const footer = page.getByRole('contentinfo');
        await expect(footer).toHaveCount(1);
        await footer.scrollIntoViewIfNeeded();
        await expect(
          footer.getByRole('heading', { name: 'Support', exact: true }),
        ).toBeVisible();
        await expect(
          footer.getByRole('heading', { name: 'Platform', exact: true }),
        ).toBeVisible();
        await expect(
          footer.getByText('Learn at your own pace. Grow with every lesson.'),
        ).toBeVisible();
        await expect(
          footer.getByText('© 2026 EduFlow. All rights reserved.'),
        ).toBeVisible();
        const platform = footer.getByRole('navigation', { name: 'Platform' });
        await expect(platform.getByRole('link')).toHaveCount(2);
        await expect(
          platform.getByRole('link', { name: 'For Instructors' }),
        ).toHaveCount(0);
        await expect(platform.getByRole('link', { name: 'About' })).toHaveCount(
          0,
        );
        await expect(footer.locator('.footer-bottom a')).toHaveCount(0);
        const columns = await footer
          .locator('.footer-columns > *')
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const rect = node.getBoundingClientRect();
              return { x: rect.x, y: rect.y };
            }),
          );
        expect(columns).toHaveLength(3);
        if (width >= 768) {
          expect(
            Math.max(...columns.map((column) => column.y)) -
              Math.min(...columns.map((column) => column.y)),
          ).toBeLessThan(2);
          expect(columns[0].x).toBeLessThan(columns[1].x);
          expect(columns[1].x).toBeLessThan(columns[2].x);
        }
        for (const label of ['Contact', 'Email', 'support@eduflow.example']) {
          const link = footer.getByRole('link', { name: label, exact: true });
          await expect(link).toHaveAttribute(
            'href',
            'mailto:support@eduflow.example',
          );
          await expect(link).toHaveAccessibleDescription(/demo.*(?:not|no)/i);
          const descriptionId = await link.getAttribute('aria-describedby');
          const descriptionArea = await page
            .locator(`#${descriptionId}`)
            .evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return rect.width * rect.height;
            });
          expect(descriptionArea).toBeLessThanOrEqual(1);
          await link.focus();
          await expect(link).toBeFocused();
          const geometry = await link.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
              left: rect.left,
              right: rect.right,
              height: rect.height,
              outline: style.outlineStyle,
              outlineWidth: style.outlineWidth,
            };
          });
          expect(geometry.left).toBeGreaterThanOrEqual(0);
          expect(geometry.right).toBeLessThanOrEqual(width);
          expect(geometry.height).toBeGreaterThanOrEqual(44);
          expect(geometry.outline).not.toBe('none');
          expect(geometry.outlineWidth).toBe('2px');
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (path === '/') {
          await footer
            .getByRole('link', { name: 'Explore Courses', exact: true })
            .click();
          await expect(page).toHaveURL(/\/courses$/);
          await expect(page.getByRole('contentinfo')).toHaveCount(1);
        }
      });
    }
  }
}

for (const [role, path] of [
  ['student', '/learning'],
  ['instructor', '/instructor'],
  ['admin', '/admin'],
] as const) {
  test(`${role}: shared footer has no account navigation`, async ({ page }) => {
    await installUiFixtures(page, role);
    await page.goto(path);
    const footer = page.getByRole('contentinfo');
    await expect(footer).toHaveCount(1);
    await expect(
      footer.getByRole('link', { name: 'Your workspace' }),
    ).toHaveCount(0);
    await expect(footer.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
    await expect(
      footer.getByRole('link', { name: 'Contact', exact: true }),
    ).toBeVisible();
  });
}

for (const path of ['/login', '/register']) {
  test(`${path}: compact authentication layout stays footer-free`, async ({
    page,
  }) => {
    await installPublicUiFixtures(page);
    await page.goto(path);
    await expect(page.getByRole('contentinfo')).toHaveCount(0);
  });
}

test('course details keep one footer with copyright only in the bottom row', async ({
  page,
}) => {
  await installPublicUiFixtures(page);
  await page.goto(`/courses/${fixtureCourseSlug}`);
  const footer = page.getByRole('contentinfo');
  await expect(footer).toHaveCount(1);
  await expect(footer.locator('.footer-bottom a')).toHaveCount(0);
  await expect(
    footer.getByText('© 2026 EduFlow. All rights reserved.'),
  ).toBeVisible();
});

for (const [path, label, destination] of [
  ['/', 'How It Works', '/#how-it-works'],
  [
    '/courses?category=Design',
    'How It Works',
    '/courses?category=Design#how-it-works',
  ],
  [`/courses/${fixtureCourseSlug}`, 'How It Works', '/#how-it-works'],
] as const) {
  test(`${path}: ${label} leads to an existing section`, async ({ page }) => {
    await installPublicUiFixtures(page);
    await page.goto(path);
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: label, exact: true })
      .click();
    await expect(page).toHaveURL(new URL(destination, page.url()).href);
    const section = page.locator(new URL(page.url()).hash);
    await expect(section).toBeInViewport();
  });
}
