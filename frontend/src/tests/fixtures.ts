export const student = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'student@example.test',
  full_name: 'Student Example',
  role: 'student' as const,
  is_active: true,
  created_at: '2026-11-04T00:00:00Z',
  updated_at: '2026-11-04T00:00:00Z',
};

export const instructor = {
  ...student,
  id: '00000000-0000-4000-8000-000000000002',
  role: 'instructor' as const,
};
export const admin = {
  ...student,
  id: '00000000-0000-4000-8000-000000000003',
  role: 'admin' as const,
};
export const credentials = {
  email: student.email,
  password: 'Example-password-42!',
};
export const initialToken = 'test-access-initial';
export const refreshedToken = 'test-access-refreshed';

export function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function tokenResponse(access_token = initialToken) {
  return jsonResponse({ access_token, token_type: 'bearer', expires_in: 900 });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function requestDetails(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : null;
  return {
    path: new URL(request?.url ?? String(input), 'http://localhost').pathname,
    method: init?.method ?? request?.method ?? 'GET',
    headers: new Headers(init?.headers ?? request?.headers),
    credentials: init?.credentials ?? request?.credentials,
    body: init?.body,
    signal: init?.signal ?? request?.signal,
  };
}

export const courseId = '00000000-0000-4000-8000-000000000010';
export const moduleId = '00000000-0000-4000-8000-000000000011';
export const lessonId = '00000000-0000-4000-8000-000000000012';
export const enrollmentId = '00000000-0000-4000-8000-000000000013';
export const progress = {
  course_id: courseId,
  total_lessons: 1,
  completed_lessons: 0,
  progress_percentage: 0,
  is_completed: false,
};
export const enrolledSummary = {
  ...progress,
  enrollment_id: enrollmentId,
  title: 'Learn together',
  slug: 'learn-together',
  description: 'A course for learning.',
  category: 'Development',
  level: 'beginner' as const,
  status: 'published' as const,
  is_available: true,
  instructor_name: 'Instructor Example',
  enrolled_at: '2026-11-04T00:00:00Z',
};
export const studentCourse = {
  ...enrolledSummary,
  modules: [
    {
      id: moduleId,
      title: 'Getting started',
      position: 1,
      lessons: [{ id: lessonId, title: 'First lesson', position: 1 }],
    },
  ],
  progress,
};
export const studentLesson = {
  id: lessonId,
  title: 'First lesson',
  content: 'Only enrolled students can read this lesson.',
  video_url: null,
  position: 1,
  course_id: courseId,
  module_id: moduleId,
  module_title: 'Getting started',
  course_title: 'Learn together',
  is_completed: false,
  completed_at: null,
};
