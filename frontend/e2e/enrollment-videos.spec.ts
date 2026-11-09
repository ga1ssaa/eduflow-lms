import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fixtureCourseId } from './fixtures/atmosphere';
import { installWorkspaceFixtures } from './fixtures/workspace';
import { chooseTheme } from './theme';

test.use({ screenshot: 'off', video: 'off', trace: 'off' });
const fixturePath = process.env.EDUFLOW_E2E_FIXTURE_FILE;
const fixture: { course: { id: string; slug: string; title: string } } | null =
  fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;

async function assertCourseAction(page: Page, name: string) {
  await expect(page.getByRole('link', { name, exact: true })).toHaveAttribute(
    'href',
    `/learn/${fixture!.course.id}`,
  );
  await expect(
    page.getByRole('button', {
      name: 'Enroll and Start Learning',
      exact: true,
    }),
  ).toHaveCount(0);
}

test('REAL API new enrollment becomes Start, Continue and Review and survives reload and sign-in', async ({
  page,
}) => {
  test.skip(!fixture, 'Requires private isolated real-API course fixtures.');
  const course = fixture!.course;
  const account = {
    email: `video-enrollment-${crypto.randomUUID()}@example.com`,
    password: `Study-${crypto.randomUUID()}!`,
  };
  await page.goto('/register');
  await page
    .getByRole('textbox', { name: 'Full name', exact: true })
    .fill('Enrollment Browser Student');
  await page
    .getByRole('textbox', { name: 'Email address', exact: true })
    .fill(account.email);
  await page.getByLabel(/^Password/).fill(account.password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page).toHaveURL(/\/learning$/);
  await page.goto(`/courses/${course.slug}`);
  const enrollments: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname === `/api/v1/courses/${course.id}/enroll`
    )
      enrollments.push('enroll');
  });
  const enrolled = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        `/api/v1/courses/${course.id}/enroll`,
  );
  await page
    .getByRole('button', { name: 'Enroll and Start Learning', exact: true })
    .dblclick();
  expect((await enrolled).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/learn/${course.id}`));
  expect(enrollments).toHaveLength(1);
  await page.goto(`/courses/${course.slug}`);
  await assertCourseAction(page, 'Start Learning');
  await page.getByRole('link', { name: 'Start Learning', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Course lessons' })
      .getByRole('button'),
  ).toHaveCount(2);
  await page
    .getByRole('button', { name: 'Mark as complete', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Mark as incomplete', exact: true }),
  ).toBeVisible();
  await page.goto(`/courses/${course.slug}`);
  await assertCourseAction(page, 'Continue Learning');
  await page
    .getByRole('link', { name: 'Continue Learning', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Course lessons' })
    .getByRole('button')
    .nth(1)
    .click();
  await page
    .getByRole('button', { name: 'Mark as complete', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Mark as incomplete', exact: true }),
  ).toBeVisible();
  await page.goto(`/courses/${course.slug}`);
  await assertCourseAction(page, 'Review Course');
  await page.reload();
  await assertCourseAction(page, 'Review Course');
  await page.getByLabel('Account menu').click();
  const revoked = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/logout',
  );
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  expect((await revoked).status()).toBe(204);
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === 'eduflow_refresh',
    ),
  ).toBe(false);
  await page.goto('/login');
  await page
    .getByRole('textbox', { name: 'Email address', exact: true })
    .fill(account.email);
  await page.getByLabel(/^Password/).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Account menu')).toBeVisible();
  await page.goto(`/courses/${course.slug}`);
  await assertCourseAction(page, 'Review Course');
  expect(enrollments).toHaveLength(1);
});

// Public media/attribution from the checked-in demo manifest. Playback is
// intentionally aborted: these are fail-closed UI cases, not media availability proof.
const media =
  'https://upload.wikimedia.org/wikipedia/commons/6/6f/Pythonlectureseverance1.3.webm';
const attribution =
  'Source: https://commons.wikimedia.org/wiki/File:Pythonlectureseverance1.3.webm\nAuthor: Charles Severance (University of Michigan)\nLicense: CC BY 3.0 — https://creativecommons.org/licenses/by/3.0/';

test('ISOLATED UI video failure preserves native controls, readable attribution and independent completion at all widths', async ({
  page,
}) => {
  const ui = await installWorkspaceFixtures(page, 'student');
  const lesson = ui.courses[0].modules[0].lessons[1];
  lesson.video_url = media;
  lesson.content = `[Fixture] Supplementary video.\n${attribution}`;
  let mediaAttempts = 0;
  await page.route(media, (route) => {
    mediaAttempts++;
    return route.abort('failed');
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/learn/${fixtureCourseId}?lesson=${lesson.id}`);
  const video = page.locator('video');
  await expect(video).toHaveAttribute('src', media);
  await expect(video).toHaveAttribute(
    'aria-label',
    `Lesson video: ${lesson.title}`,
  );
  expect(
    await video.evaluate((element) => {
      const media = element as HTMLVideoElement;
      return (
        media.controls &&
        media.playsInline &&
        !media.autoplay &&
        media.preload === 'metadata'
      );
    }),
  ).toBe(true);
  await expect(
    page.getByText(
      'The video could not load. You can open the source or continue with the lesson text.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(mediaAttempts).toBeGreaterThan(0);
  const source = page.getByRole('link', { name: /^Open lesson video/ });
  await expect(source).toHaveAttribute('href', media);
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
  const text = page.locator('.lesson-text');
  await expect(text).toContainText(
    'Source: https://commons.wikimedia.org/wiki/File:Pythonlectureseverance1.3.webm',
  );
  await expect(text).toContainText(
    'Charles Severance (University of Michigan)',
  );
  await expect(text).toContainText('CC BY 3.0');
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await chooseTheme(page, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${width}/${theme}: document overflow`,
      ).toBe(true);
      const box = await video.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
  }
  await page
    .getByRole('button', { name: 'Mark as complete', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Mark as incomplete', exact: true }),
  ).toBeVisible();
  expect(
    ui.requests.filter(
      (request) =>
        request.method === 'POST' &&
        request.path.endsWith(`/lessons/${lesson.id}/complete`),
    ),
  ).toHaveLength(1);
  expect(ui.unexpected).toEqual([]);
});

test('ISOLATED UI missing and unsafe video URLs never create media or executable links', async ({
  page,
}) => {
  const ui = await installWorkspaceFixtures(page, 'student');
  const lesson = ui.courses[0].modules[0].lessons[1];
  for (const url of [
    null,
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'https://user:password@example.test/video.webm',
  ]) {
    lesson.video_url = url;
    await page.goto(`/learn/${fixtureCourseId}?lesson=${lesson.id}`);
    await expect(
      page.getByRole('heading', { name: lesson.title, exact: true }),
    ).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: /^Open lesson video/ }),
    ).toHaveCount(0);
    await expect(page.locator('.lesson-text')).toHaveText(lesson.content);
    if (url)
      await expect(
        page.getByText('This lesson’s video URL is not supported.', {
          exact: true,
        }),
      ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Mark as complete', exact: true }),
    ).toBeEnabled();
  }
  expect(ui.unexpected).toEqual([]);
});
