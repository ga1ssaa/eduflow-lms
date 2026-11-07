import { expect, test, type Locator, type Page } from '@playwright/test';
import { installPublicUiFixtures } from './fixtures/atmosphere';
import { chooseTheme } from './theme';

test.beforeEach(async ({ page }) => {
  await installPublicUiFixtures(page);
});

async function aligned(nav: Locator) {
  await expect(nav).toHaveAttribute('data-indicator-ready', 'true');
  await expect(nav.locator('.nav-active-indicator')).toHaveCount(1);
  await expect(nav.locator('.nav-active-indicator')).toHaveAttribute(
    'aria-hidden',
    'true',
  );
  await expect
    .poll(() =>
      nav.evaluate((element) => {
        const active = element
          .querySelector('a.active')!
          .getBoundingClientRect();
        const indicator = element
          .querySelector('.nav-active-indicator')!
          .getBoundingClientRect();
        return Math.max(
          Math.abs(active.x - indicator.x),
          Math.abs(active.y - indicator.y),
          Math.abs(active.width - indicator.width),
          Math.abs(active.height - indicator.height),
        );
      }),
    )
    .toBeLessThan(1);
}

async function section(page: Page, id: string) {
  await page.locator(`section#${id}`).evaluate((element) => {
    window.scrollTo({
      top: element.getBoundingClientRect().top + scrollY - 115,
      behavior: 'instant',
    });
  });
}

for (const path of ['/', '/courses?search=Fixture']) {
  for (const width of [375, 1440]) {
    for (const theme of ['light', 'dark']) {
      test(`${path} ${width}px ${theme}: sections, rapid scroll, indicator, resize and history`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(
          (value) => localStorage.setItem('eduflow-theme', value),
          theme,
        );
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        const location = page.url();
        const history = await page.evaluate(() => window.history.length);
        const mobile = width < 1320;
        if (mobile)
          await page.getByRole('button', { name: 'Open navigation' }).click();
        const nav = page.getByRole('navigation', {
          name: mobile ? 'Mobile navigation' : 'Main navigation',
          exact: true,
        });
        await expect(nav.locator('a[aria-current]')).toHaveText(
          path === '/' ? 'Home' : 'Explore Courses',
        );
        await aligned(nav);
        for (const [id, label] of [
          ['how-it-works', 'How It Works'],
          ['for-instructors', 'For Instructors'],
          ['about', 'About'],
        ]) {
          await section(page, id);
          await expect(nav.locator('a[aria-current]')).toHaveText(label);
          await aligned(nav);
        }
        // Consecutive real scroll events retarget a single decoration.
        await section(page, 'how-it-works');
        await section(page, 'about');
        await section(page, 'for-instructors');
        await expect(nav.locator('a[aria-current]')).toHaveText(
          'For Instructors',
        );
        await aligned(nav);
        expect(page.url()).toBe(location);
        expect(await page.evaluate(() => window.history.length)).toBe(history);
        await chooseTheme(page, theme === 'light' ? 'dark' : 'light');
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          theme === 'light' ? 'dark' : 'light',
        );
        if (mobile)
          await page.getByRole('button', { name: 'Open navigation' }).click();
        await aligned(nav);
        await page.setViewportSize({ width: mobile ? 768 : 1400, height: 900 });
        await aligned(nav);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    }
  }
}

test('indicator slides through intermediate geometry and reduced motion disables movement', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await aligned(nav);
  const sample = await page.evaluate(async () => {
    const nav = document.querySelector('.desktop-nav')!;
    const indicator = nav.querySelector('.nav-active-indicator')!;
    const start = indicator.getBoundingClientRect().x;
    const target = nav.querySelector('a[href$="#for-instructors"]')!;
    const end = target.getBoundingClientRect().x;
    const section = document.getElementById('for-instructors')!;
    window.scrollTo({
      top: section.getBoundingClientRect().top + scrollY - 115,
      behavior: 'instant',
    });
    await new Promise<void>((resolve) => {
      const check = () => {
        if (target.classList.contains('active')) resolve();
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { start, end, middle: indicator.getBoundingClientRect().x };
  });
  expect(sample.middle).toBeGreaterThan(sample.start + 1);
  expect(sample.middle).toBeLessThan(sample.end - 1);
  await aligned(nav);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(nav.locator('.nav-active-indicator')).toHaveCSS(
    'transition-duration',
    '0s',
  );
  await section(page, 'how-it-works');
  await expect(nav.locator('a[aria-current]')).toHaveText('How It Works');
  await aligned(nav);
  await nav.getByRole('link', { name: 'How It Works' }).focus();
  await expect(nav.getByRole('link', { name: 'How It Works' })).toBeFocused();
  expect(
    await nav.getByRole('link', { name: 'How It Works' }).evaluate((link) => {
      const style = getComputedStyle(link);
      return (
        style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2
      );
    }),
  ).toBe(true);
});
