import type { LoginInput, RegisterInput, TokenResponse, User } from './types';

export interface ValidationIssue {
  type: string;
  loc: Array<string | number>;
  msg: string;
}
export class ApiError extends Error {
  readonly status: number;
  readonly details: string | ValidationIssue[] | null;
  readonly fieldErrors: Record<string, string>;
  constructor(
    status: number,
    message: string,
    details: string | ValidationIssue[] | null = null,
    fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.fieldErrors = fieldErrors;
  }
}
export const isApiError = (error: unknown): error is ApiError =>
  error instanceof ApiError;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  auth?: boolean;
}
export interface SessionSnapshot {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: User | null;
  error: ApiError | null;
  epoch: number;
}

function baseUrl(): string {
  const configured =
    (
      import.meta as ImportMeta & {
        readonly env?: { readonly VITE_API_BASE_URL?: string };
      }
    ).env?.VITE_API_BASE_URL || '/api/v1';
  const origin =
    typeof location === 'undefined' ? 'http://localhost' : location.origin;
  const url = new URL(configured, origin);
  if (
    (!configured.startsWith('/') && !/^https?:\/\//.test(configured)) ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.replace(/\/$/, '').endsWith('/api/v1') ||
    configured.startsWith('//')
  ) {
    throw new Error(
      'VITE_API_BASE_URL must be an HTTP(S) API base ending in /api/v1 without credentials, query, or fragment.',
    );
  }
  return configured.replace(/\/$/, '');
}
const API_BASE = baseUrl();
let accessToken: string | null = null;
let epoch = 0;
let refreshBlocked = false;
let snapshot: SessionSnapshot = {
  status: 'loading',
  user: null,
  error: null,
  epoch,
};
const listeners = new Set<() => void>();
let refreshFlight: { epoch: number; promise: Promise<void> } | null = null;
let bootstrapPromise: Promise<void> | null = null;
let cookieTail: Promise<void> = Promise.resolve();

function update(next: Omit<SessionSnapshot, 'epoch'>) {
  snapshot = { ...next, epoch };
  listeners.forEach((listener) => listener());
}
function startSession(
  status: SessionSnapshot['status'],
  error: ApiError | null = null,
) {
  epoch += 1;
  accessToken = null;
  update({ status, user: null, error });
  return epoch;
}
function assertCurrent(expected: number) {
  if (epoch !== expected)
    throw new ApiError(401, 'The session changed. Please try again.');
}
function expireSession(expected: number, error: ApiError | null) {
  if (epoch !== expected) return;
  refreshBlocked = true;
  startSession('anonymous', error);
}
function asApiError(error: unknown): ApiError {
  return isApiError(error)
    ? error
    : new ApiError(
        0,
        'Unable to reach the server. Check your connection and try again.',
      );
}
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function cookieMutation<T>(operation: () => Promise<T>): Promise<T> {
  const next = cookieTail.then(async () => {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return await navigator.locks.request('eduflow-auth-cookie', operation);
    }
    return operation();
  });
  cookieTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function responseError(response: Response): Promise<ApiError> {
  const defaults: Record<number, string> = {
    400: 'The request could not be completed.',
    401: 'Please sign in to continue.',
    403: 'You do not have permission to perform this action.',
    404: 'This resource is unavailable or you do not have access.',
    409: 'The operation conflicts with the current state. Refresh and try again.',
    422: 'Please check the highlighted fields.',
  };
  let message =
    defaults[response.status] ||
    'The server could not complete the request. Try again.';
  let details: ApiError['details'] = null;
  const fieldErrors: Record<string, string> = {};
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === 'object' && 'detail' in payload) {
      const detail = payload.detail;
      if (typeof detail === 'string' && response.status < 500) {
        message = detail.slice(0, 400);
        details = message;
      } else if (Array.isArray(detail) && response.status === 422) {
        const issues: ValidationIssue[] = [];
        for (const value of detail) {
          if (
            !value ||
            typeof value !== 'object' ||
            typeof value.msg !== 'string' ||
            !Array.isArray(value.loc)
          )
            continue;
          const loc: Array<string | number> = value.loc.filter(
            (part: unknown): part is string | number =>
              typeof part === 'string' || typeof part === 'number',
          );
          const msg = value.msg.slice(0, 400);
          issues.push({
            type: typeof value.type === 'string' ? value.type : 'validation',
            loc,
            msg,
          });
          const field = loc
            .filter(
              (part) => part !== 'body' && part !== 'query' && part !== 'path',
            )
            .join('.');
          if (field && !Object.hasOwn(fieldErrors, field))
            fieldErrors[field] = msg;
        }
        details = issues;
      }
    }
  } catch {
    /* Non-JSON proxy failures use the safe status-specific message. */
  }
  return new ApiError(response.status, message, details, fieldErrors);
}

async function fetchResponse(
  path: string,
  options: RequestOptions,
  token: string | null,
): Promise<Response> {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new ApiError(0, 'Invalid API path.');
  const method = options.method || 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method === 'POST' && path.startsWith('/auth/'))
    headers['X-CSRF-Token'] = '1';
  try {
    return await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      // Let an already-issued revocation finish if the page is closed or reloaded.
      keepalive: method === 'POST' && path === '/auth/logout',
      signal: options.signal,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw asApiError(error);
  }
}
async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw await responseError(response);
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(
      502,
      'The server returned an invalid response. Please try again.',
    );
  }
}
async function authPost<T>(path: string, body?: unknown): Promise<T> {
  return parseResponse<T>(
    await fetchResponse(path, { method: 'POST', body, auth: false }, null),
  );
}
function acceptToken(value: TokenResponse) {
  if (
    !value ||
    typeof value.access_token !== 'string' ||
    !value.access_token ||
    value.token_type !== 'bearer'
  ) {
    throw new ApiError(502, 'The server returned an invalid session response.');
  }
  accessToken = value.access_token;
}

