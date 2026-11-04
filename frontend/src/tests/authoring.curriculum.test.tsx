import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authoringCourseId,
  firstLessonId,
  firstModuleId,
  secondLessonId,
  secondModuleId,
  stubAuthoringApi,
} from './authoring.fixtures';
import { jsonResponse } from './fixtures';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', undefined);
});

async function renderCurriculum() {
  const { default: App } = await import('../App');
  const { AuthProvider } = await import('../auth/AuthProvider');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter
          initialEntries={[
            `/instructor/courses/${authoringCourseId}/curriculum`,
          ]}
        >
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole('region', { name: 'Module: First module' });
  return client;
}

describe('curriculum authoring', () => {
  it('preserves unsaved module and lesson drafts during a background refetch of the same course', async () => {
    const server = stubAuthoringApi();
    const client = await renderCurriculum();
    await userEvent.type(
      screen.getByLabelText('New module title'),
      'Unsaved module',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit lesson: First lesson' }),
    );
    const editor = within(
      screen.getByRole('form', { name: 'Edit lesson: First lesson' }),
    );
    await userEvent.clear(editor.getByLabelText(/^Lesson content/));
    await userEvent.type(
      editor.getByLabelText(/^Lesson content/),
      'Unsaved lesson explanation',
    );
    server.course = { ...server.course, description: 'Refreshed metadata' };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['author'] });
    });
    expect(screen.getByLabelText('New module title')).toHaveValue(
      'Unsaved module',
    );
    expect(
      within(
        screen.getByRole('form', { name: 'Edit lesson: First lesson' }),
      ).getByLabelText(/^Lesson content/),
    ).toHaveValue('Unsaved lesson explanation');
    expect(server.writes).toHaveLength(0);
  });

  it('creates a module and a lesson without supplying parent or position fields in the body', async () => {
    const server = stubAuthoringApi({
      mutate: ({ path, body }) => {
        if (path.endsWith('/modules')) {
          const module = {
            ...server.course.modules[1],
            id: '10000000-0000-4000-8000-000000000006',
            title: String(body.title),
            position: 3,
          };
          server.course = {
            ...server.course,
            module_count: 3,
            modules: [...server.course.modules, module],
          };
          return jsonResponse(module, 201);
        }
        const lesson = {
          ...server.course.modules[0].lessons[0],
          id: '10000000-0000-4000-8000-000000000007',
          title: String(body.title),
          content: String(body.content),
          video_url: String(body.video_url),
          position: 3,
        };
        server.course = {
          ...server.course,
          lesson_count: 3,
          modules: server.course.modules.map((module) =>
            module.id === firstModuleId
              ? { ...module, lessons: [...module.lessons, lesson] }
              : module,
          ),
        };
        return jsonResponse(lesson, 201);
      },
    });
    await renderCurriculum();
    await userEvent.type(
      screen.getByLabelText('New module title'),
      'Third module',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add module' }));
    await screen.findByRole('region', { name: 'Module: Third module' });
    const first = within(
      screen.getByRole('region', { name: 'Module: First module' }),
    );
    await userEvent.click(first.getByText('Add a lesson'));
    const form = within(first.getByRole('form', { name: 'Add lesson' }));
    await userEvent.type(form.getByLabelText(/^Lesson title/), 'Third lesson');
    await userEvent.type(
      form.getByLabelText(/^Lesson content/),
      'New lesson text.',
    );
    await userEvent.type(
      form.getByLabelText(/^Video URL/),
      'https://example.com/new-video',
    );
    await userEvent.click(form.getByRole('button', { name: 'Add lesson' }));
    await first.findByRole('article', { name: 'Lesson: Third lesson' });
    expect(server.writes).toEqual([
      {
        method: 'POST',
        path: `/api/v1/instructor/courses/${authoringCourseId}/modules`,
        body: { title: 'Third module' },
      },
      {
        method: 'POST',
        path: `/api/v1/instructor/modules/${firstModuleId}/lessons`,
        body: {
          title: 'Third lesson',
          content: 'New lesson text.',
          video_url: 'https://example.com/new-video',
        },
      },
    ]);
  });

  it('PATCHes a module title without sending identity or ordering fields', async () => {
    const server = stubAuthoringApi({
      mutate: ({ body }) => {
        const module = {
          ...server.course.modules[0],
          title: String(body.title),
        };
        server.course = {
          ...server.course,
          modules: [module, server.course.modules[1]],
        };
        return jsonResponse(module);
      },
    });
    await renderCurriculum();
    const region = within(
      screen.getByRole('region', { name: 'Module: First module' }),
    );
    const title = region.getByLabelText('Module title: First module');
    await userEvent.clear(title);
    await userEvent.type(title, 'Renamed module');
    await userEvent.click(region.getByRole('button', { name: 'Save module' }));
    await screen.findByRole('region', { name: 'Module: Renamed module' });
    expect(server.writes).toEqual([
      {
        method: 'PATCH',
        path: `/api/v1/instructor/modules/${firstModuleId}`,
        body: { title: 'Renamed module' },
      },
    ]);
  });

  it('clears an existing video with an explicit null PATCH while preserving text and title', async () => {
    const server = stubAuthoringApi({
      mutate: () => {
        const lesson = {
          ...server.course.modules[0].lessons[0],
          video_url: null,
        };
        server.course = {
          ...server.course,
          modules: server.course.modules.map((module) =>
            module.id === firstModuleId
              ? { ...module, lessons: [lesson, module.lessons[1]] }
              : module,
          ),
        };
        return jsonResponse(lesson);
      },
    });
    await renderCurriculum();
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit lesson: First lesson' }),
    );
    const editor = within(
      screen.getByRole('form', { name: 'Edit lesson: First lesson' }),
    );
    await userEvent.clear(editor.getByLabelText(/^Video URL/));
    await userEvent.click(editor.getByRole('button', { name: 'Save lesson' }));
    await editor.findByText('Lesson saved.');
    expect(server.writes).toEqual([
      {
        method: 'PATCH',
        path: `/api/v1/instructor/lessons/${firstLessonId}`,
        body: { video_url: null },
      },
    ]);
    expect(editor.getByLabelText(/^Lesson content/)).toHaveValue(
      'First lesson text.',
    );
  });

  it('sends the complete current ID set for both module and lesson reordering', async () => {
    const server = stubAuthoringApi({
      mutate: ({ path, body }) => {
        const ids = body.ids as string[];
        if (path.endsWith('/modules/order')) {
          server.course = {
            ...server.course,
            modules: ids.map((id, index) => ({
              ...server.course.modules.find((module) => module.id === id)!,
              position: index + 1,
            })),
          };
          return jsonResponse(server.course.modules);
        }
        const module = server.course.modules.find(
          (module) => module.id === firstModuleId,
        )!;
        const lessons = ids.map((id, index) => ({
          ...module.lessons.find((lesson) => lesson.id === id)!,
          position: index + 1,
        }));
        server.course = {
          ...server.course,
          modules: server.course.modules.map((item) =>
            item.id === module.id ? { ...item, lessons } : item,
          ),
        };
        return jsonResponse(lessons);
      },
    });
    await renderCurriculum();
    expect(
      screen.getByRole('button', { name: 'Move module First module up' }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Move module Second module up' }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole('region', { name: /^Module:/ })[0],
      ).toHaveAccessibleName('Module: Second module'),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Move lesson Second lesson up' }),
    );
    await waitFor(() =>
      expect(
        within(
          screen.getByRole('region', { name: 'Module: First module' }),
        ).getAllByRole('article')[0],
      ).toHaveAccessibleName('Lesson: Second lesson'),
    );
    expect(server.writes).toEqual([
      {
        method: 'PUT',
        path: `/api/v1/instructor/courses/${authoringCourseId}/modules/order`,
        body: { ids: [secondModuleId, firstModuleId] },
      },
      {
        method: 'PUT',
        path: `/api/v1/instructor/modules/${firstModuleId}/lessons/order`,
        body: { ids: [secondLessonId, firstLessonId] },
      },
    ]);
  });

  it('refreshes a rejected reorder and preserves the visible server order', async () => {
    const server = stubAuthoringApi({
      mutate: () =>
        jsonResponse(
          { detail: 'The order changed. Refresh before retrying.' },
          409,
        ),
    });
    await renderCurriculum();
    await userEvent.click(
      screen.getByRole('button', { name: 'Move module Second module up' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The order changed. Refresh before retrying.',
    );
    expect(
      screen.getAllByRole('region', { name: /^Module:/ })[0],
    ).toHaveAccessibleName('Module: First module');
    expect(server.writes[0].body).toEqual({
      ids: [secondModuleId, firstModuleId],
    });
  });

  it.each(['module', 'lesson'] as const)(
    'confirms %s deletion and handles 204 without parsing JSON',
    async (kind) => {
      const server = stubAuthoringApi({
        mutate: () => {
          server.course = {
            ...server.course,
            modules:
              kind === 'module'
                ? server.course.modules.filter(
                    (module) => module.id !== secondModuleId,
                  )
                : server.course.modules.map((module) => ({
                    ...module,
                    lessons: module.lessons.filter(
                      (lesson) => lesson.id !== firstLessonId,
                    ),
                  })),
          };
          return new Response(null, { status: 204 });
        },
      });
      await renderCurriculum();
      const target = kind === 'module' ? 'Second module' : 'First lesson';
      await userEvent.click(
        screen.getByRole('button', { name: `Delete ${kind}: ${target}` }),
      );
      const dialog = await screen.findByRole('dialog', {
        name: `Delete ${kind}?`,
      });
      expect(server.writes).toHaveLength(0);
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Cancel' }),
      );
      expect(server.writes).toHaveLength(0);
      await userEvent.click(
        screen.getByRole('button', { name: `Delete ${kind}: ${target}` }),
      );
      await userEvent.click(
        within(
          await screen.findByRole('dialog', { name: `Delete ${kind}?` }),
        ).getByRole('button', { name: `Delete ${kind}` }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: `Delete ${kind}: ${target}` }),
        ).not.toBeInTheDocument(),
      );
      expect(server.writes).toEqual([
        {
          method: 'DELETE',
          path: `/api/v1/instructor/${kind === 'module' ? 'modules' : 'lessons'}/${kind === 'module' ? secondModuleId : firstLessonId}`,
          body: {},
        },
      ]);
    },
  );
});
