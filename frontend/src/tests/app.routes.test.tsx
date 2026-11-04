import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  admin,
  deferred,
  jsonResponse,
  requestDetails,
  student,
  instructor,
  tokenResponse,
} from './fixtures';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', undefined);
});

async function renderRoute(path: string) {
  const { default: App } = await import('../App');
  const { AuthProvider } = await import('../auth/AuthProvider');
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return queryClient;
}

describe('protected navigation', () => {
  it('keeps sign-in hidden until pending logout revocation completes', async () => {
    const logoutResponse = deferred<Response>();
    let logoutRequests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path } = requestDetails(input, init);
        if (path.endsWith('/auth/logout')) {
          logoutRequests += 1;
          return logoutResponse.promise;
        }
        if (path.endsWith('/auth/refresh')) return tokenResponse();
        if (path.endsWith('/users/me')) return jsonResponse(student);
        if (path.endsWith('/courses'))
          return jsonResponse({ items: [], total: 0, page: 1, page_size: 12 });
        throw new Error(`Unexpected request ${path}`);
      }),
    );
    await renderRoute('/courses');
    await userEvent.click(await screen.findByLabelText('Account menu'));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(logoutRequests).toBe(1));
    const header = within(screen.getByRole('banner'));
    expect(header.getByRole('status')).toHaveTextContent('Signing out…');
    expect(
      header.queryByRole('link', { name: 'Sign in' }),
    ).not.toBeInTheDocument();
    await act(async () => {
      logoutResponse.resolve(new Response(null, { status: 204 }));
    });
    expect(
      await header.findByRole('link', { name: 'Sign in' }),
    ).toBeInTheDocument();
    expect(header.queryByText('Signing out…')).not.toBeInTheDocument();
    expect(logoutRequests).toBe(1);
  });

  it('shows session loading, then redirects an anonymous student route to sign in', async () => {
    const gate = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => gate.promise),
    );
    await renderRoute('/learning');
    expect(screen.getByText('Checking your session…')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Sign in to EduFlow' }),
    ).not.toBeInTheDocument();
    await act(async () => {
      gate.resolve(jsonResponse({ detail: 'Authentication required' }, 401));
    });
    expect(
      await screen.findByRole('heading', { name: 'Sign in to EduFlow' }),
    ).toBeInTheDocument();
  });

  it.each([
    [student, '/admin/courses'],
    [admin, '/learning'],
    [instructor, '/admin/courses'],
    [instructor, '/learning'],
  ] as const)(
    'blocks a $0.role account from $1 without fetching protected page data',
    async (user, path) => {
      const paths: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const { path: requested } = requestDetails(input, init);
          paths.push(requested);
          return requested.endsWith('/users/me')
            ? jsonResponse(user)
            : tokenResponse();
        }),
      );
      await renderRoute(path);
      expect(
        await screen.findByRole('heading', {
          name: 'This page is for a different role',
        }),
      ).toBeInTheDocument();
      expect(
        paths.every(
          (requested) =>
            requested.endsWith('/auth/refresh') ||
            requested.endsWith('/users/me'),
        ),
      ).toBe(true);
    },
  );

  it('shows a bootstrap error with a working retry instead of silently redirecting to login', async () => {
    let online = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path } = requestDetails(input, init);
        if (!online) throw new TypeError('Offline');
        if (path.endsWith('/users/me')) return jsonResponse(admin);
        return tokenResponse();
      }),
    );
    await renderRoute('/learning');
    expect(
      await screen.findByRole('heading', {
        name: 'We couldn’t complete that request',
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Sign in to EduFlow' }),
    ).not.toBeInTheDocument();
    online = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', {
        name: 'This page is for a different role',
      }),
    ).toBeInTheDocument();
  });
});

describe('server form validation', () => {
  it('connects 422 field errors to the registration inputs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path } = requestDetails(input, init);
        if (path.endsWith('/auth/register'))
          return jsonResponse(
            {
              detail: [
                {
                  type: 'value_error',
                  loc: ['body', 'email'],
                  msg: 'This email cannot be registered',
                },
                {
                  type: 'value_error',
                  loc: ['body', 'full_name'],
                  msg: 'Choose a longer full name',
                },
              ],
            },
            422,
          );
        return jsonResponse({ detail: 'Authentication required' }, 401);
      }),
    );
    await renderRoute('/register');
    await userEvent.type(screen.getByLabelText(/^Full name/), 'Test Person');
    await userEvent.type(
      screen.getByLabelText(/^Email address/),
      'student@example.test',
    );
    await userEvent.type(
      screen.getByLabelText(/^Password/),
      'Example-password-42!',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Create account' }),
    );
    const email = await screen.findByLabelText(/^Email address/);
    expect(
      await screen.findByText('This email cannot be registered'),
    ).toBeInTheDocument();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription(
      'This email cannot be registered',
    );
    expect(screen.getByLabelText(/^Full name/)).toHaveAccessibleDescription(
      'Choose a longer full name',
    );
  });
});
