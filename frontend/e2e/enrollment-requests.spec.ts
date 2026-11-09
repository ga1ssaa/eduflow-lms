import { expect, test, type Page } from '@playwright/test';
import { installUiFixtures } from './fixtures/atmosphere';

/** All API traffic stays in browser fixtures; no backend or database is used. */
async function installEnrollmentFixtures(
  page: Page,
  initiallyEnrolled = false,
) {
  const base = await installUiFixtures(page, 'student', true);
  const course = base.courses[0];
  const module = course.modules[0];
  const lessons = module.lessons;
  const requests: Array<{ method: string; path: string }> = [];
  const unexpected: string[] = [];
  const accounts = [
    { ...base.user, email: 'first@example.test' },
    {
      ...base.user,
      id: '60000000-0000-4000-8000-000000000099',
      email: 'second@example.test',
      full_name: 'Second Learner',
    },
  ];
  let account = 0;
  let authenticated = true;
  const enrolled = [initiallyEnrolled, false];
  const completed = [new Set<string>(), new Set<string>()];
  const progress = () => ({
    course_id: course.id,
    total_lessons: lessons.length,
    completed_lessons: completed[account].size,
    progress_percentage: (completed[account].size / lessons.length) * 100,
    is_completed: completed[account].size === lessons.length,
  });
  const summary = () => ({
    ...progress(),
    enrollment_id: '60000000-0000-4000-8000-000000000200',
    title: course.title,
    slug: course.slug,
    description: course.description,
    category: course.category,
    level: course.level,
    status: course.status,
    is_available: true,
    instructor_name: course.instructor_name,
    enrolled_at: course.created_at,
  });
  const outline = [
    {
      id: module.id,
      title: module.title,
      position: module.position,
      lessons: lessons.map(({ id, title, position }) => ({
        id,
        title,
        position,
      })),
    },
  ];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    requests.push({ method, path });
    const json = (body: unknown, status = 200) =>
      route.fulfill({ json: body, status });
    if (method === 'POST' && path === '/auth/login') {
      account = accounts.findIndex(
        (user) => user.email === request.postDataJSON().email,
      );
      if (account < 0) throw new Error('Unknown isolated account');
      authenticated = true;
      return json({
        access_token: 'isolated-enrollment-fixture',
        token_type: 'bearer',
        expires_in: 900,
      });
    }
    if (method === 'POST' && path === '/auth/refresh')
      return authenticated
        ? json({
            access_token: 'isolated-enrollment-fixture',
            token_type: 'bearer',
            expires_in: 900,
          })
        : json({ detail: 'Not authenticated' }, 401);
    if (method === 'POST' && path === '/auth/logout') {
      authenticated = false;
      return route.fulfill({ status: 204 });
    }
    if (method === 'GET' && path === '/users/me')
      return json(accounts[account]);
    if (method === 'GET' && path === '/students/me/dashboard')
      return json({
        total_enrolled_courses: Number(enrolled[account]),
        completed_courses: Number(enrolled[account] && progress().is_completed),
        in_progress_courses: Number(
          enrolled[account] && !progress().is_completed,
        ),
        courses: enrolled[account] ? [summary()] : [],
      });
    if (method === 'GET' && path === '/students/me/courses')
      return json({
        items: enrolled[account] ? [summary()] : [],
        total: Number(enrolled[account]),
        page: 1,
        page_size: 12,
      });
    if (method === 'POST' && path === `/courses/${course.id}/enroll`) {
      enrolled[account] = true;
      return json({
        id: summary().enrollment_id,
        student_id: accounts[account].id,
        course_id: course.id,
        enrolled_at: course.created_at,
      });
    }
    if (method === 'GET' && path === `/students/me/courses/${course.id}`)
      return enrolled[account]
        ? json({ ...summary(), modules: outline, progress: progress() })
        : json({ detail: 'Not enrolled' }, 404);
    const match = path.match(/^\/students\/me\/lessons\/([^/]+)(\/complete)?$/);
    const lesson = lessons.find((item) => item.id === match?.[1]);
    if (lesson && enrolled[account]) {
      if (match?.[2] && ['POST', 'DELETE'].includes(method)) {
        if (method === 'POST') completed[account].add(lesson.id);
        else completed[account].delete(lesson.id);
        return json({
          lesson_id: lesson.id,
          is_completed: completed[account].has(lesson.id),
          completed_at: course.created_at,
          progress: progress(),
        });
      }
      if (method === 'GET' && !match?.[2])
        return json({
          ...lesson,
          course_id: course.id,
          course_title: course.title,
          module_title: module.title,
          is_completed: completed[account].has(lesson.id),
          completed_at: completed[account].has(lesson.id)
            ? course.created_at
            : null,
        });
    }
    if (
      method === 'GET' &&
      (path === '/courses' || path === `/courses/${course.slug}`)
    )
      return route.fallback();
    unexpected.push(`${method} ${path}`);
    return json({ detail: 'Unmodeled isolated enrollment route' }, 404);
  });
  return {
    course,
    lessons,
    requests,
    unexpected,
    detailRequests: () =>
      requests.filter(
        (request) =>
          request.method === 'GET' &&
          /^\/students\/me\/courses\/[^/]+$/.test(request.path),
      ),
  };
}

