import { expect, test, type Page } from '@playwright/test';
import {
  fixtureCourseId,
  installPublicUiFixtures,
  type UiFixtureRole,
} from './fixtures/atmosphere';
import { installWorkspaceFixtures } from './fixtures/workspace';
import { chooseTheme } from './theme';

// All API responses (including mutations) are isolated fixtures. Never live auth.
test.use({ screenshot: 'off', video: 'off', trace: 'off' });
const course = `[Fixture] Interface foundations`;
const widths = [320, 375, 768, 1024, 1440];
const roles: UiFixtureRole[] = ['student', 'instructor', 'admin'];

async function responsive(page: Page) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await chooseTheme(page, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${width}/${theme}: document overflow`,
      ).toBe(true);
      const geometry = await page.locator('.stat').evaluateAll((stats) =>
        stats.map((stat) => {
          const value = stat.querySelector('strong')?.getBoundingClientRect();
          const icon = stat
            .querySelector('.stat-symbol')
            ?.getBoundingClientRect();
          return (
            !value ||
            !icon ||
            value.right <= icon.left ||
            value.left >= icon.right ||
            value.bottom <= icon.top ||
            value.top >= icon.bottom
          );
        }),
      );
      expect(
        geometry.every(Boolean),
        `${width}/${theme}: statistics overlap`,
      ).toBe(true);
      const controls = await page
        .locator('main input, main select, main textarea')
        .evaluateAll((elements) =>
          elements.flatMap((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (
              !rect.width ||
              !rect.height ||
              style.visibility === 'hidden' ||
              style.display === 'none'
            )
              return [];
            return [
              {
                name:
                  element.getAttribute('name') ?? element.id ?? element.tagName,
                left: rect.left,
                right: rect.right,
                height: rect.height,
              },
            ];
          }),
        );
      for (const control of controls) {
        expect(
          control.left,
          `${width}/${theme}: ${control.name} clipped left`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          control.right,
          `${width}/${theme}: ${control.name} clipped right`,
        ).toBeLessThanOrEqual(width + 0.5);
        expect(
          control.height,
          `${width}/${theme}: ${control.name} touch height`,
        ).toBeGreaterThanOrEqual(44);
      }
    }
  }
}

for (const role of roles) {
  test(`isolated ${role} workspace routes remain usable at five widths in both themes`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const fixture = await installWorkspaceFixtures(page, role);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const routes =
      role === 'student'
        ? [
            ['/learning', 'Keep moving forward, Fixture.'],
            [`/learn/${fixtureCourseId}`, course],
          ]
        : role === 'instructor'
          ? [
              ['/instructor', 'Welcome back, Fixture.'],
              ['/instructor/courses', 'Your courses'],
              ['/instructor/courses/new', 'Create a course'],
              [
                `/instructor/courses/${fixtureCourseId}/edit`,
                'Edit course details',
              ],
              [
                `/instructor/courses/${fixtureCourseId}/curriculum`,
                'Manage curriculum',
              ],
              [
                `/instructor/courses/${fixtureCourseId}/students`,
                `Student progress · ${course}`,
              ],
            ]
          : [
              ['/admin', 'Welcome back, Fixture.'],
              ['/admin/courses', 'Course moderation'],
              [`/admin/courses/${fixtureCourseId}`, course],
            ];
    for (const [path, heading] of routes) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: heading, exact: true, level: 1 }),
      ).toBeVisible();
      if (path.endsWith('/students')) {
        await expect(page.getByRole('table')).toBeVisible();
        await expect(page.locator('tbody tr')).toHaveCount(3);
        const roster = page.locator('.roster');
        await expect(roster).toHaveAttribute('tabindex', '0');
        await roster.focus();
        await expect(roster).toBeFocused();
        await page.keyboard.press('ArrowRight');
      }
      await responsive(page);
    }
    expect(fixture.unexpected).toEqual([]);
    expect(fixture.mutations).toEqual([]);
  });

  test(`isolated ${role} empty workspace tells the truth`, async ({ page }) => {
    const fixture = await installWorkspaceFixtures(page, role, { empty: true });
    await page.goto(role === 'student' ? '/learning' : `/${role}/courses`);
    await expect(
      page.getByRole('heading', {
        name:
          role === 'student'
            ? 'Your learning journey starts here'
            : 'No courses to show',
      }),
    ).toBeVisible();
    await expect(
      page.locator('.course-row, .learning-course-card'),
    ).toHaveCount(0);
    expect(fixture.unexpected).toEqual([]);
  });
}

test('student completion updates actual fixture progress without losing course navigation', async ({
  page,
}) => {
  const fixture = await installWorkspaceFixtures(page, 'student');
  await page.goto(`/learn/${fixtureCourseId}`);
  await page
    .getByRole('navigation', { name: 'Course lessons' })
    .getByRole('button')
    .filter({ hasText: 'Put your learning into practice' })
    .click();
  await page
    .getByRole('button', { name: 'Mark as complete', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Mark as incomplete', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('navigation', { name: 'Course lessons' }),
  ).toBeVisible();
  expect(
    fixture.requests.some(
      (request) =>
        request.method === 'POST' && request.path.endsWith('/complete'),
    ),
  ).toBe(true);
  expect(fixture.unexpected).toEqual([]);
});

test('instructor saves only the changed field and adds a module through isolated mutations', async ({
  page,
}) => {
  const fixture = await installWorkspaceFixtures(page, 'instructor');
  await page.goto(`/instructor/courses/${fixtureCourseId}/edit`);
  await expect(
    page.getByRole('button', { name: 'Save changes' }),
  ).toBeDisabled();
  await page
    .getByRole('textbox', { name: 'Description', exact: true })
    .fill('Isolated revised description.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => fixture.mutations.length).toBe(1);
  expect(fixture.mutations[0]).toEqual({
    method: 'PATCH',
    path: `/instructor/courses/${fixtureCourseId}`,
    body: { description: 'Isolated revised description.' },
  });
  await expect(
    page.getByRole('button', { name: 'Save changes' }),
  ).toBeDisabled();
  await page.goto(`/instructor/courses/${fixtureCourseId}/curriculum`);
  await page
    .getByLabel('New module title', { exact: true })
    .fill('[Fixture] A new chapter');
  await page.getByRole('button', { name: 'Add module', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '[Fixture] A new chapter', exact: true }),
  ).toBeVisible();
  expect(fixture.mutations[1].path).toBe(
    `/instructor/courses/${fixtureCourseId}/modules`,
  );
  const chapter = page.getByRole('region', {
    name: 'Module: [Fixture] A new chapter',
    exact: true,
  });
  await chapter.getByText('Add a lesson', { exact: true }).click();
  const form = chapter.getByRole('form', { name: 'Add lesson' });
  await form
    .getByLabel('Lesson title', { exact: true })
    .fill('[Fixture] Temporary lesson');
  await form
    .getByRole('textbox', { name: /^Lesson content(?:\s|$)/ })
    .fill('Isolated test content.');
  await form.getByRole('button', { name: 'Add lesson', exact: true }).click();
  await expect(
    chapter.getByRole('article', {
      name: 'Lesson: [Fixture] Temporary lesson',
      exact: true,
    }),
  ).toBeVisible();
  await chapter
    .getByRole('button', {
      name: 'Delete lesson: [Fixture] Temporary lesson',
      exact: true,
    })
    .click();
  const deleteLesson = page.getByRole('dialog', { name: 'Delete lesson?' });
  await deleteLesson
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  expect(
    fixture.mutations.filter((item) => item.method === 'DELETE'),
  ).toHaveLength(0);
  await chapter
    .getByRole('button', {
      name: 'Delete lesson: [Fixture] Temporary lesson',
      exact: true,
    })
    .click();
  await deleteLesson
    .getByRole('button', { name: 'Delete lesson', exact: true })
    .click();
  await expect(
    chapter.getByRole('article', {
      name: 'Lesson: [Fixture] Temporary lesson',
      exact: true,
    }),
  ).toHaveCount(0);
  await chapter
    .getByRole('button', {
      name: 'Delete module: [Fixture] A new chapter',
      exact: true,
    })
    .click();
  await page
    .getByRole('dialog', { name: 'Delete module?' })
    .getByRole('button', { name: 'Delete module', exact: true })
    .click();
  await expect(chapter).toHaveCount(0);
  expect(
    fixture.mutations.filter((item) => item.method === 'DELETE'),
  ).toHaveLength(2);
  expect(fixture.unexpected).toEqual([]);
});

test('admin cancellation sends no mutation and confirmation updates moderation state', async ({
  page,
}) => {
  const fixture = await installWorkspaceFixtures(page, 'admin');
  await page.goto(`/admin/courses/${fixtureCourseId}`);
  await page
    .getByRole('button', { name: 'Unpublish course', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Unpublish course' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(fixture.mutations).toEqual([]);
  await page
    .getByRole('button', { name: 'Unpublish course', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Unpublish course', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Publish course', exact: true }),
  ).toBeVisible();
  expect(fixture.mutations).toEqual([
    {
      method: 'POST',
      path: `/admin/courses/${fixtureCourseId}/unpublish`,
      body: null,
    },
  ]);
  expect(fixture.unexpected).toEqual([]);
});

test('loading preserves a recovery path and an error retries without exposing server internals', async ({
  page,
}) => {
  const fixture = await installWorkspaceFixtures(page, 'student');
  const path = '/students/me/courses';
  const release = fixture.hold(path);
  await page.goto('/learning');
  await expect(
    page.getByText('Loading your courses…', { exact: true }),
  ).toBeVisible();
  fixture.fail(path);
  release();
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  fixture.recover(path);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: course, exact: true }),
  ).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

test('anonymous access redirects to sign in and a student cannot enter moderation', async ({
  page,
}) => {
  const fixture = await installWorkspaceFixtures(page, 'student', {
    anonymous: true,
  });
  await page.goto('/learning');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(
    fixture.requests.some(({ path }) => path.startsWith('/students/')),
  ).toBe(false);
  expect(fixture.unexpected).toEqual([]);
});

test('forbidden and unknown pages provide usable fallback navigation', async ({
  page,
}) => {
  const fixture = await installWorkspaceFixtures(page, 'student');
  await page.goto('/admin/courses');
  await expect(
    page.getByRole('heading', {
      name: 'This page is for a different role',
      exact: true,
    }),
  ).toBeVisible();
  expect(fixture.requests.some(({ path }) => path.startsWith('/admin/'))).toBe(
    false,
  );
  await page.goto('/missing-workspace-fixture');
  await expect(
    page.getByRole('heading', { name: 'Page not found', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('main').getByRole('link').first()).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});

test('isolated public filters debounce search, discover categories, clear and restore history with truthful counts', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'IntersectionObserver', {
      value: undefined,
      configurable: true,
    });
  });
  const fixture = await installPublicUiFixtures(page);
  const queries: URLSearchParams[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/v1/courses') queries.push(url.searchParams);
  });
  await page.goto('/courses');
  await expect(
    page.getByText('18 courses available', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.catalog-course-card h3 a')).toHaveCount(9);
  expect(queries.some((params) => params.get('page_size') === '100')).toBe(
    false,
  );
  const search = page.getByRole('textbox', {
    name: 'Search courses',
    exact: true,
  });
  await search.fill('Catalog discovery');
  await expect(page).toHaveURL(/search=Catalog\+discovery/);
  await expect(
    page.getByText('17 courses match your filters', { exact: true }),
  ).toBeVisible();
  expect(
    queries
      .filter((params) => params.has('search'))
      .map((params) => params.get('search')),
  ).toEqual(['Catalog discovery']);
  const category = page.getByRole('combobox', {
    name: 'Category',
    exact: true,
  });
  await category.focus();
  await expect(
    category.getByRole('option', { name: 'Design', exact: true }),
  ).toHaveCount(1);
  expect(queries.some((params) => params.get('page_size') === '100')).toBe(
    true,
  );
  await category.selectOption('Design');
  await page
    .getByRole('combobox', { name: 'Level', exact: true })
    .selectOption('beginner');
  await expect(page).toHaveURL(/level=beginner/);
  const filteredUrl = page.url();
  const params = new URL(filteredUrl).searchParams;
  expect(Object.fromEntries(params)).toEqual({
    search: 'Catalog discovery',
    category: 'Design',
    level: 'beginner',
  });
  await expect(
    page.getByText('17 courses match your filters', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await expect(search).toHaveValue('');
  await expect(
    page.getByText('18 courses available', { exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  await page.goBack();
  await expect(page).toHaveURL(filteredUrl);
  await expect(search).toHaveValue('Catalog discovery');
  await expect(category).toHaveValue('Design');
  await expect(
    page.getByRole('combobox', { name: 'Level', exact: true }),
  ).toHaveValue('beginner');
  await expect(
    page.getByText('17 courses match your filters', { exact: true }),
  ).toBeVisible();
  expect(fixture.unexpected).toEqual([]);
});
