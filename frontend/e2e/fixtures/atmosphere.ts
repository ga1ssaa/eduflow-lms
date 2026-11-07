import type { Page } from '@playwright/test';
import type {
  CourseRead,
  CourseSummary,
  EnrolledCourseSummary,
  PublicCourseSummary,
  User,
} from '../../src/lib/types.ts';

/** ISOLATED UI FIXTURES: no live authentication, credentials or database writes.
 * Every API route is fulfilled here; unmodeled paths fail closed instead of
 * forwarding dummy bearer tokens to the real API. Names remain visibly labelled.
 */
export type UiFixtureRole = 'student' | 'instructor' | 'admin';
export const fixtureCourseId = '60000000-0000-4000-8000-000000000010';
export const fixtureCourseSlug = 'fixture-interface-foundations';
export const fixtureLessonId = '60000000-0000-4000-8000-000000000100';
const time = '2026-11-05T00:00:00Z';
const uuid = (number: number) =>
  `60000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

const publicSummary = (course: CourseRead): PublicCourseSummary => ({
  id: course.id,
  slug: course.slug,
  title: course.title,
  description: course.description,
  category: course.category,
  level: course.level,
  instructor_name: course.instructor_name,
  module_count: course.module_count,
  lesson_count: course.lesson_count,
  published_at: course.published_at,
});

export async function installUiFixtures(
  page: Page,
  role: UiFixtureRole,
  empty = false,
) {
  const requests: Array<{ method: string; path: string }> = [];
  const unexpected: string[] = [];
  const user: User = {
    id: uuid(role === 'student' ? 1 : role === 'instructor' ? 2 : 3),
    email: `fixture-${role}@example.test`,
    full_name: `Fixture ${role === 'admin' ? 'Administrator' : role === 'student' ? 'Learner' : 'Instructor'}`,
    role,
    is_active: true,
    created_at: time,
    updated_at: time,
  };
  const courses: CourseRead[] = [
    'Interface foundations',
    'Practical Python',
    'Data storytelling',
  ].map((title, index) => {
    const id = uuid(10 + index),
      moduleId = uuid(50 + index);
    const status = index === 2 ? 'draft' : 'published';
    return {
      id,
      slug: index === 0 ? fixtureCourseSlug : `fixture-course-${index}`,
      title: `[Fixture] ${title}`,
      description:
        'Isolated UI demonstration data. No live learner or course records are shown.',
      category: index === 1 ? 'Programming' : 'Design',
      level: index === 1 ? 'intermediate' : 'beginner',
      instructor_id: uuid(2),
      instructor_name: 'Fixture Instructor',
      status,
      published_at: status === 'published' ? time : null,
      created_at: time,
      updated_at: time,
      module_count: 1,
      lesson_count: 2,
      modules: [
        {
          id: moduleId,
          course_id: id,
          title: '[Fixture] Start here',
          position: 1,
          created_at: time,
          updated_at: time,
          lessons: [0, 1].map((lesson) => ({
            id: uuid(100 + index * 10 + lesson),
            module_id: moduleId,
            title: `[Fixture] ${lesson === 0 ? 'Build a clear foundation' : 'Put your learning into practice'}`,
            position: lesson + 1,
            content:
              '[Fixture] Learn through a small, focused example. This is isolated demonstration content.',
            video_url: null,
            created_at: time,
            updated_at: time,
          })),
        },
      ],
    };
  });
  const completed = new Map(
    courses.map((course, index) => [
      course.id,
      new Set(
        index === 0
          ? [course.modules[0].lessons[0].id]
          : index === 1
            ? course.modules[0].lessons.map((lesson) => lesson.id)
            : [],
      ),
    ]),
  );
  const progress = (course: CourseRead) => ({
    course_id: course.id,
    total_lessons: course.lesson_count,
    completed_lessons: completed.get(course.id)!.size,
    progress_percentage: completed.get(course.id)!.size * 50,
    is_completed: completed.get(course.id)!.size === course.lesson_count,
  });
  const summary = (course: CourseRead): CourseSummary => ({
    ...publicSummary(course),
    instructor_id: course.instructor_id,
    status: course.status,
    created_at: course.created_at,
    updated_at: course.updated_at,
  });
  const enrolled = (course: CourseRead): EnrolledCourseSummary => ({
    ...progress(course),
    enrollment_id: uuid(200 + courses.indexOf(course)),
    title: course.title,
    slug: course.slug,
    description: course.description,
    category: course.category,
    level: course.level,
    status: course.status,
    is_available: course.status === 'published',
    instructor_name: course.instructor_name,
    enrolled_at: time,
  });
  const outline = (course: CourseRead) =>
    course.modules.map((module) => ({
      id: module.id,
      title: module.title,
      position: module.position,
      lessons: module.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        position: lesson.position,
      })),
    }));

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    const method = request.method();
    requests.push({ method, path });
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });
    const notFound = () =>
      json({ detail: 'Fixture resource unavailable' }, 404);
    const paginate = <T>(items: T[]) => {
      const pageNumber = Math.max(1, Number(url.searchParams.get('page') ?? 1));
      const pageSize = Math.max(
        1,
        Number(url.searchParams.get('page_size') ?? 20),
      );
      return {
        items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
        total: items.length,
        page: pageNumber,
        page_size: pageSize,
      };
    };
    if (path === '/auth/refresh' && method === 'POST')
      return json({
        access_token: `isolated-ui-fixture-${role}`,
        token_type: 'bearer',
        expires_in: 900,
      });
    if (path === '/auth/logout' && method === 'POST')
      return route.fulfill({ status: 204 });
    if (path === '/users/me' && method === 'GET') return json(user);
    if (path === '/students/me/dashboard' && method === 'GET') {
      const items = empty ? [] : courses.map(enrolled);
      const finished = items.filter((course) => course.is_completed).length;
      return json({
        total_enrolled_courses: items.length,
        completed_courses: finished,
        in_progress_courses: items.length - finished,
        courses: items,
      });
    }
    if (path === '/students/me/courses' && method === 'GET')
      return json(paginate(empty ? [] : courses.map(enrolled)));
    const studentCourse = path.match(
      /^\/students\/me\/courses\/([^/]+)(\/progress)?$/,
    );
    if (studentCourse && method === 'GET') {
      const course = courses.find((course) => course.id === studentCourse[1]);
      if (!course || course.status !== 'published' || empty) return notFound();
      return json(
        studentCourse[2]
          ? progress(course)
          : {
              ...enrolled(course),
              modules: outline(course),
              progress: progress(course),
            },
      );
    }
    const studentLesson = path.match(
      /^\/students\/me\/lessons\/([^/]+)(\/complete)?$/,
    );
    if (studentLesson) {
      const course = courses.find((course) =>
        course.modules.some((module) =>
          module.lessons.some((lesson) => lesson.id === studentLesson[1]),
        ),
      );
      if (!course || course.status !== 'published' || empty) return notFound();
      const module = course.modules[0];
      const lesson = module.lessons.find(
        (lesson) => lesson.id === studentLesson[1],
      )!;
      if (studentLesson[2] && ['POST', 'DELETE'].includes(method)) {
        if (method === 'POST') completed.get(course.id)!.add(lesson.id);
        else completed.get(course.id)!.delete(lesson.id);
        const done = completed.get(course.id)!.has(lesson.id);
        return json({
          lesson_id: lesson.id,
          is_completed: done,
          completed_at: done ? time : null,
          progress: progress(course),
        });
      }
      if (method === 'GET' && !studentLesson[2]) {
        const done = completed.get(course.id)!.has(lesson.id);
        return json({
          id: lesson.id,
          title: lesson.title,
          content: lesson.content,
          video_url: lesson.video_url,
          position: lesson.position,
          course_id: course.id,
          module_id: module.id,
          module_title: module.title,
          course_title: course.title,
          is_completed: done,
          completed_at: done ? time : null,
        });
      }
    }
    const management = path.match(
      /^\/(instructor|admin)\/courses(?:\/([^/]+))?(?:\/(stats|students))?$/,
    );
    if (management && method === 'GET') {
      if (!management[2]) {
        const status = url.searchParams.get('status');
        const search = url.searchParams.get('search')?.toLowerCase();
        return json(
          paginate(
            (empty ? [] : courses)
              .filter(
                (course) =>
                  (!status || course.status === status) &&
                  (!search || course.title.toLowerCase().includes(search)),
              )
              .map(summary),
          ),
        );
      }
      const course = courses.find((course) => course.id === management[2]);
      if (!course) return notFound();
      if (management[3] === 'stats')
        return json({
          course_id: course.id,
          total_students: empty ? 0 : 3,
          completed_students: empty ? 0 : 1,
          in_progress_students: empty ? 0 : 2,
          average_progress_percentage: empty ? 0 : 50,
          total_lessons: 2,
        });
      if (management[3] === 'students')
        return json(
          paginate(
            empty
              ? []
              : [50, 100, 0].map((percent, index) => ({
                  student_id: uuid(300 + index),
                  full_name: `[Fixture] Learner ${index + 1}`,
                  enrollment_id: uuid(400 + index),
                  enrolled_at: time,
                  total_lessons: 2,
                  completed_lessons: percent / 50,
                  progress_percentage: percent,
                  is_completed: percent === 100,
                })),
          ),
        );
      return json(course);
    }
    if (path === '/courses' && method === 'GET')
      return json(
        paginate(
          courses
            .filter((course) => course.status === 'published')
            .map(publicSummary),
        ),
      );
    const publicCourse = path.match(/^\/courses\/([^/]+)$/);
    if (publicCourse && method === 'GET') {
      const course = courses.find(
        (course) =>
          course.slug === publicCourse[1] && course.status === 'published',
      );
      return course
        ? json({ ...publicSummary(course), modules: outline(course) })
        : notFound();
    }
    unexpected.push(`${method} ${path}`);
    return json({ detail: 'Unmodeled isolated UI fixture route' }, 404);
  });
  return { user, courses, requests, unexpected };
}

/** Public UI coverage with a known second page; all unmatched APIs stay isolated. */
export async function installPublicUiFixtures(page: Page) {
  const fixture = await installUiFixtures(page, 'student');
  const template = fixture.courses[0];
  const courses = Array.from(
    { length: 18 },
    (_, index): PublicCourseSummary => ({
      ...publicSummary(template),
      id: index === 0 ? template.id : uuid(700 + index),
      slug: index === 0 ? template.slug : `fixture-public-course-${index + 1}`,
      title:
        index === 0
          ? template.title
          : `[Fixture] Catalog discovery ${index + 1}`,
    }),
  );
  await page.route('**/api/v1/auth/refresh', (route) => {
    fixture.requests.push({
      method: route.request().method(),
      path: '/auth/refresh',
    });
    return route.fulfill({
      status: 401,
      json: { detail: 'Anonymous isolated UI fixture' },
    });
  });
  await page.route('**/api/v1/courses**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (request.method() !== 'GET' || !/^\/courses(?:\/[^/]+)?$/.test(path))
      return route.fallback();
    fixture.requests.push({ method: 'GET', path });
    if (path !== '/courses') {
      const course = courses.find((item) => `/courses/${item.slug}` === path);
      return route.fulfill({
        status: course ? 200 : 404,
        json: course
          ? {
              ...course,
              modules: template.modules.map((module) => ({
                id: module.id,
                title: module.title,
                position: module.position,
                lessons: module.lessons.map((lesson) => ({
                  id: lesson.id,
                  title: lesson.title,
                  position: lesson.position,
                })),
              })),
            }
          : { detail: 'Isolated public course unavailable' },
      });
    }
    const search = url.searchParams.get('search')?.toLowerCase();
    const category = url.searchParams.get('category');
    const level = url.searchParams.get('level');
    const filtered = courses.filter(
      (course) =>
        (!search || course.title.toLowerCase().includes(search)) &&
        (!category || course.category === category) &&
        (!level || course.level === level),
    );
    const pageNumber = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const pageSize = Math.max(
      1,
      Number(url.searchParams.get('page_size') ?? 20),
    );
    return route.fulfill({
      json: {
        items: filtered.slice(
          (pageNumber - 1) * pageSize,
          pageNumber * pageSize,
        ),
        total: filtered.length,
        page: pageNumber,
        page_size: pageSize,
      },
    });
  });
  return { ...fixture, courses };
}
