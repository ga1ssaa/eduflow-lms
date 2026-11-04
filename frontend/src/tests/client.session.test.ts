import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  credentials,
  deferred,
  initialToken,
  jsonResponse,
  refreshedToken,
  requestDetails,
  student,
  tokenResponse,
} from './fixtures';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('BroadcastChannel', undefined);
});

describe('session recovery and race safety', () => {
  it('bootstraps an absent refresh cookie as anonymous without an error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ detail: 'Authentication required' }, 401),
      );
    vi.stubGlobal('fetch', fetchMock);
    const { sessionClient } = await import('../lib/client');
    await sessionClient.bootstrap();
    expect(sessionClient.getSnapshot()).toMatchObject({
      status: 'anonymous',
      user: null,
      error: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = requestDetails(
      ...(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?]),
    );
    expect(request.path).toBe('/api/v1/auth/refresh');
    expect(request.credentials).toBe('include');
    expect(request.headers.get('X-CSRF-Token')).toBe('1');
  });

  it('exposes a bootstrap network failure and supports an explicit retry', async () => {
    let online = false;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!online) throw new TypeError('Offline');
        const { path } = requestDetails(input, init);
        return path.endsWith('/auth/refresh')
          ? tokenResponse()
          : jsonResponse(student);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const { sessionClient } = await import('../lib/client');
    await sessionClient.bootstrap();
    expect(sessionClient.getSnapshot()).toMatchObject({
      status: 'anonymous',
      user: null,
      error: { status: 0 },
    });
    online = true;
    await sessionClient.retry();
    expect(sessionClient.getSnapshot()).toMatchObject({
      status: 'authenticated',
      user: student,
      error: null,
    });
  });

  it('shares one refresh between simultaneous protected 401s and retries each once', async () => {
    const gate = deferred<Response>();
    let refreshes = 0;
    const attempts = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path, headers } = requestDetails(input, init);
        if (path.endsWith('/auth/login')) return tokenResponse();
        if (path.endsWith('/users/me')) return jsonResponse(student);
        if (path.endsWith('/auth/refresh')) {
          refreshes += 1;
          return gate.promise;
        }
        attempts.set(path, (attempts.get(path) ?? 0) + 1);
        return headers.get('Authorization') === `Bearer ${initialToken}`
          ? jsonResponse({ detail: 'Authentication required' }, 401)
          : jsonResponse({ path });
      }),
    );
    const { client, sessionClient } = await import('../lib/client');
    await sessionClient.login(credentials);
    const first = client.request('/students/me/courses');
    const second = client.request('/students/me/dashboard');
    await vi.waitFor(() => expect(refreshes).toBe(1));
    gate.resolve(tokenResponse(refreshedToken));
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(refreshes).toBe(1);
    expect([...attempts.values()]).toEqual([2, 2]);
    expect(sessionClient.getSnapshot().status).toBe('authenticated');
  });

  it('reuses the new token for a late 401 from an older token without rotating twice', async () => {
    const lateResponse = deferred<Response>();
    let refreshes = 0;
    let lateStarted = false;
    const attempts = new Map<string, number>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path, headers } = requestDetails(input, init);
        if (path.endsWith('/auth/login')) return tokenResponse();
        if (path.endsWith('/users/me')) return jsonResponse(student);
        if (path.endsWith('/auth/refresh')) {
          refreshes += 1;
          return tokenResponse(refreshedToken);
        }
        attempts.set(path, (attempts.get(path) ?? 0) + 1);
        if (headers.get('Authorization') === `Bearer ${refreshedToken}`)
          return jsonResponse({ ok: true });
        if (path.endsWith('/dashboard')) {
          lateStarted = true;
          return lateResponse.promise;
        }
        return jsonResponse({ detail: 'Authentication required' }, 401);
      }),
    );
    const { client, sessionClient } = await import('../lib/client');
    await sessionClient.login(credentials);
    const late = client.request('/students/me/dashboard');
    await vi.waitFor(() => expect(lateStarted).toBe(true));
    await client.request('/students/me/courses');
    lateResponse.resolve(
      jsonResponse({ detail: 'Authentication required' }, 401),
    );
    await expect(late).resolves.toEqual({ ok: true });
    expect(refreshes).toBe(1);
    expect([...attempts.values()]).toEqual([2, 2]);
  });

  it('retries a rejected protected request only once', async () => {
    let refreshes = 0;
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path } = requestDetails(input, init);
        if (path.endsWith('/auth/login')) return tokenResponse();
        if (path.endsWith('/users/me')) return jsonResponse(student);
        if (path.endsWith('/auth/refresh')) {
          refreshes += 1;
          return tokenResponse(refreshedToken);
        }
        attempts += 1;
        return jsonResponse({ detail: 'Authentication required' }, 401);
      }),
    );
    const { client, sessionClient } = await import('../lib/client');
    await sessionClient.login(credentials);
    await expect(
      client.request('/students/me/dashboard'),
    ).rejects.toMatchObject({ status: 401 });
    expect(refreshes).toBe(1);
    expect(attempts).toBe(2);
  });

  it('clears the session when refresh fails and does not enter a retry loop', async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path } = requestDetails(input, init);
        paths.push(path);
        if (path.endsWith('/auth/login')) return tokenResponse();
        if (path.endsWith('/users/me')) return jsonResponse(student);
        return jsonResponse({ detail: 'Authentication required' }, 401);
      }),
    );
    const { client, sessionClient } = await import('../lib/client');
    await sessionClient.login(credentials);
    await expect(
      client.request('/students/me/dashboard'),
    ).rejects.toMatchObject({ status: 401 });
    expect(sessionClient.getSnapshot()).toMatchObject({
      status: 'anonymous',
      user: null,
    });
    expect(paths.filter((path) => path.endsWith('/auth/refresh'))).toHaveLength(
      1,
    );
    expect(paths.filter((path) => path.endsWith('/dashboard'))).toHaveLength(1);
  });

  it('never restores an authenticated session when logout races an in-flight refresh', async () => {
    const gate = deferred<Response>();
    let refreshStarted = false;
    const protectedTokens: Array<string | null> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path, headers } = requestDetails(input, init);
        if (path.endsWith('/auth/login')) return tokenResponse();
        if (path.endsWith('/users/me')) return jsonResponse(student);
        if (path.endsWith('/auth/refresh')) {
          refreshStarted = true;
          return gate.promise;
        }
        if (path.endsWith('/auth/logout'))
          return new Response(null, { status: 204 });
        protectedTokens.push(headers.get('Authorization'));
        return jsonResponse({ detail: 'Authentication required' }, 401);
      }),
    );
    const { client, sessionClient } = await import('../lib/client');
    await sessionClient.login(credentials);
    const request = client.request('/students/me/dashboard');
    const settledRequest = Promise.allSettled([request]);
    await vi.waitFor(() => expect(refreshStarted).toBe(true));
    const logout = sessionClient.logout();
    expect(sessionClient.getSnapshot()).toMatchObject({
      status: 'anonymous',
      user: null,
    });
    gate.resolve(tokenResponse(refreshedToken));
    await logout;
    await settledRequest;
    expect(sessionClient.getSnapshot()).toMatchObject({
      status: 'anonymous',
      user: null,
    });
    expect(protectedTokens).not.toContain(`Bearer ${refreshedToken}`);
  });

  it('keeps tokens out of browser storage and public snapshots', async () => {
    const stored: string[] = [];
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      stored.push(key, value);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path } = requestDetails(input, init);
        if (path.endsWith('/auth/logout'))
          return new Response(null, { status: 204 });
        return path.endsWith('/users/me')
          ? jsonResponse(student)
          : tokenResponse();
      }),
    );
    const { sessionClient } = await import('../lib/client');
    await sessionClient.login(credentials);
    expect(JSON.stringify(sessionClient.getSnapshot())).not.toContain(
      initialToken,
    );
    await sessionClient.logout();
    expect(stored.join(' ')).not.toMatch(
      /test-access|access_token|refresh_token/,
    );
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('keeps local authentication cleared when server logout fails, then allows revocation retry', async () => {
    let online = false;
    let refreshes = 0;
    let logouts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path } = requestDetails(input, init);
        if (path.endsWith('/auth/login')) return tokenResponse();
        if (path.endsWith('/users/me')) return jsonResponse(student);
        if (path.endsWith('/auth/refresh')) {
          refreshes += 1;
          return tokenResponse();
        }
        if (path.endsWith('/auth/logout')) logouts += 1;
        if (!online) throw new TypeError('Offline');
        return new Response(null, { status: 204 });
      }),
    );
    const { sessionClient } = await import('../lib/client');
    await sessionClient.login(credentials);
    await expect(sessionClient.logout()).rejects.toMatchObject({ status: 0 });
    expect(sessionClient.getSnapshot()).toMatchObject({
      status: 'anonymous',
      user: null,
      error: { status: 0 },
    });
    online = true;
    await sessionClient.retry();
    expect(sessionClient.getSnapshot()).toMatchObject({
      status: 'anonymous',
      user: null,
      error: null,
    });
    expect(refreshes).toBe(0);
    expect(logouts).toBe(2);
  });

  it('broadcasts only session-change signals and honors logout from another tab', async () => {
    const messages: unknown[] = [];
    const channels: TestChannel[] = [];
    class TestChannel {
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor() {
        channels.push(this);
      }
      postMessage(message: unknown) {
        messages.push(message);
      }
    }
    vi.stubGlobal('BroadcastChannel', TestChannel);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        return requestDetails(input, init).path.endsWith('/users/me')
          ? jsonResponse(student)
          : tokenResponse();
      }),
    );
    const { sessionClient } = await import('../lib/client');
    await sessionClient.login(credentials);
    expect(messages).toEqual([{ type: 'session-changed' }]);
    expect(JSON.stringify(messages)).not.toContain(initialToken);
    channels[0]?.onmessage?.(
      new MessageEvent('message', { data: { type: 'logout' } }),
    );
    expect(sessionClient.getSnapshot()).toMatchObject({
      status: 'anonymous',
      user: null,
    });
  });

  it('authenticates the new session when a tab changes accounts during an older refresh', async () => {
    const oldRefresh = deferred<Response>();
    const currentRefresh = deferred<Response>();
    const currentUser = {
      ...student,
      id: '00000000-0000-4000-8000-000000000099',
      full_name: 'Current Student',
    };
    const messages: unknown[] = [];
    const channels: TestChannel[] = [];
    const userRequestTokens: Array<string | null> = [];
    let refreshes = 0;
    class TestChannel {
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor() {
        channels.push(this);
      }
      postMessage(message: unknown) {
        messages.push(message);
      }
    }
    vi.stubGlobal('BroadcastChannel', TestChannel);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const { path, headers } = requestDetails(input, init);
        if (path.endsWith('/auth/refresh')) {
          refreshes += 1;
          return refreshes === 1 ? oldRefresh.promise : currentRefresh.promise;
        }
        if (path.endsWith('/users/me')) {
          userRequestTokens.push(headers.get('Authorization'));
          return jsonResponse(currentUser);
        }
        throw new Error(`Unexpected request ${path}`);
      }),
    );
    const { sessionClient } = await import('../lib/client');
    const previousBootstrap = sessionClient.bootstrap();
    await vi.waitFor(() => expect(refreshes).toBe(1));
    channels[0]?.onmessage?.(
      new MessageEvent('message', { data: { type: 'session-changed' } }),
    );
    expect(sessionClient.getSnapshot()).toMatchObject({
      status: 'loading',
      user: null,
    });
    oldRefresh.resolve(tokenResponse(initialToken));
    await previousBootstrap;
    await vi.waitFor(() => expect(refreshes).toBe(2));
    expect(sessionClient.getSnapshot()).toMatchObject({
      status: 'loading',
      user: null,
    });
    currentRefresh.resolve(tokenResponse(refreshedToken));
    await vi.waitFor(() =>
      expect(sessionClient.getSnapshot()).toMatchObject({
        status: 'authenticated',
        user: currentUser,
        error: null,
      }),
    );
    expect(userRequestTokens).toEqual([`Bearer ${refreshedToken}`]);
    for (const value of [sessionClient.getSnapshot(), messages]) {
      expect(JSON.stringify(value)).not.toContain(initialToken);
      expect(JSON.stringify(value)).not.toContain(refreshedToken);
    }
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
