import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authoringCourseId, stubAuthoringApi } from './authoring.fixtures';
import { admin, jsonResponse } from './fixtures';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', undefined);
});

async function renderReview(adminView = false) {
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
            `/${adminView ? 'admin' : 'instructor'}/courses/${authoringCourseId}`,
          ]}
        >
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  await screen.findByRole('heading', { name: 'Authoring test course' });
  return client;
}

describe('publication and deletion', () => {
  it.each([false, true])(
    'confirms publication changes and uses the correct moderation endpoint (admin=%s)',
    async (adminView) => {
      const server = stubAuthoringApi({
        user: adminView ? admin : undefined,
        mutate: ({ path }) => {
          const published = !path.endsWith('/unpublish');
          server.course = {
            ...server.course,
            status: published ? 'published' : 'draft',
            published_at: published ? '2026-11-04T01:00:00Z' : null,
          };
          return jsonResponse(server.course);
        },
      });
      await renderReview(adminView);
      await userEvent.click(
        await screen.findByRole('button', { name: 'Publish course' }),
      );
      const firstDialog = await screen.findByRole('dialog', {
        name: 'Publish course',
      });
      expect(server.writes).toHaveLength(0);
      await userEvent.click(
        within(firstDialog).getByRole('button', { name: 'Cancel' }),
      );
      expect(server.writes).toHaveLength(0);
      await userEvent.click(
        screen.getByRole('button', { name: 'Publish course' }),
      );
      await userEvent.click(
        within(
          await screen.findByRole('dialog', { name: 'Publish course' }),
        ).getByRole('button', { name: 'Publish course' }),
      );
      await screen.findByRole('button', { name: 'Unpublish course' });
      await userEvent.click(
        screen.getByRole('button', { name: 'Unpublish course' }),
      );
      await userEvent.click(
        within(
          await screen.findByRole('dialog', { name: 'Unpublish course' }),
        ).getByRole('button', { name: 'Unpublish course' }),
      );
      await screen.findByRole('button', { name: 'Publish course' });
      expect(server.writes).toEqual([
        {
          method: 'POST',
          path: `/api/v1/${adminView ? 'admin' : 'instructor'}/courses/${authoringCourseId}/publish`,
          body: {},
        },
        {
          method: 'POST',
          path: `/api/v1/${adminView ? 'admin' : 'instructor'}/courses/${authoringCourseId}/unpublish`,
          body: {},
        },
      ]);
      if (adminView) {
        expect(
          screen.queryByRole('link', { name: 'Edit details' }),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Delete draft' }),
        ).not.toBeInTheDocument();
      }
    },
  );

  it('deletes a draft only after confirmation and accepts the empty 204 response', async () => {
    const server = stubAuthoringApi({
      mutate: () => new Response(null, { status: 204 }),
    });
    await renderReview();
    await userEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete draft' });
    expect(server.writes).toHaveLength(0);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete draft' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(server.writes).toEqual([
      {
        method: 'DELETE',
        path: `/api/v1/instructor/courses/${authoringCourseId}`,
        body: {},
      },
    ]);
  });

  it('keeps the course and conflict feedback visible when enrollment prevents deletion', async () => {
    const server = stubAuthoringApi({
      mutate: () =>
        jsonResponse(
          { detail: 'Courses with enrollments cannot be deleted' },
          409,
        ),
    });
    await renderReview();
    await userEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete draft' });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete draft' }),
    );
    expect(
      await within(dialog).findByText(
        'Courses with enrollments cannot be deleted',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Authoring test course' }),
    ).toBeInTheDocument();
    expect(server.writes).toHaveLength(1);
  });
});
