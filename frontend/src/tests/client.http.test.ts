import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, requestDetails } from './fixtures';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', undefined);
});

describe('HTTP response contracts', () => {
  it('accepts 204 without attempting to parse JSON', async () => {
    const response = new Response(null, { status: 204 });
    const parseJson = vi.spyOn(response, 'json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const { client } = await import('../lib/client');
    await expect(
      client.request('/auth/logout', { method: 'POST', auth: false }),
    ).resolves.toBeUndefined();
    expect(parseJson).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 409])(
    'normalizes HTTP %i without refreshing a public request',
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ detail: 'Request unavailable' }, status),
        );
      vi.stubGlobal('fetch', fetchMock);
      const { client, ApiError } = await import('../lib/client');
      const error = await client
        .request('/courses/unavailable', { auth: false })
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ status, message: 'Request unavailable' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('allows logout revocation to finish after navigation while retaining CSRF protection', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const { sessionClient } = await import('../lib/client');
    await sessionClient.logout();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/logout',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: expect.objectContaining({ 'X-CSRF-Token': '1' }),
      }),
    );
  });

  it('maps sanitized 422 body locations to form field errors', async () => {
    const issues = [
      {
        type: 'value_error',
        loc: ['body', 'email'],
        msg: 'A valid email is required',
      },
      {
        type: 'string_too_short',
        loc: ['body', 'password'],
        msg: 'Use at least 12 characters',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: issues }, 422)),
    );
    const { client, ApiError } = await import('../lib/client');
    const error = await client
      .request('/auth/register', { method: 'POST', auth: false, body: {} })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      fieldErrors: {
        email: 'A valid email is required',
        password: 'Use at least 12 characters',
      },
    });
  });

  it('normalizes a network failure into a retryable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    const { client, ApiError } = await import('../lib/client');
    const error = await client
      .request('/courses', { auth: false })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0 });
    expect((error as Error).message).toBeTruthy();
  });

  it('serializes JSON, includes credentials, and sends the CSRF marker on auth POSTs', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ detail: 'Incorrect credentials' }, 401),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { sessionClient } = await import('../lib/client');
    const payload = {
      email: 'student@example.test',
      password: 'Example-password-42!',
    };
    await expect(sessionClient.login(payload)).rejects.toMatchObject({
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = requestDetails(
      ...(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?]),
    );
    expect(call.path).toBe('/api/v1/auth/login');
    expect(call.method).toBe('POST');
    expect(call.credentials).toBe('include');
    expect(call.headers.get('X-CSRF-Token')).toBe('1');
    expect(call.headers.get('Content-Type')).toContain('application/json');
    expect(JSON.parse(String(call.body))).toEqual(payload);
    expect(call.headers.has('Origin')).toBe(false);
  });
});
