import { expect, test, type Page } from '@playwright/test';
import { installPublicUiFixtures } from './fixtures/atmosphere';

test.use({ screenshot: 'off', video: 'off', trace: 'off' });
const initial = '/courses?category=Design&search=Fixture';
const hash = '#how-it-works';

async function position(page: Page) {
  return page.locator(hash).evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    margin: Number.parseFloat(getComputedStyle(element).scrollMarginTop),
    y: scrollY,
  }));
}

async function gatedCatalog(page: Page, width: number, total = 18) {
  const fixture = await installPublicUiFixtures(page);
  for (let index = fixture.courses.length; index < total; index++) {
    fixture.courses.push({
      ...fixture.courses[index % 18],
      id: `80000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      slug: `fixture-anchor-${index}`,
      title: `[Fixture] Catalog anchor ${index}`,
    });
  }
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  const pages: number[] = [];
  await page.route('**/api/v1/courses?**', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.searchParams.get('page_size') === '9' &&
      Number(url.searchParams.get('page')) > 1
    )
      pages.push(Number(url.searchParams.get('page')));
    if (
      url.searchParams.get('page') === '2' &&
      url.searchParams.get('page_size') === '9'
    ) {
      requests++;
      await gate;
    }
    // Delegate only to the already-installed fail-closed fixture, never a server.
    await route.fallback();
  });
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const anonymous = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/v1/auth/refresh' &&
      response.status() === 401,
  );
  await page.goto(initial);
  await anonymous;
  await expect(
    page
      .getByRole('banner')
      .getByRole('link', { name: 'Sign in', exact: true, includeHidden: true }),
  ).toBeAttached();
  await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(9);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  // Trigger real IntersectionObserver pagination, then hold the network reply.
  await expect
    .poll(async () => {
      if (!requests)
        await page
          .locator('.catalog-sentinel')
          .evaluate((element) =>
            element.scrollIntoView({ block: 'center', behavior: 'instant' }),
          );
      return requests;
    })
    .toBe(1);
  await expect(
    page.getByRole('status', { name: 'Loading more courses' }),
  ).toBeVisible();
  const link = page
    .getByRole('contentinfo')
    .getByRole('link', { name: 'How It Works', exact: true });
  await link.click();
  await expect(page).toHaveURL(new URL(`${initial}${hash}`, page.url()).href);
  await expect
    .poll(async () => {
      const rect = await position(page);
      return Math.abs(rect.top - rect.margin);
    })
    .toBeLessThanOrEqual(2);
  await expect(link).toBeFocused();
  return { fixture, release, requests: () => requests, pages, link };
}

async function appended(page: Page, expected = 18) {
  await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(expected);
  await expect(
    page.getByRole('status', { name: 'Loading more courses' }),
  ).toHaveCount(0);
  const links = await page
    .locator('.catalog-course-card h3 a')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('href')),
    );
  expect(new Set(links).size).toBe(expected);
}

async function settleScroll(page: Page) {
  await expect
    .poll(async () => {
      const before = await page.evaluate(() => scrollY);
      await page.waitForTimeout(120);
      return Math.abs((await page.evaluate(() => scrollY)) - before);
    })
    .toBeLessThanOrEqual(1);
}

for (const width of [375, 1440]) {
  test(`${width}px: late pagination observer delivery preserves the footer landing`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const state = window as typeof window & {
        releaseCatalogPagination?: () => void;
      };
      const NativeObserver = window.IntersectionObserver;
      let released = false;
      window.IntersectionObserver = class extends NativeObserver {
        constructor(
          callback: IntersectionObserverCallback,
          options?: IntersectionObserverInit,
        ) {
          super((entries, observer) => {
            if (
              options?.rootMargin === '400px' &&
              entries.some((entry) => entry.isIntersecting) &&
              !released
            ) {
              // Retain the actual browser entry; control only its task delivery.
              state.releaseCatalogPagination = () => {
                released = true;
                callback(entries, observer);
              };
            } else callback(entries, observer);
          }, options);
        }
      };
    });
    const fixture = await installPublicUiFixtures(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(initial);
    await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(9);
    const link = page.getByRole('contentinfo').getByRole('link', {
      name: 'How It Works',
      exact: true,
    });
    await link.click();
    await expect(page).toHaveURL(new URL(`${initial}${hash}`, page.url()).href);
    await page.waitForFunction(() => 'releaseCatalogPagination' in window);
    await page.evaluate(async () => {
      // More than the former two-frame grace: IO is not guaranteed to notify
      // React before that grace expires, especially on a busy mobile frame.
      for (let frame = 0; frame < 8; frame++)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      (
        window as typeof window & { releaseCatalogPagination: () => void }
      ).releaseCatalogPagination();
    });
    await appended(page);
    await expect
      .poll(async () => {
        const rect = await position(page);
        return Math.abs(rect.top - rect.margin);
      })
      .toBeLessThanOrEqual(2);
    await expect(link).toBeFocused();
    expect(new URL(page.url()).search).toBe('?category=Design&search=Fixture');
    expect(fixture.unexpected).toEqual([]);
  });

  test(`${width}px: ungated footer navigation survives observer pagination starting after hash landing`, async ({
    page,
  }) => {
    const fixture = await installPublicUiFixtures(page);
    await page.setViewportSize({ width, height: 900 });
    const errors: number[] = [];
    // Fresh document/query cache each time. No network gate, synthetic observer,
    // fetch call, timer override, or pre-settled pagination masks this idle window.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.goto(initial);
      const link = page
        .getByRole('contentinfo')
        .getByRole('link', { name: 'How It Works', exact: true });
      await link.click();
      await expect(page).toHaveURL(
        new URL(`${initial}${hash}`, page.url()).href,
      );
      await appended(page);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await expect
        .poll(
          async () => {
            const rect = await position(page);
            return Math.abs(rect.top - rect.margin);
          },
          {
            message: `${width}px ungated footer attempt ${attempt}: observer pagination must retain the 120px hash landing`,
          },
        )
        .toBeLessThanOrEqual(2);
      const landed = await position(page);
      errors.push(Math.abs(landed.top - landed.margin));
      await expect(link).toBeFocused();
      expect(new URL(page.url()).search).toBe(
        '?category=Design&search=Fixture',
      );
      expect(new URL(page.url()).hash).toBe(hash);
    }
    console.log(
      'ANCHOR_LANDING',
      JSON.stringify({
        width,
        samples: errors.length,
        maxErrorPx: Math.max(...errors),
      }),
    );
    expect(fixture.unexpected).toEqual([]);
  });

  test(`${width}px: anchor repair does not auto-fetch the remaining catalog; manual pagination still works`, async ({
    page,
  }) => {
    const state = await gatedCatalog(page, width, 36);
    try {
      state.release();
      await appended(page);
      await expect
        .poll(async () => {
          const rect = await position(page);
          return Math.abs(rect.top - rect.margin);
        })
        .toBeLessThanOrEqual(2);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      await page.waitForTimeout(200);
      expect(state.pages).toEqual([2]);
      await page
        .getByRole('button', { name: 'Load more courses', exact: true })
        .click();
      await appended(page, 27);
      expect(state.pages).toEqual([2, 3]);
      expect(new URL(page.url()).search).toBe(
        '?category=Design&search=Fixture',
      );
      expect(new URL(page.url()).hash).toBe(hash);
      expect(state.fixture.unexpected).toEqual([]);
    } finally {
      state.release();
    }
  });

  test(`${width}px: delayed page-two append preserves the footer hash landing and filters`, async ({
    page,
  }) => {
    const state = await gatedCatalog(page, width);
    const before = await position(page);
    try {
      state.release();
      await appended(page);
      await expect
        .poll(
          async () => {
            const rect = await position(page);
            return Math.abs(rect.top - rect.margin);
          },
          {
            message: `Keep ${hash} at its scroll margin after appending nine real fixture cards; initial=${JSON.stringify(before)}`,
          },
        )
        .toBeLessThanOrEqual(2);
      await expect(state.link).toBeFocused();
      expect(state.requests()).toBe(1);
      expect(new URL(page.url()).search).toBe(
        '?category=Design&search=Fixture',
      );
      expect(new URL(page.url()).hash).toBe(hash);
      expect(state.fixture.unexpected).toEqual([]);
    } finally {
      state.release();
    }
  });

  for (const method of ['wheel', 'touch', 'keyboard', 'pointer'] as const) {
    test(`${width}px: ${method} manual scrolling cancels delayed anchor correction without stealing focus`, async ({
      page,
      context,
    }) => {
      const state = await gatedCatalog(page, width);
      try {
        const before = await page.evaluate(() => scrollY);
        if (method === 'wheel') {
          await page.mouse.move(width / 2, 500);
          await page.mouse.wheel(0, 180);
        } else if (method === 'touch') {
          const cdp = await context.newCDPSession(page);
          try {
            await cdp.send('Emulation.setTouchEmulationEnabled', {
              enabled: true,
              maxTouchPoints: 1,
            });
            await cdp.send('Input.synthesizeScrollGesture', {
              x: width / 2,
              y: 600,
              yDistance: -180,
              speed: 1200,
              gestureSourceType: 'touch',
            });
          } finally {
            await cdp.send('Emulation.setTouchEmulationEnabled', {
              enabled: false,
            });
            await cdp.detach();
          }
        } else if (method === 'keyboard') {
          await page.keyboard.press('PageDown');
        } else {
          // Headless Chromium has no draggable native scrollbar. Exercise real
          // pointer intent plus a viewport scroll without claiming thumb coverage.
          await page.mouse.move(24, 500);
          await page.mouse.down();
          await page.evaluate(() =>
            scrollBy({ top: 180, behavior: 'instant' }),
          );
          await page.mouse.up();
        }
        await expect.poll(() => page.evaluate(() => scrollY)).not.toBe(before);
        await settleScroll(page);
        await page.evaluate(() =>
          Object.assign(window, { anchorUserFocus: document.activeElement }),
        );
        state.release();
        await appended(page);
        // A new append can change layout; it must not force the hash back to 120px.
        await page.waitForTimeout(200);
        const after = await position(page);
        expect(
          Math.abs(after.top - after.margin),
          JSON.stringify(after),
        ).toBeGreaterThan(10);
        expect(
          await page.evaluate(
            () =>
              document.activeElement ===
              (window as unknown as { anchorUserFocus: Element })
                .anchorUserFocus,
          ),
        ).toBe(true);
        expect(new URL(page.url()).hash).toBe(hash);
        expect(state.fixture.unexpected).toEqual([]);
      } finally {
        state.release();
      }
    });
  }

  test(`${width}px: filter and route changes cancel old pending work; Back and Forward never trap scrolling`, async ({
    page,
  }) => {
    const state = await gatedCatalog(page, width);
    try {
      const search = page.getByRole('textbox', {
        name: 'Search courses',
        exact: true,
      });
      await search.fill('No matching isolated course');
      await expect(page).toHaveURL(/search=No\+matching\+isolated\+course/);
      await expect(
        page.getByRole('heading', { name: 'No courses found', exact: true }),
      ).toBeVisible();
      const filtered = page.url();
      const before = await page.evaluate(() => scrollY);
      state.release();
      await page.waitForTimeout(200);
      await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(0);
      expect(await page.evaluate(() => scrollY)).toBe(before);
      await page
        .getByRole('contentinfo')
        .getByRole('link', { name: 'EduFlow home', exact: true })
        .click();
      await expect(page).toHaveURL(/\/$/);
      await page.goBack();
      await expect(page).toHaveURL(filtered);
      await expect(
        page.getByRole('heading', { name: 'No courses found', exact: true }),
      ).toBeVisible();
      await page.mouse.move(width / 2, 500);
      const y = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, 160);
      await expect.poll(() => page.evaluate(() => scrollY)).not.toBe(y);
      await settleScroll(page);
      const manual = await page.evaluate(() => scrollY);
      await page.waitForTimeout(200);
      expect(await page.evaluate(() => scrollY)).toBe(manual);
      await page.goForward();
      await expect(page).toHaveURL(/\/$/);
      expect(state.fixture.unexpected).toEqual([]);
    } finally {
      state.release();
    }
  });
}
