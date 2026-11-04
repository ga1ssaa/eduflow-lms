import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  courseId,
  enrolledSummary,
  jsonResponse,
  lessonId,
  progress,
  requestDetails,
  student,
  studentCourse,
  studentLesson,
  tokenResponse,
} from './fixtures';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', undefined);
});

async function renderLearning(path: string) {
  const { default: App } = await import('../App');
  const { AuthProvider } = await import('../auth/AuthProvider');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe('learning integration', () => {
  it('updates lesson state and refreshes course, dashboard, list and instructor caches after completion', async () => {
    let completed = false;
    let courseReads = 0;
    const completedAt = '2026-11-04T01:00:00Z';
    const currentProgress = () => ({
      ...progress,
      completed_lessons: completed ? 1 : 0,
      progress_percentage: completed ? 100 : 0,
      is_completed: completed,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path, method } = requestDetails(input, init);
        if (path.endsWith('/auth/refresh')) return tokenResponse();
        if (path.endsWith('/users/me')) return jsonResponse(student);
        if (path.endsWith('/complete')) {
          completed = method === 'POST';
          return jsonResponse({
            lesson_id: lessonId,
            is_completed: completed,
            completed_at: completed ? completedAt : null,
            progress: currentProgress(),
          });
        }
        if (path === `/api/v1/students/me/courses/${courseId}`) {
          courseReads += 1;
          return jsonResponse({
            ...studentCourse,
            ...currentProgress(),
            progress: currentProgress(),
          });
        }
        if (path === `/api/v1/students/me/lessons/${lessonId}`)
          return jsonResponse({
            ...studentLesson,
            is_completed: completed,
            completed_at: completed ? completedAt : null,
          });
        throw new Error(`Unexpected request ${method} ${path}`);
      }),
    );
    const client = await renderLearning(`/learn/${courseId}`);
    expect(await screen.findByText(studentLesson.content)).toBeInTheDocument();
    const dashboardKey = ['student', student.id, 'dashboard'];
    const listKey = ['student', student.id, 'courses', 1];
    const statsKey = ['author', 'stats', courseId];
    client.setQueryData(dashboardKey, {
      total_enrolled_courses: 1,
      completed_courses: 0,
      in_progress_courses: 1,
      courses: [enrolledSummary],
    });
    client.setQueryData(listKey, {
      items: [enrolledSummary],
      total: 1,
      page: 1,
      page_size: 12,
    });
    client.setQueryData(statsKey, {
      course_id: courseId,
      total_students: 1,
      completed_students: 0,
      in_progress_students: 1,
      average_progress_percentage: 0,
      total_lessons: 1,
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Mark as complete' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Mark as incomplete' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('100%')).toBeInTheDocument();
    await waitFor(() => expect(courseReads).toBeGreaterThanOrEqual(2));
    for (const key of [dashboardKey, listKey, statsKey])
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(
      client.getQueryData(['student', student.id, 'lesson', lessonId]),
    ).toMatchObject({ is_completed: true, completed_at: completedAt });
    await userEvent.click(
      screen.getByRole('button', { name: 'Mark as incomplete' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Mark as complete' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('0%')).toBeInTheDocument();
  });

  it('renders an unavailable enrolled course without exposing a lesson link or requesting content', async () => {
    const summary = {
      ...enrolledSummary,
      status: 'draft',
      is_available: false,
    };
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path } = requestDetails(input, init);
        paths.push(path);
        if (path.endsWith('/auth/refresh')) return tokenResponse();
        if (path.endsWith('/users/me')) return jsonResponse(student);
        if (path.endsWith('/dashboard'))
          return jsonResponse({
            total_enrolled_courses: 1,
            completed_courses: 0,
            in_progress_courses: 1,
            courses: [summary],
          });
        if (path.endsWith('/students/me/courses'))
          return jsonResponse({
            items: [summary],
            total: 1,
            page: 1,
            page_size: 12,
          });
        throw new Error(`Unexpected content request ${path}`);
      }),
    );
    await renderLearning('/learning');
    expect(
      await screen.findByText(
        'This course is currently unavailable. Your progress is saved.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Continue learning|Review course/ }),
    ).not.toBeInTheDocument();
    expect(
      paths.some(
        (path) =>
          path.includes('/lessons/') || path.endsWith(`/courses/${courseId}`),
      ),
    ).toBe(false);
  });
});
