import { vi } from 'vitest';
import type { CourseRead, User } from '../lib/types';
import {
  instructor,
  jsonResponse,
  requestDetails,
  tokenResponse,
} from './fixtures';

export const authoringCourseId = '10000000-0000-4000-8000-000000000001';
export const firstModuleId = '10000000-0000-4000-8000-000000000002';
export const secondModuleId = '10000000-0000-4000-8000-000000000003';
export const firstLessonId = '10000000-0000-4000-8000-000000000004';
export const secondLessonId = '10000000-0000-4000-8000-000000000005';
const timestamp = '2026-11-04T00:00:00Z';

export function makeAuthoringCourse(
  overrides: Partial<CourseRead> = {},
): CourseRead {
  return {
    id: authoringCourseId,
    title: 'Authoring test course',
    slug: 'authoring-test-course',
    description: 'A useful course description.',
    category: 'Development',
    level: 'beginner',
    instructor_id: instructor.id,
    instructor_name: instructor.full_name,
    status: 'draft',
    published_at: null,
    module_count: 2,
    lesson_count: 2,
    created_at: timestamp,
    updated_at: timestamp,
    modules: [
      {
        id: firstModuleId,
        course_id: authoringCourseId,
        title: 'First module',
        position: 1,
        created_at: timestamp,
        updated_at: timestamp,
        lessons: [
          {
            id: firstLessonId,
            module_id: firstModuleId,
            title: 'First lesson',
            position: 1,
            content: 'First lesson text.',
            video_url: 'https://example.com/first-video',
            created_at: timestamp,
            updated_at: timestamp,
          },
          {
            id: secondLessonId,
            module_id: firstModuleId,
            title: 'Second lesson',
            position: 2,
            content: 'Second lesson text.',
            video_url: null,
            created_at: timestamp,
            updated_at: timestamp,
          },
        ],
      },
      {
        id: secondModuleId,
        course_id: authoringCourseId,
        title: 'Second module',
        position: 2,
        created_at: timestamp,
        updated_at: timestamp,
        lessons: [],
      },
    ],
    ...overrides,
  };
}

export interface AuthoringRequest {
  path: string;
  method: string;
  body: Record<string, unknown>;
}

export function stubAuthoringApi(
  options: {
    course?: CourseRead;
    user?: User;
    mutate?: (request: AuthoringRequest) => Response | Promise<Response>;
  } = {},
) {
  const server = {
    course: options.course ?? makeAuthoringCourse(),
    writes: [] as AuthoringRequest[],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const { path, method, body } = requestDetails(input, init);
      if (path.endsWith('/auth/refresh')) return tokenResponse();
      if (path.endsWith('/users/me'))
        return jsonResponse(options.user ?? instructor);
      if (method !== 'GET') {
        const request = {
          path,
          method,
          body: body
            ? (JSON.parse(String(body)) as Record<string, unknown>)
            : {},
        };
        server.writes.push(request);
        if (!options.mutate)
          throw new Error(`Unexpected mutation ${method} ${path}`);
        return options.mutate(request);
      }
      if (path.endsWith('/stats'))
        return jsonResponse({
          course_id: server.course.id,
          total_students: 1,
          completed_students: 0,
          in_progress_students: 1,
          average_progress_percentage: 50,
          total_lessons: 2,
        });
      if (path.endsWith('/students'))
        return jsonResponse({ items: [], total: 0, page: 1, page_size: 20 });
      if (path.endsWith('/courses'))
        return jsonResponse({
          items: [server.course],
          total: 1,
          page: 1,
          page_size: 12,
        });
      if (path.endsWith(`/courses/${server.course.id}`))
        return jsonResponse(server.course);
      throw new Error(`Unexpected query ${path}`);
    }),
  );
  return server;
}
