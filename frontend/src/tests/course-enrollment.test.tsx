import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useAuth } from '../auth/AuthProvider';
import type { PublicCourseDetail, StudentCourseRead, User } from '../lib/types';
import { ApiError } from '../lib/client';
import {
  admin,
  courseId,
  deferred,
  enrollmentId,
  instructor,
  student,
  studentCourse,
} from './fixtures';

const mocks = vi.hoisted(() => ({
  publicCourse: vi.fn(),
  studentCourse: vi.fn(),
  managementCourse: vi.fn(),
  enroll: vi.fn(),
  auth: vi.fn(),
}));
vi.mock('../lib/api', () => ({ api: mocks }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: mocks.auth }));
import { CoursePage } from '../pages/Catalog';

const publicCourse: PublicCourseDetail = {
  id: courseId,
  slug: studentCourse.slug,
  title: studentCourse.title,
  description: studentCourse.description,
  category: studentCourse.category,
  level: studentCourse.level,
  instructor_name: studentCourse.instructor_name,
  module_count: 1,
  lesson_count: 3,
  published_at: '2026-11-04T00:00:00Z',
  modules: studentCourse.modules,
};
const enrollmentResponse = {
  id: enrollmentId,
  student_id: student.id,
  course_id: courseId,
  enrolled_at: '2026-11-04T00:00:00Z',
};
function record(
  completed = 0,
  total = 3,
  percentage = (completed / total) * 100,
): StudentCourseRead {
  const progress = {
    course_id: courseId,
    completed_lessons: completed,
    total_lessons: total,
    progress_percentage: percentage,
    is_completed: total > 0 && completed === total,
  };
  return { ...studentCourse, ...progress, progress };
}
function session(
  user: User | null = student,
  status: 'loading' | 'authenticated' | 'anonymous' = user
    ? 'authenticated'
    : 'anonymous',
  epoch = 1,
): ReturnType<typeof useAuth> {
  return {
    status,
    user,
    error: null,
    epoch,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    retry: vi.fn(),
  };
}
const clients: QueryClient[] = [];
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  function Location() {
    return <output data-testid="destination">{useLocation().pathname}</output>;
  }
  const tree = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/courses/${publicCourse.slug}`]}>
        <Routes>
          <Route path="/courses/:slug" element={<CoursePage />} />
          <Route
            path="/learn/:courseId"
            element={<h1>Learning destination</h1>}
          />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    client,
    unmount: view.unmount,
    changeSession(value: ReturnType<typeof useAuth>) {
      mocks.auth.mockReturnValue(value);
      view.rerender(tree());
    },
  };
}
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.auth.mockReturnValue(session());
  mocks.publicCourse.mockResolvedValue(publicCourse);
  mocks.studentCourse.mockRejectedValue(new ApiError(404, 'Course not found'));
  mocks.managementCourse.mockRejectedValue(
    new ApiError(403, 'Insufficient permissions'),
  );
  mocks.enroll.mockResolvedValue(enrollmentResponse);
});
afterEach(() => clients.splice(0).forEach((client) => client.clear()));

describe('course enrollment and role-aware actions', () => {
  it('offers bounded sign-in/register returns to an anonymous visitor without private requests', async () => {
    mocks.auth.mockReturnValue(session(null));
    show();
    expect(
      await screen.findByRole('link', { name: 'Sign in to enroll' }),
    ).toHaveAttribute(
      'href',
      `/login?returnTo=${encodeURIComponent(`/courses/${publicCourse.slug}`)}`,
    );
    expect(
      screen.getByRole('link', { name: 'Create an account' }),
    ).toHaveAttribute(
      'href',
      `/register?returnTo=${encodeURIComponent(`/courses/${publicCourse.slug}`)}`,
    );
    expect(mocks.studentCourse).not.toHaveBeenCalled();
    expect(mocks.managementCourse).not.toHaveBeenCalled();
  });

  it('waits for session bootstrap without offering enrollment or fetching private access', async () => {
    mocks.auth.mockReturnValue(session(null, 'loading'));
    show();
    expect(await screen.findByText('Checking your session…')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Enroll and Start Learning' }),
    ).not.toBeInTheDocument();
    expect(mocks.studentCourse).not.toHaveBeenCalled();
  });

  it('waits for authoritative enrollment before showing a CTA', async () => {
    const pending = deferred<StudentCourseRead>();
    mocks.studentCourse.mockReturnValue(pending.promise);
    show();
    expect(await screen.findByText('Checking your enrollment…')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Enroll and Start Learning' }),
    ).not.toBeInTheDocument();
    await act(async () => pending.resolve(record()));
    expect(
      await screen.findByRole('link', { name: 'Start Learning' }),
    ).toHaveAttribute('href', `/learn/${courseId}`);
  });

  it('offers enrollment only for a confirmed 404 and does not retry the lookup automatically', async () => {
    show();
    expect(
      await screen.findByRole('button', { name: 'Enroll and Start Learning' }),
    ).toBeEnabled();
    expect(mocks.studentCourse).toHaveBeenCalledExactlyOnceWith(
      courseId,
      expect.any(AbortSignal),
    );
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it('prevents duplicate enrollment, invalidates the same student caches, and opens the course after success', async () => {
    const pending = deferred<typeof enrollmentResponse>();
    mocks.enroll.mockReturnValue(pending.promise);
    const { client } = show();
    const dashboard = ['student', student.id, 'dashboard'];
    client.setQueryData(dashboard, { total_enrolled_courses: 0 });
    const button = await screen.findByRole('button', {
      name: 'Enroll and Start Learning',
    });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(mocks.enroll).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole('button', { name: 'Opening your course…' }),
    ).toBeDisabled();
    mocks.studentCourse.mockResolvedValue(record());
    await act(async () => pending.resolve(enrollmentResponse));
    await screen.findByRole('heading', { name: 'Learning destination' });
    expect(mocks.enroll).toHaveBeenCalledWith(courseId);
    expect(
      client.getQueryData(['student', student.id, 'course', courseId]),
    ).toEqual(record());
    expect(client.getQueryState(dashboard)?.isInvalidated).toBe(true);
  });

  it.each([
    [0, 3, 0, 'Start Learning'],
    [1, 3, 33.33, 'Continue Learning'],
    [3, 3, 100, 'Review Course'],
    [29999, 30000, 100, 'Continue Learning'],
    [1, 30000, 0, 'Continue Learning'],
  ] as const)(
    'uses completed counts %i/%i rather than rounded %i%% for %s',
    async (completed, total, percentage, label) => {
      mocks.studentCourse.mockResolvedValue(
        record(completed, total, percentage),
      );
      show();
      expect(await screen.findByRole('link', { name: label })).toHaveAttribute(
        'href',
        `/learn/${courseId}`,
      );
      expect(
        screen.queryByRole('button', { name: 'Enroll and Start Learning' }),
      ).not.toBeInTheDocument();
      expect(mocks.enroll).not.toHaveBeenCalled();
    },
  );

  it('honors the server completion flag', async () => {
    mocks.studentCourse.mockResolvedValue({ ...record(), is_completed: true });
    show();
    expect(
      await screen.findByRole('link', { name: 'Review Course' }),
    ).toBeVisible();
  });

  it('updates the CTA when the shared course query refetches', async () => {
    mocks.studentCourse.mockResolvedValue(record());
    const { client } = show();
    await screen.findByRole('link', { name: 'Start Learning' });
    mocks.studentCourse.mockResolvedValue(record(1));
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ['student', student.id, 'course', courseId],
      });
    });
    expect(
      await screen.findByRole('link', { name: 'Continue Learning' }),
    ).toBeVisible();
    expect(mocks.studentCourse).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a previous account CTA across logout and another login', async () => {
    mocks.studentCourse.mockResolvedValue(record(3));
    const view = show();
    await screen.findByRole('link', { name: 'Review Course' });
    view.changeSession(session(null, 'anonymous', 2));
    await screen.findByRole('link', { name: 'Sign in to enroll' });
    const next = { ...student, id: '00000000-0000-4000-8000-000000000099' };
    const pending = deferred<StudentCourseRead>();
    mocks.studentCourse.mockReturnValue(pending.promise);
    view.changeSession(session(next, 'authenticated', 3));
    expect(await screen.findByText('Checking your enrollment…')).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Review Course' }),
    ).not.toBeInTheDocument();
    await act(async () => pending.resolve(record()));
    await screen.findByRole('link', { name: 'Start Learning' });
    expect(
      view.client.getQueryData(['student', next.id, 'course', courseId]),
    ).toEqual(record());
  });

  it('invalidates the captured student cache even if the course page has been left', async () => {
    const pending = deferred<typeof enrollmentResponse>();
    mocks.enroll.mockReturnValue(pending.promise);
    const view = show();
    const dashboard = ['student', student.id, 'dashboard'];
    view.client.setQueryData(dashboard, { total_enrolled_courses: 0 });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Enroll and Start Learning' }),
    );
    view.unmount();
    await act(async () => pending.resolve(enrollmentResponse));
    expect(view.client.getQueryState(dashboard)?.isInvalidated).toBe(true);
  });

  it('does not navigate or invalidate another student cache when enrollment finishes after sign-out', async () => {
    const pending = deferred<typeof enrollmentResponse>();
    mocks.enroll.mockReturnValue(pending.promise);
    const view = show();
    const invalidate = vi.spyOn(view.client, 'invalidateQueries');
    const otherDashboard = ['student', 'another-student', 'dashboard'];
    view.client.setQueryData(otherDashboard, { total_enrolled_courses: 7 });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Enroll and Start Learning' }),
    );
    view.changeSession(session(null, 'anonymous', 2));
    await screen.findByRole('link', { name: 'Sign in to enroll' });
    await act(async () => pending.resolve(enrollmentResponse));
    expect(screen.getByTestId('destination')).toHaveTextContent(
      `/courses/${publicCourse.slug}`,
    );
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: ['student', student.id],
    });
    expect(view.client.getQueryState(otherDashboard)?.isInvalidated).toBe(
      false,
    );
    expect(view.client.getQueryData(otherDashboard)).toEqual({
      total_enrolled_courses: 7,
    });
  });

  it.each([0, 401, 403, 500])(
    'does not mistake an enrollment lookup HTTP %i for an unenrolled student',
    async (status) => {
      mocks.studentCourse.mockRejectedValue(
        new ApiError(status, 'Lookup failed'),
      );
      show();
      expect(await screen.findByRole('alert')).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Enroll and Start Learning' }),
      ).not.toBeInTheDocument();
      expect(mocks.studentCourse).toHaveBeenCalledTimes(1);
      mocks.studentCourse.mockResolvedValue(record());
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(
        await screen.findByRole('link', { name: 'Start Learning' }),
      ).toBeVisible();
    },
  );

  it('keeps a failed background refetch from offering a misleading enroll action', async () => {
    mocks.studentCourse.mockResolvedValue(record(1));
    const { client } = show();
    await screen.findByRole('link', { name: 'Continue Learning' });
    mocks.studentCourse.mockRejectedValue(new ApiError(500, 'Lookup failed'));
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ['student', student.id, 'course', courseId],
      });
    });
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(
      screen.queryByRole('link', { name: 'Continue Learning' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Enroll and Start Learning' }),
    ).not.toBeInTheDocument();
  });

  it('offers an instructor management only after the protected ownership check succeeds', async () => {
    mocks.auth.mockReturnValue(session(instructor));
    mocks.managementCourse.mockResolvedValue({ instructor_id: instructor.id });
    const { client } = show();
    expect(
      await screen.findByRole('link', { name: 'Manage Course' }),
    ).toHaveAttribute('href', `/instructor/courses/${courseId}`);
    expect(mocks.managementCourse).toHaveBeenCalledExactlyOnceWith(
      courseId,
      false,
      expect.any(AbortSignal),
    );
    expect(
      client.getQueryData(['author', instructor.id, 'course', courseId]),
    ).toMatchObject({ instructor_id: instructor.id });
    expect(mocks.studentCourse).not.toHaveBeenCalled();
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it.each([403, 404])(
    'restricts another instructor course after HTTP %i',
    async (status) => {
      mocks.auth.mockReturnValue(session(instructor));
      mocks.managementCourse.mockRejectedValue(
        new ApiError(status, 'Not owned'),
      );
      show();
      expect(
        await screen.findByRole('link', { name: 'Go to workspace' }),
      ).toHaveAttribute('href', '/instructor/courses');
      expect(
        screen.queryByRole('link', { name: 'Manage Course' }),
      ).not.toBeInTheDocument();
      expect(mocks.enroll).not.toHaveBeenCalled();
    },
  );

  it('retries an unknown instructor access error rather than assuming ownership or denial', async () => {
    mocks.auth.mockReturnValue(session(instructor));
    mocks.managementCourse.mockRejectedValue(
      new ApiError(500, 'Lookup failed'),
    );
    show();
    await screen.findByRole('alert');
    expect(
      screen.queryByRole('link', { name: 'Go to workspace' }),
    ).not.toBeInTheDocument();
    mocks.managementCourse.mockResolvedValue({ instructor_id: instructor.id });
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('link', { name: 'Manage Course' }),
    ).toBeVisible();
  });

  it('links an admin directly to moderation without enrollment or instructor ownership requests', async () => {
    mocks.auth.mockReturnValue(session(admin));
    show();
    expect(
      await screen.findByRole('link', { name: 'Manage Course' }),
    ).toHaveAttribute('href', `/admin/courses/${courseId}`);
    expect(mocks.managementCourse).not.toHaveBeenCalled();
    expect(mocks.studentCourse).not.toHaveBeenCalled();
    expect(mocks.enroll).not.toHaveBeenCalled();
  });
});
