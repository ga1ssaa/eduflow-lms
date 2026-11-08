import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { chooseTheme } from './theme';

type Account = { email: string; password: string };
const fixturePath = process.env.EDUFLOW_E2E_FIXTURE_FILE;
const accounts: {
  instructor: Account;
  student: Account;
  admin: Account;
} | null = fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;
test.skip(
  !accounts,
  'Requires private accounts on the isolated eduflow_test_* API and Vite proxy.',
);

async function login(page: Page, account: Account) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(account.email);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Account menu')).toBeVisible();
}

async function logout(page: Page) {
  await page.getByLabel('Account menu').click();
  const revoked = page.waitForResponse((response) =>
    response.url().endsWith('/auth/logout'),
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  expect((await revoked).status()).toBe(204);
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(
    page.getByRole('heading', { name: 'Welcome back.', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Account menu')).toHaveCount(0);
}

async function confirm(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page
    .getByRole('dialog', { name: label, exact: true })
    .getByRole('button', { name: label, exact: true })
    .click();
}

async function createCourse(page: Page, title: string, slug: string) {
  await page.goto('/instructor/courses/new');
  await page.getByLabel(/^Course title/).fill(title);
  await page.getByLabel(/^Slug/).fill(slug);
  await page
    .getByLabel(/^Description/)
    .fill('A browser-authored course using the real API.');
  await page.getByLabel(/^Category/).fill('Browser QA');
  await page
    .getByRole('button', { name: 'Create course', exact: true })
    .click();
  await expect(page).toHaveURL(/\/instructor\/courses\/[\da-f-]+\/edit$/);
  return new URL(page.url()).pathname.split('/')[3];
}

test('author creates, orders and publishes curriculum; learning records survive moderation and deletion attempts', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const f = accounts!;
  const marker = crypto.randomUUID();
  const title = `Browser authoring ${marker}`;
  const slug = `browser-authoring-${marker}`;
  await login(page, f.instructor);
  const courseId = await createCourse(page, title, slug);
  await expect(page.getByLabel(/^Category/)).toHaveValue('Browser QA');
  await page.getByLabel(/^Category/).fill('Updated Browser QA');
  const coursePatch = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().endsWith(`/courses/${courseId}`),
  );
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  expect((await coursePatch).postDataJSON()).toEqual({
    category: 'Updated Browser QA',
  });
  await expect(page.getByText('Course saved.', { exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Slug/)).toHaveValue(slug);
  await page.goto(`/instructor/courses/${courseId}/curriculum`);
  for (const name of ['Foundations', 'Practice']) {
    await page.getByLabel('New module title').fill(name);
    await page.getByRole('button', { name: 'Add module', exact: true }).click();
    await expect(
      page.getByRole('region', { name: `Module: ${name}`, exact: true }),
    ).toBeVisible();
  }
  for (const [before, after] of [
    ['Practice', 'Applied practice'],
    ['Applied practice', 'Practice'],
  ]) {
    const region = page.getByRole('region', {
      name: `Module: ${before}`,
      exact: true,
    });
    await region
      .getByLabel(`Module title: ${before}`, { exact: true })
      .fill(after);
    const modulePatch = page.waitForRequest(
      (request) =>
        request.method() === 'PATCH' &&
        request.url().includes('/instructor/modules/'),
    );
    await region
      .getByRole('button', { name: 'Save module', exact: true })
      .click();
    expect((await modulePatch).postDataJSON()).toEqual({ title: after });
    await expect(
      page.getByRole('region', { name: `Module: ${after}`, exact: true }),
    ).toBeVisible();
  }
  const module = page.getByRole('region', {
    name: 'Module: Foundations',
    exact: true,
  });
  await module.getByText('Add a lesson', { exact: true }).click();
  for (const name of ['Lesson one', 'Lesson two']) {
    const form = module.getByRole('form', { name: 'Add lesson', exact: true });
    await form.getByLabel(/^Lesson title/).fill(name);
    await form
      .getByLabel(/^Lesson content/)
      .fill(`Private browser text for ${name}.`);
    await form.getByRole('button', { name: 'Add lesson', exact: true }).click();
    await expect(
      module.getByRole('article', { name: `Lesson: ${name}`, exact: true }),
    ).toBeVisible();
  }
  await module
    .getByRole('button', { name: 'Edit lesson: Lesson one', exact: true })
    .click();
  const lessonEditor = module.getByRole('form', {
    name: 'Edit lesson: Lesson one',
    exact: true,
  });
  await lessonEditor
    .getByLabel(/^Video URL/)
    .fill('https://example.com/browser-lesson-video');
  const videoPatch = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().includes('/instructor/lessons/'),
  );
  await lessonEditor
    .getByRole('button', { name: 'Save lesson', exact: true })
    .click();
  expect((await videoPatch).postDataJSON()).toEqual({
    video_url: 'https://example.com/browser-lesson-video',
  });
  await expect(
    lessonEditor.getByText('Lesson saved.', { exact: true }),
  ).toBeVisible();
  await lessonEditor.getByLabel(/^Video URL/).fill('');
  const clearedVideoPatch = page.waitForRequest(
    (request) =>
      request.method() === 'PATCH' &&
      request.url().includes('/instructor/lessons/'),
  );
  await lessonEditor
    .getByRole('button', { name: 'Save lesson', exact: true })
    .click();
  expect((await clearedVideoPatch).postDataJSON()).toEqual({ video_url: null });
  await expect(
    lessonEditor.getByText('Lesson saved.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Move module Practice up', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: /^Module:/ }).first(),
  ).toHaveAccessibleName('Module: Practice');
  await module
    .getByRole('button', { name: 'Move lesson Lesson two up', exact: true })
    .click();
  await expect(module.getByRole('article').first()).toHaveAccessibleName(
    'Lesson: Lesson two',
  );
  await page.getByLabel('New module title').fill('Temporary module');
  await page.getByRole('button', { name: 'Add module', exact: true }).click();
  const temporary = page.getByRole('region', {
    name: 'Module: Temporary module',
    exact: true,
  });
  await expect(temporary).toBeVisible();
  await temporary.getByText('Add a lesson', { exact: true }).click();
  const temporaryForm = temporary.getByRole('form', {
    name: 'Add lesson',
    exact: true,
  });
  await temporaryForm.getByLabel(/^Lesson title/).fill('Temporary lesson');
  await temporaryForm
    .getByLabel(/^Lesson content/)
    .fill('Disposable fixture content.');
  await temporaryForm
    .getByRole('button', { name: 'Add lesson', exact: true })
    .click();
  await expect(
    temporary.getByRole('article', {
      name: 'Lesson: Temporary lesson',
      exact: true,
    }),
  ).toBeVisible();
  for (const kind of ['lesson', 'module'] as const) {
    const target = `Temporary ${kind}`;
    await page
      .getByRole('button', { name: `Delete ${kind}: ${target}`, exact: true })
      .click();
    const deletedChild = page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        response.url().includes(`/instructor/${kind}s/`),
    );
    await page
      .getByRole('dialog', { name: `Delete ${kind}?`, exact: true })
      .getByRole('button', { name: `Delete ${kind}`, exact: true })
      .click();
    expect((await deletedChild).status()).toBe(204);
    await expect(
      page.getByRole(kind === 'lesson' ? 'article' : 'region', {
        name: `${kind === 'lesson' ? 'Lesson' : 'Module'}: ${target}`,
        exact: true,
      }),
    ).toHaveCount(0);
  }
  await expect(page.getByRole('region', { name: /^Module:/ })).toHaveCount(2);
  await expect(module.getByRole('article')).toHaveCount(2);
  await page.goto(`/instructor/courses/${courseId}`);
  await confirm(page, 'Publish course');
  await expect(
    page.getByRole('button', { name: 'Unpublish course', exact: true }),
  ).toBeVisible();
  await logout(page);

  await login(page, f.student);
  await page.goto(`/courses/${slug}`);
  await expect(
    page.getByText('Private browser text for Lesson two.', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Enroll and start learning' }).click();
  await expect(
    page.getByText('Private browser text for Lesson two.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Mark as complete', exact: true })
    .click();
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await chooseTheme(page, 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(
    page.getByRole('button', { name: 'Mark as incomplete' }),
  ).toBeVisible();
  await page.goto('/instructor/courses/new');
  await expect(
    page.getByRole('heading', { name: 'This page is for a different role' }),
  ).toBeVisible();
  await logout(page);

  await login(page, f.instructor);
  await page.goto(`/instructor/courses/${courseId}/students`);
  const learner = page.getByRole('row', { name: /Frontend Student/ });
  await expect(learner).toBeVisible();
  await expect(learner).toContainText('1 / 2');
  await expect(learner).toContainText('50%');
  await logout(page);

  await login(page, f.admin);
  await page.goto(`/admin/courses/${courseId}`);
  await confirm(page, 'Unpublish course');
  await expect(
    page.getByRole('button', { name: 'Publish course', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Delete draft', exact: true }),
  ).toHaveCount(0);
  await logout(page);

  await login(page, f.instructor);
  await page.goto(`/instructor/courses/${courseId}`);
  const rejectedDelete = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      response.url().endsWith(`/courses/${courseId}`),
  );
  await confirm(page, 'Delete draft');
  expect((await rejectedDelete).status()).toBe(409);
  await expect(
    page.getByRole('dialog', { name: 'Delete draft' }).getByRole('alert'),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Delete draft' })
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: title, exact: true }),
  ).toBeVisible();
  const disposableId = await createCourse(
    page,
    `Disposable ${marker}`,
    `disposable-${marker}`,
  );
  await page.goto(`/instructor/courses/${disposableId}`);
  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      response.url().endsWith(`/courses/${disposableId}`),
  );
  await confirm(page, 'Delete draft');
  expect((await deleted).status()).toBe(204);
  await expect(page).toHaveURL(/\/instructor\/courses$/);
});
