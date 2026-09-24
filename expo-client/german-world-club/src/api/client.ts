import type { ProblemResponse } from '@gwc/contracts/errors';

import { API_URL } from '@/config';

/**
 * The one HTTP client. Every screen goes through `api()`; none calls `fetch`.
 *
 * It does three things and nothing else: attach the bearer token, rotate it
 * once when the server says it has expired, and turn every non-2xx answer into
 * an `ApiError` carrying the RFC 9457 problem. Screens branch on
 * `error.problem.type`, never on `detail` — the same rule the console follows,
 * and the reason the server never localises its errors.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemResponse | null;

  constructor(status: number, problem: ProblemResponse | null) {
    super(problem?.detail ?? problem?.title ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }

  get type() {
    return this.problem?.type ?? null;
  }
}

type Tokens = { accessToken: string; refreshToken: string };

/**
 * The session module owns the tokens; this module only borrows them. Wired
 * once at startup through `configureAuth`, so the client never imports the
 * session (which imports the client) and there is one owner of the truth.
 */
let auth: {
  current: () => Tokens | null;
  rotated: (tokens: Tokens) => Promise<void>;
  lost: () => Promise<void>;
} | null = null;

export function configureAuth(hooks: NonNullable<typeof auth>) {
  auth = hooks;
}

/**
 * One refresh at a time. Refresh tokens are single-use and a replay revokes
 * the whole session (server/src/modules/auth/sessions.ts), so two screens
 * refreshing in parallel would sign the member out. Everybody waits on the
 * same attempt instead.
 */
let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  const tokens = auth?.current();
  if (!tokens) return false;
  refreshing ??= (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!response.ok) {
        await auth?.lost();
        return false;
      }
      const body = await response.json();
      await auth?.rotated({ accessToken: body.accessToken, refreshToken: body.refreshToken });
      return true;
    } catch {
      // A network failure is not a revoked session: keep the tokens and let
      // the caller's request fail as a network error.
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Public endpoints (register, verify-mobile, sign-in) send no bearer. */
  anonymous?: boolean;
};

export async function api<T>(path: string, { method = 'GET', body, anonymous = false }: Options = {}): Promise<T> {
  // FormData goes as-is (feature 010's media uploads): fetch writes the
  // multipart content-type itself, boundary included, and a hand-set one
  // would lack it.
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
  const send = () => {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined && !multipart) headers['content-type'] = 'application/json';
    const tokens = anonymous ? null : auth?.current();
    if (tokens) headers.authorization = `Bearer ${tokens.accessToken}`;
    return fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : multipart ? (body as FormData) : JSON.stringify(body),
    });
  };

  let response = await send();

  // 401 means the credential itself — expired or revoked. 403 is the server
  // saying no to a valid one (pending approval, locked…), which a refresh
  // cannot change, so it is never retried.
  if (response.status === 401 && !anonymous && auth?.current()) {
    if (await refresh()) response = await send();
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text ? safeJson(text) : null;
  if (!response.ok) throw new ApiError(response.status, (parsed as ProblemResponse | null) ?? null);
  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
