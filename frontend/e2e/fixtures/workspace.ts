import type { Page } from '@playwright/test';
import { installUiFixtures, type UiFixtureRole } from './atmosphere';

/** Isolated UI state only. Fallback delegates to the existing fail-closed router,
 * never to a backend. No credentials, live authentication or database writes. */
export async function installWorkspaceFixtures(
  page: Page,
  role: UiFixtureRole,
  options: { empty?: boolean; anonymous?: boolean } = {},
) {
  const fixture = await installUiFixtures(page, role, options.empty);
  const mutations: Array<{ method: string; path: string; body: unknown }> = [];
  const failures = new Map<string, { status: number; remaining: number }>();
  const gates = new Map<string, Promise<void>>();
  let sequence = 900;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    const method = request.method();
    if (options.anonymous && path === '/auth/refresh') {
      await route.fulfill({
        status: 401,
        json: { detail: 'Not authenticated' },
      });
      return;
    }
    await gates.get(path);
    const failure = failures.get(path);
    if (failure && failure.remaining > 0) {
      failure.remaining--;
      await route.fulfill({
        status: failure.status,
        json: {
          detail:
            failure.status === 409
              ? 'Learning conflict'
              : 'Service temporarily unavailable',
        },
      });
      return;
    }
    const match = path.match(
      /^\/(instructor|admin)\/courses\/([^/]+)(?:\/(publish|unpublish|modules))?$/,
    );
    const course = fixture.courses.find((item) => item.id === match?.[2]);
    const moduleMatch = path.match(
      /^\/instructor\/modules\/([^/]+)(\/lessons)?$/,
    );
    const parent = fixture.courses.find((item) =>
      item.modules.some((module) => module.id === moduleMatch?.[1]),
    );
    const module = parent?.modules.find((item) => item.id === moduleMatch?.[1]);
    if (module && method === 'POST' && moduleMatch?.[2]) {
      const body = request.postDataJSON();
      mutations.push({ method, path, body });
      const lesson = {
        ...body,
        id: `60000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
        module_id: module.id,
        position: module.lessons.length + 1,
        created_at: parent!.created_at,
        updated_at: parent!.updated_at,
      };
      module.lessons.push(lesson);
      parent!.lesson_count++;
      await route.fulfill({ status: 201, json: lesson });
      return;
    }
    if (
      module &&
      method === 'DELETE' &&
      !moduleMatch?.[2] &&
      module.lessons.length === 0
    ) {
      mutations.push({ method, path, body: null });
      parent!.modules = parent!.modules.filter((item) => item.id !== module.id);
      parent!.module_count--;
      await route.fulfill({ status: 204 });
      return;
    }
    const lessonId = path.match(/^\/instructor\/lessons\/([^/]+)$/)?.[1];
    const lessonParent = fixture.courses.find((item) =>
      item.modules.some((item) =>
        item.lessons.some((lesson) => lesson.id === lessonId),
      ),
    );
    const lessonModule = lessonParent?.modules.find((item) =>
      item.lessons.some((lesson) => lesson.id === lessonId),
    );
    if (lessonModule && method === 'DELETE') {
      mutations.push({ method, path, body: null });
      lessonModule.lessons = lessonModule.lessons.filter(
        (lesson) => lesson.id !== lessonId,
      );
      lessonParent!.lesson_count--;
      await route.fulfill({ status: 204 });
      return;
    }
    if (
      course &&
      method === 'PATCH' &&
      match?.[1] === 'instructor' &&
      !match[3]
    ) {
      const body = request.postDataJSON();
      mutations.push({ method, path, body });
      Object.assign(course, body);
      await route.fulfill({ json: course });
      return;
    }
    if (
      course &&
      method === 'POST' &&
      ['publish', 'unpublish'].includes(match?.[3] ?? '')
    ) {
      mutations.push({ method, path, body: null });
      course.status = match![3] === 'publish' ? 'published' : 'draft';
      await route.fulfill({ json: course });
      return;
    }
    if (
      course &&
      method === 'POST' &&
      match?.[1] === 'instructor' &&
      match[3] === 'modules'
    ) {
      const body = request.postDataJSON();
      mutations.push({ method, path, body });
      const module = {
        id: `60000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`,
        course_id: course.id,
        title: body.title,
        position: course.modules.length + 1,
        lessons: [],
        created_at: course.created_at,
        updated_at: course.updated_at,
      };
      course.modules.push(module);
      course.module_count++;
      await route.fulfill({ status: 201, json: module });
      return;
    }
    // Unknown mutations reach the base router's explicit 404/unexpected list.
    await route.fallback();
  });
  return {
    ...fixture,
    mutations,
    fail(path: string, status = 503, count = 4) {
      failures.set(path, { status, remaining: count });
    },
    recover(path: string) {
      failures.delete(path);
    },
    hold(path: string) {
      let release!: () => void;
      gates.set(
        path,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return () => {
        gates.delete(path);
        release();
      };
    },
  };
}