function refreshSession(): Promise<void> {
  if (refreshBlocked)
    return Promise.reject(new ApiError(401, 'Please sign in to continue.'));
  if (refreshFlight?.epoch === epoch) return refreshFlight.promise;
  const expected = epoch;
  // A newer session queues its own rotation after any older cookie operation.
  const pending = cookieMutation(async () => {
    assertCurrent(expected);
    const tokens = await authPost<TokenResponse>('/auth/refresh');
    assertCurrent(expected);
    acceptToken(tokens);
  })
    .catch((error) => {
      const normalized = asApiError(error);
      expireSession(expected, normalized.status === 401 ? null : normalized);
      throw normalized;
    })
    .finally(() => {
      if (refreshFlight?.promise === pending) refreshFlight = null;
    });
  refreshFlight = { epoch: expected, promise: pending };
  return pending;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const authenticated = options.auth !== false && !path.startsWith('/auth/');
  const expected = epoch;
  if (options.signal?.aborted)
    throw new DOMException('The request was aborted.', 'AbortError');
  if (authenticated && !accessToken) await refreshSession();
  if (authenticated) assertCurrent(expected);
  const originalToken = authenticated ? accessToken : null;
  let response = await fetchResponse(path, options, originalToken);
  if (authenticated) assertCurrent(expected);
  if (authenticated && response.status === 401) {
    // A late failure may belong to the token a concurrent request already replaced.
    if (!accessToken || accessToken === originalToken) await refreshSession();
    assertCurrent(expected);
    response = await fetchResponse(path, options, accessToken);
    assertCurrent(expected);
    if (response.status === 401) expireSession(expected, null);
  }
  const result = await parseResponse<T>(response);
  if (authenticated) assertCurrent(expected);
  return result;
}

export const client = { request };
const channel =
  typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('eduflow-session')
    : null;
function announce(type: 'logout' | 'session-changed') {
  channel?.postMessage({ type });
}

async function bootstrap(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise;
  if (snapshot.status === 'authenticated' || refreshBlocked) return;
  const expected = epoch;
  bootstrapPromise = (async () => {
    try {
      await refreshSession();
      assertCurrent(expected);
      const user = await request<User>('/users/me');
      assertCurrent(expected);
      update({ status: 'authenticated', user, error: null });
    } catch (error) {
      const normalized = asApiError(error);
      expireSession(expected, normalized.status === 401 ? null : normalized);
    }
  })();
  return bootstrapPromise;
}

async function authenticate(
  input: LoginInput | RegisterInput,
  register: boolean,
): Promise<void> {
  refreshBlocked = true;
  const expected = startSession('loading');
  try {
    const tokens = await cookieMutation(async () => {
      assertCurrent(expected);
      if (register) {
        await authPost<User>('/auth/register', input);
        assertCurrent(expected);
      }
      return authPost<TokenResponse>('/auth/login', {
        email: input.email,
        password: input.password,
      });
    });
    assertCurrent(expected);
    acceptToken(tokens);
    refreshBlocked = false;
    const user = await request<User>('/users/me');
    assertCurrent(expected);
    update({ status: 'authenticated', user, error: null });
    announce('session-changed');
  } catch (error) {
    const normalized = asApiError(error);
    if (epoch === expected) {
      refreshBlocked = true;
      accessToken = null;
      update({ status: 'anonymous', user: null, error: normalized });
    }
    throw normalized;
  }
}

async function logout(): Promise<void> {
  refreshBlocked = true;
  const expected = startSession('anonymous');
  announce('logout');
  try {
    // The queue includes in-flight refresh/login cookie writes, so revoke the latest cookie.
    await cookieMutation(() => authPost<void>('/auth/logout'));
    if (epoch === expected)
      update({ status: 'anonymous', user: null, error: null });
  } catch (error) {
    const cause = asApiError(error);
    const failure = new ApiError(
      cause.status,
      'Signed out on this device, but server session revocation could not be confirmed. Retry signing out when connected.',
      cause.details,
      cause.fieldErrors,
    );
    failure.name = 'LogoutRevocationError';
    if (epoch === expected)
      update({ status: 'anonymous', user: null, error: failure });
    throw failure;
  }
}

async function retry(): Promise<void> {
  if (snapshot.error?.name === 'LogoutRevocationError') {
    await logout();
    return;
  }
  refreshBlocked = false;
  startSession('loading');
  bootstrapPromise = null;
  await bootstrap();
}

if (channel)
  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (
      !event.data ||
      typeof event.data !== 'object' ||
      !('type' in event.data)
    )
      return;
    if (event.data.type === 'logout') {
      refreshBlocked = true;
      startSession('anonymous');
    } else if (event.data.type === 'session-changed') {
      refreshBlocked = false;
      startSession('loading');
      bootstrapPromise = null;
      void bootstrap();
    }
  };

export const sessionClient = {
  getSnapshot: (): SessionSnapshot => snapshot,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  bootstrap,
  login: (input: LoginInput) => authenticate(input, false),
  register: (input: RegisterInput) => authenticate(input, true),
  logout,
  retry,
};
