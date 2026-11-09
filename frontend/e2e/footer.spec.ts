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
      test(`${path} ${width}px ${theme}: compact accessible demo support footer`, async ({
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
          footer.getByRole('heading', { name: 'Contact & Support' }),
        ).toBeVisible();
        await expect(footer.getByText(/demo.*(?:not|no)/i)).toBeVisible();
        for (const label of ['Contact Support', 'support@eduflow.example']) {
          const link = footer.getByRole('link', { name: label, exact: true });
          await expect(link).toHaveAttribute(
            'href',
            'mailto:support@eduflow.example',
          );
          await expect(link).toHaveAccessibleDescription(/demo.*(?:not|no)/i);
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
          await footer.getByRole('link', { name: 'Explore courses' }).click();
          await expect(page).toHaveURL(/\/courses$/);
          await expect(page.getByRole('contentinfo')).toHaveCount(1);
        }
      });
    }
  }
}

for (const [role, path, destination] of [
  ['student', '/learning', '/learning'],
  ['instructor', '/instructor', '/instructor'],
  ['admin', '/admin', '/admin'],
] as const) {
  test(`${role}: shared footer preserves workspace navigation`, async ({
    page,
  }) => {
    await installUiFixtures(page, role);
    await page.goto(path);
    const footer = page.getByRole('contentinfo');
    await expect(footer).toHaveCount(1);
    await expect(
      footer.getByRole('link', { name: 'Your workspace' }),
    ).toHaveAttribute('href', destination);
    await expect(
      footer.getByRole('link', { name: 'Contact Support' }),
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

test('course details keep one footer and public sign-in navigation', async ({
  page,
}) => {
  await installPublicUiFixtures(page);
  await page.goto(`/courses/${fixtureCourseSlug}`);
  const footer = page.getByRole('contentinfo');
  await expect(footer).toHaveCount(1);
  await expect(footer.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/login',
  );
  await footer.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
