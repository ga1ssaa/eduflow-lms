import { expect, test } from '@playwright/test';
import { installPublicUiFixtures } from './fixtures/atmosphere';
import { chooseTheme } from './theme';

// Every API request is fulfilled by isolated fixtures, including auth failures.
// These verify real browser UI behavior, not live JWT/cookie integration.
test.beforeEach(async ({ page }) => {
  await installPublicUiFixtures(page);
});

for (const path of ['/login', '/register']) {
  for (const width of [320, 375, 768, 1024, 1440]) {
    for (const theme of ['light', 'dark']) {
      test(`${path} ${width}px ${theme}: approved layout, minimal header and unclipped controls`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(
          (value) => localStorage.setItem('eduflow-theme', value),
          theme,
        );
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        await page.locator('.auth-form-content').evaluate(async (element) => {
          await Promise.all(
            element.getAnimations().map((animation) => animation.finished),
          );
        });
        await expect(page.locator('.auth-header')).toBeVisible();
        await expect(page.locator('.floating-navbar')).toHaveCount(0);
        await expect(
          page.getByRole('link', { name: 'EduFlow home' }),
        ).toHaveAttribute('href', '/');
        await expect(
          page.getByRole('link', { name: 'Back to Home' }),
        ).toHaveAttribute('href', '/');
        await expect(
          page.getByRole('heading', {
            name: path === '/login' ? 'Welcome back.' : 'Create your account',
            exact: true,
          }),
        ).toBeVisible();
        const intro = (await page.locator('.auth-intro').boundingBox())!;
        const form = (await page.locator('.auth-form-content').boundingBox())!;
        if (width > 900) {
          expect(intro.x + intro.width).toBeLessThan(form.x);
          expect(
            Math.abs(form.y + form.height / 2 - intro.y - intro.height / 2),
          ).toBeLessThan(1);
        } else expect(form.y).toBeLessThan(intro.y);
        const inputs = page.locator('.auth-card input');
        await expect(inputs).toHaveCount(path === '/register' ? 3 : 2);
        for (const input of await inputs.all()) {
          await input.scrollIntoViewIfNeeded();
          const box = (await input.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(8);
          expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(
            await input.evaluate((node) => {
              const box = node.getBoundingClientRect();
              for (
                let parent = node.parentElement;
                parent;
                parent = parent.parentElement
              ) {
                const style = getComputedStyle(parent);
                if (!['hidden', 'clip'].includes(style.overflowX)) continue;
                const bounds = parent.getBoundingClientRect();
                if (box.left < bounds.left - 1 || box.right > bounds.right + 1)
                  return false;
              }
              return true;
            }),
          ).toBe(true);
        }
        const password = (await page
          .locator('input[name="password"]')
          .boundingBox())!;
        const toggle = (await page
          .getByRole('button', { name: 'Show password' })
          .boundingBox())!;
        expect(toggle.x).toBeGreaterThanOrEqual(password.x);
        expect(toggle.x + toggle.width).toBeLessThanOrEqual(
          password.x + password.width,
        );
        expect(toggle.y + toggle.height).toBeLessThanOrEqual(
          password.y + password.height + 1,
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      });
    }
  }

  test(`${path}: theme persistence, keyboard focus, real destinations and reduced motion`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    await page.goto(`${path}?returnTo=%2Fcourses%3Fsearch%3DFixture`);
    await expect(page.locator('.auth-form-content')).toHaveCSS(
      'animation-name',
      'none',
    );
    await expect(page.locator('.auth-editorial-copy')).toHaveCSS(
      'animation-name',
      'none',
    );
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Skip to content' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'EduFlow home' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: 'Back to Home' }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    const theme = page.getByRole('button', {
      name: 'Color theme',
      exact: true,
    });
    await expect(theme).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(theme).toBeFocused();
    await page.keyboard.press('Tab');
    const firstField = page.getByLabel(
      path === '/register' ? 'Full name' : 'Email address',
    );
    await expect(firstField).toBeFocused();
    expect(
      await firstField.evaluate((node) => {
        const style = getComputedStyle(node);
        return (
          style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2
        );
      }),
    ).toBe(true);
    await chooseTheme(page, 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(
      await page.evaluate(() => localStorage.getItem('eduflow-theme')),
    ).toBe('dark');
    await chooseTheme(page, 'system');
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('[data-theme-scene-atmosphere]')).toHaveCount(0);
    await page
      .getByRole('link', {
        name: path === '/login' ? 'Create an account' : 'Sign in',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(
      path === '/login' ? /\/register\?returnTo=/ : /\/login\?returnTo=/,
    );
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(
      '/courses?search=Fixture',
    );
    await page.getByRole('link', { name: 'Back to Home' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('.floating-navbar')).toBeVisible();
    await expect(page.locator('.auth-header')).toHaveCount(0);
  });

  test(`${path}: native validation, password toggle, pending state and safe server errors`, async ({
    page,
  }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const endpoint = path === '/register' ? 'register' : 'login';
    let requests = 0;
    await page.route(`**/api/v1/auth/${endpoint}`, async (route) => {
      requests++;
      expect(route.request().headers()['x-csrf-token']).toBe('1');
      await gate;
      await route.fulfill({
        status: path === '/register' ? 409 : 401,
        json: {
          detail:
            path === '/register'
              ? 'Email already registered'
              : 'Incorrect email or password',
        },
      });
    });
    await page.goto(path);
    const submit = page.getByRole('button', {
      name: path === '/register' ? 'Create account' : 'Sign in',
      exact: true,
    });
    await submit.click();
    expect(
      await page
        .locator('form')
        .evaluate((node) => (node as HTMLFormElement).checkValidity()),
    ).toBe(false);
    expect(requests).toBe(0);
    if (path === '/register')
      await page.getByLabel('Full name').fill('Isolated Fixture Learner');
    await page.getByLabel('Email address').fill('fixture-auth@example.test');
    const password = page.locator('input[name="password"]');
    if (path === '/register') {
      await password.fill('onlylettersforvalidation');
      await submit.click();
      await expect(page.locator('#password-error')).toHaveText(
        'Include a letter and a non-space number or symbol.',
      );
      expect(requests).toBe(0);
    }
    const value = `Isolated-${crypto.randomUUID()}!`;
    await password.fill(value);
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
    await expect(password).toHaveValue(value);
    expect(requests).toBe(0);
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');
    await submit.click();
    await expect(
      page.getByRole('button', {
        name: path === '/register' ? 'Creating account…' : 'Signing in…',
        exact: true,
      }),
    ).toBeDisabled();
    release();
    await expect(page.getByRole('alert')).toHaveText(
      path === '/register'
        ? 'Email already registered'
        : 'Incorrect email or password',
    );
    await expect(submit).toBeEnabled();
    await expect(password).toHaveValue(value);
    expect(requests).toBe(1);
  });

  test(`${path}: server field validation remains associated with its control`, async ({
    page,
  }) => {
    await page.route(
      `**/api/v1/auth/${path === '/register' ? 'register' : 'login'}`,
      (route) =>
        route.fulfill({
          status: 422,
          json: {
            detail: [
              {
                loc: ['body', 'email'],
                msg: 'Use a valid email address',
                type: 'value_error',
              },
            ],
          },
        }),
    );
    await page.goto(path);
    if (path === '/register')
      await page.getByLabel('Full name').fill('Isolated Fixture Learner');
    await page.getByLabel('Email address').fill('fixture-auth@example.test');
    await page
      .locator('input[name="password"]')
      .fill(`Isolated-${crypto.randomUUID()}!`);
    await page
      .getByRole('button', {
        name: path === '/register' ? 'Create account' : 'Sign in',
        exact: true,
      })
      .click();
    await expect(page.getByLabel('Email address')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await expect(page.getByLabel('Email address')).toHaveAttribute(
      'aria-describedby',
      'email-error',
    );
    await expect(page.locator('#email-error')).toHaveText(
      'Use a valid email address',
    );
  });

  test(`${path}: MOCKED API success preserves redirect, session recovery and logout UI`, async ({
    page,
  }) => {
    const fixture = await installPublicUiFixtures(page);
    let signedIn = false;
    const token = {
      access_token: 'isolated-ui-fixture-student',
      token_type: 'bearer',
      expires_in: 900,
    };
    await page.route('**/api/v1/auth/register', (route) => {
      expect(Object.keys(route.request().postDataJSON()).sort()).toEqual([
        'email',
        'full_name',
        'password',
      ]);
      return route.fulfill({ status: 201, json: fixture.user });
    });
    await page.route('**/api/v1/auth/login', (route) => {
      expect(route.request().headers()['x-csrf-token']).toBe('1');
      signedIn = true;
      return route.fulfill({ json: token });
    });
    await page.route('**/api/v1/auth/refresh', (route) =>
      route.fulfill({
        status: signedIn ? 200 : 401,
        json: signedIn ? token : { detail: 'Anonymous isolated fixture' },
      }),
    );
    await page.route('**/api/v1/auth/logout', (route) => {
      signedIn = false;
      return route.fulfill({ status: 204 });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${path}?returnTo=%2Fcourses%3Fsearch%3DFixture`);
    await chooseTheme(page, 'light');
    if (path === '/register')
      await page.getByLabel('Full name').fill('Isolated Fixture Learner');
    await page.getByLabel('Email address').fill('fixture-auth@example.test');
    await page
      .locator('input[name="password"]')
      .fill(`Isolated-${crypto.randomUUID()}!`);
    await page
      .getByRole('button', {
        name: path === '/register' ? 'Create account' : 'Sign in',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/courses\?search=Fixture$/);
    await expect(page.getByLabel('Account menu')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Account menu')).toBeVisible();
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([
      'eduflow-theme',
    ]);
    await page.getByLabel('Account menu').click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(
      page
        .getByRole('banner')
        .getByRole('link', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Account menu')).toHaveCount(0);
    expect(signedIn).toBe(false);
  });
}
