import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authoringCourseId,
  makeAuthoringCourse,
  stubAuthoringApi,
} from './authoring.fixtures';
import { jsonResponse, student } from './fixtures';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', undefined);
});

async function renderAuthoring(path: string) {
  const { default: App } = await import('../App');
  const { AuthProvider } = await import('../auth/AuthProvider');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
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

describe('course authoring forms', () => {
  it('cancels sign-out without discarding dirty input, then signs out after explicit confirmation', async () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const server = stubAuthoringApi({
      mutate: ({ path }) => {
        if (path.endsWith('/auth/logout'))
          return new Response(null, { status: 204 });
        throw new Error(`Unexpected mutation ${path}`);
      },
    });
    await renderAuthoring(`/instructor/courses/${authoringCourseId}/edit`);
    const title = await screen.findByLabelText(/^Course title/);
    await userEvent.clear(title);
    await userEvent.type(title, 'Unsaved teaching plan');
    await userEvent.click(screen.getByLabelText('Account menu'));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(confirmation).toHaveBeenCalledWith(
      'Sign out and discard your unsaved changes?',
    );
    expect(server.writes).toHaveLength(0);
    expect(title).toHaveValue('Unsaved teaching plan');
    expect(screen.getByLabelText('Account menu')).toBeInTheDocument();
    confirmation.mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to EduFlow' }),
    ).toBeInTheDocument();
    expect(server.writes).toEqual([
      { method: 'POST', path: '/api/v1/auth/logout', body: {} },
    ]);
  });

  it('preserves a dirty field across background refetch and saves only that field over fresh server data', async () => {
    const server = stubAuthoringApi({
      mutate: ({ body }) => {
        server.course = { ...server.course, ...body };
        return jsonResponse(server.course);
      },
    });
    const client = await renderAuthoring(
      `/instructor/courses/${authoringCourseId}/edit`,
    );
    const title = await screen.findByLabelText(/^Course title/);
    await userEvent.clear(title);
    await userEvent.type(title, 'Local draft title');
    server.course = {
      ...server.course,
      title: 'Remote title',
      category: 'Remote category',
    };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['author'] });
    });
    expect(screen.getByLabelText(/^Course title/)).toHaveValue(
      'Local draft title',
    );
    expect(server.writes).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(server.writes).toHaveLength(1));
    expect(server.writes[0].body).toEqual({ title: 'Local draft title' });
    expect(server.course.category).toBe('Remote category');
  });

  it('creates a draft through the existing endpoint without submitting ownership or publication fields', async () => {
    const server = stubAuthoringApi({
      mutate: ({ body }) =>
        jsonResponse(
          {
            ...makeAuthoringCourse({
              modules: [],
              module_count: 0,
              lesson_count: 0,
            }),
            ...body,
          },
          201,
        ),
    });
    await renderAuthoring('/instructor/courses/new');
    await userEvent.type(
      await screen.findByLabelText(/^Course title/),
      'A newly authored course',
    );
    const slug = screen.getByLabelText(/^Slug/);
    await userEvent.clear(slug);
    await userEvent.type(slug, 'newly-authored-course');
    await userEvent.type(
      screen.getByLabelText(/^Description/),
      'Description of this course.',
    );
    await userEvent.type(screen.getByLabelText(/^Category/), 'Engineering');
    await userEvent.selectOptions(
      screen.getByLabelText(/^Level/),
      'intermediate',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Create course' }),
    );
    await waitFor(() => expect(server.writes).toHaveLength(1));
    expect(server.writes[0]).toEqual({
      path: '/api/v1/instructor/courses',
      method: 'POST',
      body: {
        title: 'A newly authored course',
        slug: 'newly-authored-course',
        description: 'Description of this course.',
        category: 'Engineering',
        level: 'intermediate',
      },
    });
  });

  it('PATCHes only the edited field and preserves the canonical slug', async () => {
    const server = stubAuthoringApi({
      mutate: ({ body }) => {
        server.course = { ...server.course, ...body };
        return jsonResponse(server.course);
      },
    });
    await renderAuthoring(`/instructor/courses/${authoringCourseId}/edit`);
    const title = await screen.findByLabelText(/^Course title/);
    await userEvent.clear(title);
    await userEvent.type(title, 'Changed title');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(server.writes).toHaveLength(1));
    expect(server.writes[0]).toEqual({
      path: `/api/v1/instructor/courses/${authoringCourseId}`,
      method: 'PATCH',
      body: { title: 'Changed title' },
    });
    expect(server.course.slug).toBe('authoring-test-course');
  });

  it('connects server 422 errors to the course field without losing the entered value', async () => {
    const server = stubAuthoringApi({
      mutate: () =>
        jsonResponse(
          {
            detail: [
              {
                type: 'value_error',
                loc: ['body', 'title'],
                msg: 'Choose a different course title',
              },
            ],
          },
          422,
        ),
    });
    await renderAuthoring(`/instructor/courses/${authoringCourseId}/edit`);
    const title = await screen.findByLabelText(/^Course title/);
    await userEvent.clear(title);
    await userEvent.type(title, 'Rejected title');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Choose a different course title'),
    ).toBeInTheDocument();
    expect(title).toHaveValue('Rejected title');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription(
      expect.stringContaining('Choose a different course title'),
    );
    expect(server.writes).toHaveLength(1);
  });

  it('shows a 409 conflict and keeps the author’s pending changes visible', async () => {
    const server = stubAuthoringApi({
      mutate: () => jsonResponse({ detail: 'Course slug already exists' }, 409),
    });
    await renderAuthoring(`/instructor/courses/${authoringCourseId}/edit`);
    const slug = await screen.findByLabelText(/^Slug/);
    await userEvent.clear(slug);
    await userEvent.type(slug, 'taken-slug');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Course slug already exists'),
    ).toBeInTheDocument();
    expect(slug).toHaveValue('taken-slug');
    expect(server.writes).toHaveLength(1);
  });

  it.each([
    'new',
    `${authoringCourseId}/edit`,
    `${authoringCourseId}/curriculum`,
  ])('denies student access to the %s authoring route', async (route) => {
    const server = stubAuthoringApi({ user: student });
    await renderAuthoring(`/instructor/courses/${route}`);
    expect(
      await screen.findByRole('heading', {
        name: 'This page is for a different role',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Course title/)).not.toBeInTheDocument();
    expect(server.writes).toHaveLength(0);
  });
});
