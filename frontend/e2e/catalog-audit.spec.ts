import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { chooseTheme } from './theme';

type Account = { email: string; password: string };
const fixturePath = process.env.EDUFLOW_E2E_FIXTURE_FILE;
const fixtures: {
  catalog?: { search: string; category: string; total: number };
  student: Account;
  instructor: Account;
  admin: Account;
} | null = fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;
test.skip(
  !fixtures?.catalog,
  'Requires private accounts and the isolated real-API catalog dataset.',
);

async function openCatalog(page: Page) {
  const catalog = fixtures!.catalog!;
  await page.goto(
    `/courses?${new URLSearchParams({ search: catalog.search, category: catalog.category })}`,
  );
  await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(9);
}

async function auditSelect(select: Locator) {
  const measured = await select.evaluate((element) => {
    const native = element as HTMLSelectElement;
    const style = getComputedStyle(native);
    const arrow =
      native.parentElement!.querySelector<SVGElement>('.select-chevron')!;
    const rect = native.getBoundingClientRect();
    const icon = arrow.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = style.font;
    const textWidth = Math.max(
      ...Array.from(
        native.options,
        (option) => context.measureText(option.text).width,
      ),
    );
    return {
      appearance: style.appearance,
      height: rect.height,
      paddingRight: parseFloat(style.paddingRight),
      iconInset: rect.right - icon.right,
      textGap:
        icon.left - (rect.left + parseFloat(style.paddingLeft) + textWidth),
      iconPointerEvents: getComputedStyle(arrow).pointerEvents,
      arrows: native.parentElement!.querySelectorAll('.select-chevron').length,
    };
  });
  expect(measured.appearance).toBe('none');
  expect(measured.arrows).toBe(1);
  expect(measured.iconPointerEvents).toBe('none');
  expect(measured.height).toBeGreaterThanOrEqual(44);
  expect(measured.paddingRight).toBeGreaterThanOrEqual(46);
  expect(measured.iconInset).toBeGreaterThanOrEqual(13.5);
  expect(measured.iconInset).toBeLessThanOrEqual(16.5);
  expect(measured.textGap).toBeGreaterThanOrEqual(12);
}

