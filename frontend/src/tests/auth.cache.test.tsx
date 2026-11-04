import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  credentials,
  jsonResponse,
  requestDetails,
  student,
  tokenResponse,
} from './fixtures';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', undefined);
});

describe('private query lifecycle', () => {
  it.each(['logout', 'account change'])(
    'cancels requests and clears private results on %s',
    async (action) => {
      let changedAccount = false;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const { path } = requestDetails(input, init);
          if (path.endsWith('/auth/logout'))
            return new Response(null, { status: 204 });
          if (path.endsWith('/auth/login')) {
            changedAccount = true;
            return tokenResponse('test-access-other-account');
          }
          if (path.endsWith('/users/me'))
            return jsonResponse(
              changedAccount
                ? {
                    ...student,
                    id: '00000000-0000-4000-8000-000000000099',
                    full_name: 'Other Student',
                  }
                : student,
            );
          return tokenResponse();
        }),
      );
      const { AuthProvider, useAuth } = await import('../auth/AuthProvider');
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      function Controls() {
        const auth = useAuth();
        return (
          <>
            <output data-testid="session-state">
              {auth.status}:{auth.user?.full_name}
            </output>
            <button onClick={() => void auth.logout()}>Leave account</button>
            <button onClick={() => void auth.login(credentials)}>
              Change account
            </button>
          </>
        );
      }
      render(
        <QueryClientProvider client={client}>
          <AuthProvider>
            <Controls />
          </AuthProvider>
        </QueryClientProvider>,
      );
      await screen.findByText('authenticated:Student Example');
      client.setQueryData(['student', student.id, 'dashboard'], {
        private: 'previous account data',
      });
      let aborted = false;
      const pending = client
        .fetchQuery({
          queryKey: ['student', student.id, 'pending'],
          queryFn: ({ signal }) =>
            new Promise((_, reject) => {
              signal.addEventListener('abort', () => {
                aborted = true;
                reject(new Error('Canceled'));
              });
            }),
        })
        .catch(() => undefined);
      await userEvent.click(
        screen.getByRole('button', {
          name: action === 'logout' ? 'Leave account' : 'Change account',
        }),
      );
      await waitFor(() => expect(aborted).toBe(true));
      expect(
        client.getQueryData(['student', student.id, 'dashboard']),
      ).toBeUndefined();
      await pending;
      if (action === 'logout') await screen.findByText('anonymous:');
      else await screen.findByText('authenticated:Other Student');
      await act(async () => {
        client.clear();
      });
    },
  );
});
