import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, requestDetails } from './fixtures';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', undefined);
});

describe('auth password visibility', () => {
  it.each([false, true])(
    'toggles visibility without replacing the input, losing the password or submitting authentication (register=%s)',
    async (register) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ detail: 'Authentication required' }, 401),
        );
      vi.stubGlobal('fetch', fetchMock);
      const { AuthPage } = await import('../pages/Auth');
      const { AuthProvider } = await import('../auth/AuthProvider');
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={client}>
          <AuthProvider>
            <MemoryRouter>
              <AuthPage register={register} />
            </MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const password = screen.getByLabelText(/^Password/) as HTMLInputElement;
      await userEvent.type(password, 'Example-password-42!');
      expect(password).toHaveAttribute('type', 'password');
      expect(password).toHaveAttribute('name', 'password');
      const reveal = screen.getByRole('button', { name: 'Show password' });
      expect(reveal).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(reveal);
      expect(screen.getByLabelText(/^Password/)).toBe(password);
      expect(password).toHaveAttribute('type', 'text');
      expect(password).toHaveValue('Example-password-42!');
      const hide = screen.getByRole('button', { name: 'Hide password' });
      expect(hide).toHaveAttribute('aria-pressed', 'true');
      await userEvent.click(hide);
      expect(password).toHaveAttribute('type', 'password');
      expect(password).toHaveValue('Example-password-42!');
      const paths = fetchMock.mock.calls.map(
        (call) =>
          requestDetails(...(call as [RequestInfo | URL, RequestInit?])).path,
      );
      expect(
        paths.filter(
          (path) =>
            path.endsWith('/auth/login') || path.endsWith('/auth/register'),
        ),
      ).toEqual([]);
      client.clear();
    },
  );
});