async function openDetails(page: Page, slug: string) {
  // Client-side navigation keeps the dashboard cache and session alive.
  await page.getByRole('link', { name: /Back to catalog/ }).click();
  await page.locator(`a[href="/courses/${slug}"]`).first().click();
}

async function expectAction(page: Page, name: string, courseId: string) {
  await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute(
    'href',
    `/learn/${courseId}`,
  );
  await expect(
    page.getByRole('button', {
      name: 'Enroll and Start Learning',
      exact: true,
    }),
  ).toHaveCount(0);
}

test('empty student dashboard → catalog → public details never probes protected enrollment detail', async ({
  page,
}) => {
  const ui = await installEnrollmentFixtures(page);
  await page.goto('/learning');
  await expect(
    page.getByRole('heading', { name: 'Your learning journey starts here' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Find a course', exact: true }).click();
  await page.locator(`a[href="/courses/${ui.course.slug}"]`).first().click();
  await expect(
    page.getByRole('button', {
      name: 'Enroll and Start Learning',
      exact: true,
    }),
  ).toBeEnabled();
  await openDetails(page, ui.course.slug);
  await expect(
    page.getByRole('button', {
      name: 'Enroll and Start Learning',
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    ui.requests.some(({ path }) => path === '/students/me/dashboard'),
  ).toBe(true);
  expect(ui.detailRequests()).toEqual([]);
  expect(ui.unexpected).toEqual([]);
});

test('enrollment and lesson progress preserve Start, Continue and Review without public detail probes', async ({
  page,
}) => {
  const ui = await installEnrollmentFixtures(page);
  await page.goto(`/courses/${ui.course.slug}`);
  await page
    .getByRole('button', { name: 'Enroll and Start Learning', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/learn/${ui.course.id}$`));
  await expect(
    page.getByRole('heading', { name: ui.lessons[0].title, exact: true }),
  ).toBeVisible();
  expect(ui.detailRequests().length).toBeGreaterThan(0);
  expect(
    ui.requests.filter(
      ({ method, path }) => method === 'POST' && path.endsWith('/enroll'),
    ),
  ).toHaveLength(1);
  for (const [index, action] of [
    'Start Learning',
    'Continue Learning',
    'Review Course',
  ].entries()) {
    const before = ui.detailRequests().length;
    // History navigation stays within the SPA and preserves progress invalidations.
    await page
      .getByRole('link', { name: /My learning/ })
      .first()
      .click();
    await page
      .getByRole('link', { name: 'Find a course', exact: true })
      .click();
    await page.locator(`a[href="/courses/${ui.course.slug}"]`).first().click();
    await expectAction(page, action, ui.course.id);
    expect(ui.detailRequests()).toHaveLength(before);
    if (index === 2) break;
    await page.getByRole('link', { name: action, exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Course lessons' })
      .getByRole('button')
      .nth(index)
      .click();
    await expect(
      page.getByRole('heading', { name: ui.lessons[index].title, exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Mark as complete', exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: 'Mark as incomplete', exact: true }),
    ).toBeVisible();
  }
  expect(ui.unexpected).toEqual([]);
});

test('logout and another student login do not reuse the prior account enrollment summary', async ({
  page,
}) => {
  const ui = await installEnrollmentFixtures(page, true);
  await page.goto(`/courses/${ui.course.slug}`);
  await expectAction(page, 'Start Learning', ui.course.id);
  await page.getByLabel('Account menu').click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Sign in to enroll', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Sign in to enroll', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Email address', exact: true })
    .fill('second@example.test');
  await page.getByLabel(/^Password/).fill('Isolated-password-1!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Enroll and Start Learning',
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    ui.requests.filter(({ path }) => path === '/students/me/dashboard').length,
  ).toBeGreaterThanOrEqual(2);
  expect(ui.detailRequests()).toEqual([]);
  expect(ui.unexpected).toEqual([]);
});