for (const width of [320, 375, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`catalog geometry and select controls at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openCatalog(page);
      const themeTrigger = page.getByRole('button', {
        name: 'Color theme',
        exact: true,
      });
      await chooseTheme(page, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      for (const selector of [
        '.catalog-page-header',
        '.catalog-hero',
        '.catalog-hero h1',
        '.catalog-filter',
        '.catalog-course-card',
      ]) {
        const box = await page.locator(selector).first().boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThan(0);
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      }
      const level = page.getByRole('combobox', { name: 'Level', exact: true });
      const themeBox = await themeTrigger.boundingBox();
      expect(themeBox!.width).toBeGreaterThanOrEqual(44);
      expect(themeBox!.height).toBeGreaterThanOrEqual(44);
      await expect(themeTrigger.locator('svg')).toHaveCount(1);
      await themeTrigger.click();
      const themeMenu = page.getByRole('menu', {
        name: 'Color theme',
        exact: true,
      });
      const menuBox = await themeMenu.boundingBox();
      expect(menuBox!.x).toBeGreaterThanOrEqual(8);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width - 8);
      await expect(
        page.getByRole('menuitemradio', {
          name: theme === 'light' ? 'Light' : 'Dark',
          exact: true,
        }),
      ).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape');
      await expect(themeTrigger).toBeFocused();
      await auditSelect(level);
      await page.keyboard.press('Tab');
      await level.focus();
      await expect(level).toBeFocused();
      const ring = await level.evaluate((element) => ({
        width: parseFloat(getComputedStyle(element).outlineWidth),
        offset: parseFloat(getComputedStyle(element).outlineOffset),
      }));
      expect(ring.width).toBe(2);
      expect(ring.offset).toBe(2);
      // Category is intentionally free text: the API has no taxonomy endpoint.
      await expect(
        page.getByRole('textbox', { name: 'Category', exact: true }),
      ).toBeEditable();
      await expect(
        page.getByRole('combobox', { name: 'Category', exact: true }),
      ).toHaveCount(0);
    });
  }
}

test('native select keyboard interaction and mobile navigation restore focus correctly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await openCatalog(page);
  const level = page.getByRole('combobox', { name: 'Level', exact: true });
  await level.focus();
  // Native typeahead avoids platform-specific operating-system popup key routing.
  await page.keyboard.press('b');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(level).toHaveValue('beginner');
  const theme = page.getByRole('button', {
    name: 'Color theme',
    exact: true,
  });
  await theme.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(theme).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('eduflow-theme'))).toBe(
    'dark',
  );
  const menu = page.getByRole('button', {
    name: 'Open navigation',
    exact: true,
  });
  await menu.focus();
  await page.keyboard.press('Enter');
  const navigation = page.getByRole('navigation', {
    name: 'Mobile navigation',
  });
  await expect(navigation).toBeVisible();
  await navigation.locator('a').first().focus();
  await page.keyboard.press('Escape');
  await expect(navigation).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test('catalog anchors, authentication CTAs and real course links resolve without hover layout shifts', async ({
  page,
}) => {
  const blockerWarnings: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/blocker/i.test(text) && /\bPOP\b/i.test(text))
      blockerWarnings.push(text);
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openCatalog(page);
  const filters = fixtures!.catalog!;
  const expectPreservedFilters = () => {
    const url = new URL(page.url());
    expect(url.pathname).toBe('/courses');
    expect(url.searchParams.get('search')).toBe(filters.search);
    expect(url.searchParams.get('category')).toBe(filters.category);
  };
  const mainNav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const id of ['courses', 'how-it-works', 'for-instructors', 'about']) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
    await mainNav.locator(`a[href$="#${id}"]`).click();
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    expectPreservedFilters();
  }
  await page.goBack();
  await expect(page).toHaveURL(/#for-instructors$/);
  expectPreservedFilters();
  expect(blockerWarnings).toEqual([]);
  for (const link of await page
    .locator('.catalog-hero-actions a, .catalog-about a')
    .all()) {
    const href = await link.getAttribute('href');
    const target = new URL(href!, page.url());
    expect(target.hash).not.toBe('');
    expect(target.pathname).toBe('/courses');
    expect(target.searchParams.get('search')).toBe(filters.search);
    expect(target.searchParams.get('category')).toBe(filters.category);
    await expect(page.locator(target.hash)).toHaveCount(1);
  }
  const card = page.locator('.catalog-course-card').first();
  const layout = () =>
    page.locator('.catalog-course-card').evaluateAll((cards) =>
      cards.slice(0, 3).map((item) => {
        const element = item as HTMLElement;
        return [
          element.offsetLeft,
          element.offsetTop,
          element.offsetWidth,
          element.offsetHeight,
        ];
      }),
    );
  await card.scrollIntoViewIfNeeded();
  const before = await layout();
  await card.hover();
  expect(await layout()).toEqual(before);
  const titleLink = card.locator('h3 a');
  const title = await titleLink.innerText();
  const target = await titleLink.getAttribute('href');
  await expect(
    card.getByRole('link', { name: `View ${title}`, exact: true }),
  ).toHaveAttribute('href', target!);
  await titleLink.click();
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  await openCatalog(page);
  await page.getByRole('link', { name: 'EduFlow home', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await openCatalog(page);
  await page
    .getByRole('link', { name: 'Your instructor workspace', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back.', exact: true }),
  ).toBeVisible();
  await openCatalog(page);
  await page.getByRole('link', { name: 'Get Started', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Create your account', exact: true }),
  ).toBeVisible();
  await openCatalog(page);
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back.', exact: true }),
  ).toBeVisible();
  expect(blockerWarnings).toEqual([]);
});

for (const [role, destination] of [
  ['student', '/learning'],
  ['instructor', '/instructor'],
  ['admin', '/admin'],
] as const) {
  test(`catalog account menu opens the ${role} workspace and restores focus on Escape`, async ({
    page,
  }) => {
    const account = fixtures![role];
    await page.goto('/login');
    await page.getByLabel('Email address').fill(account.email);
    await page.getByLabel(/^Password/).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByLabel('Account menu')).toBeVisible();
    await openCatalog(page);
    const accountMenu = page.getByLabel('Account menu');
    await expect(accountMenu.locator('.catalog-account-chevron')).toHaveCount(
      1,
    );
    await expect(
      accountMenu.locator('.catalog-account-chevron'),
    ).toHaveAttribute('aria-hidden', 'true');
    const workspace = page.getByRole('link', {
      name: 'Go to my workspace',
      exact: true,
    });
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await chooseTheme(page, theme);
        await accountMenu.focus();
        await page.keyboard.press('Enter');
        await expect(workspace).toBeVisible();
        const panel = await page.locator('.account-panel').boundingBox();
        expect(panel).not.toBeNull();
        expect(panel!.x).toBeGreaterThanOrEqual(8);
        expect(panel!.x + panel!.width).toBeLessThanOrEqual(width - 8);
        const trigger = await accountMenu.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const avatar = element
            .querySelector('.avatar')!
            .getBoundingClientRect();
          const arrow = element
            .querySelector('.catalog-account-chevron')!
            .getBoundingClientRect();
          return {
            width: arrow.width,
            height: arrow.height,
            gap: arrow.left - avatar.right,
            rightInset: bounds.right - arrow.right,
          };
        });
        expect(trigger.width).toBe(16);
        expect(trigger.height).toBe(16);
        expect(trigger.gap).toBeGreaterThanOrEqual(12);
        expect(trigger.rightInset).toBeCloseTo(14, 1);
        await workspace.focus();
        await page.keyboard.press('Escape');
        await expect(workspace).not.toBeVisible();
        await expect(accountMenu).toBeFocused();
      }
    }
    await page.keyboard.press('Enter');
    await workspace.click();
    await expect(page).toHaveURL(new RegExp(`${destination}$`));
  });
}

test('manual pagination retains data offline, retries the same real page and disables pending actions', async ({
  page,
  context,
}) => {
  // Exercise a browser without IntersectionObserver; API requests remain entirely real.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', {
      value: undefined,
      configurable: true,
    });
  });
  await openCatalog(page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  try {
    // Transport-only disconnection models an unreachable internet connection while
    // the device still has a network interface; TanStack's known-offline pause is separate.
    await cdp.send('Network.emulateNetworkConditionsByRule', {
      matchedNetworkConditions: [
        {
          urlPattern: '',
          offline: true,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        },
      ],
    });
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await page
      .getByRole('button', { name: 'Load more courses', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Retry loading more', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(9);
    await expect(
      page.getByText(`${fixtures!.catalog!.total} courses available`, {
        exact: true,
      }),
    ).toHaveCount(0);
    await cdp.send('Network.emulateNetworkConditionsByRule', {
      matchedNetworkConditions: [
        {
          urlPattern: '',
          offline: false,
          latency: 700,
          downloadThroughput: -1,
          uploadThroughput: -1,
        },
      ],
    });
    const response = page.waitForResponse((result) => {
      const url = new URL(result.url());
      return (
        url.pathname === '/api/v1/courses' &&
        url.searchParams.get('page') === '2'
      );
    });
    await page
      .getByRole('button', { name: 'Retry loading more', exact: true })
      .click();
    await expect(page.locator('.catalog-loadmore button')).toBeDisabled();
    expect((await response).status()).toBe(200);
    await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(
      fixtures!.catalog!.total,
    );
    await expect(
      page.getByText(`${fixtures!.catalog!.total} courses available`, {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await cdp.send('Network.emulateNetworkConditionsByRule', {
      matchedNetworkConditions: [],
    });
    await cdp.detach();
  }
});

test('known offline pagination waits visibly, disables repeat requests and resumes automatically online', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', {
      value: undefined,
      configurable: true,
    });
  });
  await openCatalog(page);
  try {
    await context.setOffline(true);
    await page
      .getByRole('button', { name: 'Load more courses', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Waiting for connection…',
        exact: true,
      }),
    ).toBeDisabled();
    await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(9);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(
      page.getByText(`${fixtures!.catalog!.total} courses available`, {
        exact: true,
      }),
    ).toHaveCount(0);
    const resumed = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === '/api/v1/courses' &&
        url.searchParams.get('page') === '2'
      );
    });
    await context.setOffline(false);
    expect((await resumed).status()).toBe(200);
    await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(
      fixtures!.catalog!.total,
    );
    await expect(
      page.getByText(`${fixtures!.catalog!.total} courses available`, {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
