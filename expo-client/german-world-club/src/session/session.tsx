import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { Principal, SignInResponse } from '@gwc/contracts/auth';
import type { OnboardingStatus } from '@gwc/contracts/onboarding';

import { ApiError, configureAuth } from '@/api/client';
import { authApi, onboardingApi } from '@/api/endpoints';

import { clearSession, deviceId, loadSession, saveSession, type StoredSession } from './storage';

/**
 * Who is using the app, and therefore which part of it they may see.
 *
 * The root layout turns `status` into protected route groups. This is a UX
 * decision and nothing more: the server re-checks every request, so a screen
 * shown by mistake would simply get a 403. What this *does* guarantee is that
 * an applicant is never shown a tab whose every request would be refused.
 */
export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'applicant'; principal: Principal; onboarding: OnboardingStatus }
  | { status: 'member'; principal: Principal }
  | { status: 'organisation'; principal: Principal };

type TokenPair = { accessToken: string; refreshToken: string; principal: Principal };

type Ctx = {
  state: SessionState;
  deviceId: string | null;
  /** Returns the outcome so the sign-in screen can route OTP / pending cases. */
  signIn: (email: string, password: string) => Promise<SignInResponse>;
  /** Store a freshly issued pair (after an OTP or mobile verification) and route. */
  adopt: (tokens: TokenPair) => Promise<void>;
  /** Re-read onboarding status from the server, e.g. after email verification. */
  refreshStatus: (known?: OnboardingStatus) => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  const [device, setDevice] = useState<string | null>(null);
  // Read synchronously by the API client on every request, so a ref rather
  // than state: a rotated token must be visible to the very next call.
  const stored = useRef<StoredSession | null>(null);

  const forget = useCallback(async () => {
    stored.current = null;
    await clearSession();
    setState({ status: 'signedOut' });
  }, []);

  /** Decide where a stored session belongs. Members ask the server; nobody guesses. */
  const route = useCallback(async (session: StoredSession, known?: OnboardingStatus) => {
    const { principal } = session;
    if (principal.kind === 'merchant' || principal.kind === 'partner') {
      setState({ status: 'organisation', principal });
      return;
    }
    if (principal.kind !== 'member') {
      // A staff credential has no place in the member app.
      await forget();
      return;
    }
    const onboarding = known ?? await onboardingApi.status();
    setState(onboarding.step === 'approved'
      ? { status: 'member', principal }
      : { status: 'applicant', principal, onboarding });
  }, [forget]);

  useEffect(() => {
    configureAuth({
      current: () => stored.current,
      rotated: async (tokens) => {
        if (!stored.current) return;
        stored.current = { ...stored.current, ...tokens };
        await saveSession(stored.current);
      },
      lost: forget,
    });

    (async () => {
      setDevice(await deviceId());
      const session = await loadSession();
      if (!session) {
        setState({ status: 'signedOut' });
        return;
      }
      stored.current = session;
      try {
        await route(session);
      } catch (error) {
        // Offline at launch: keep the session and show the member area, which
        // will surface the network error itself. Only an answer from the
        // server that the session is over signs anybody out.
        if (error instanceof ApiError) await forget();
        else setState({ status: 'member', principal: session.principal });
      }
    })();
  }, [forget, route]);

  const adopt = useCallback(async (tokens: TokenPair) => {
    const session = { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, principal: tokens.principal };
    stored.current = session;
    await saveSession(session);
    await route(session);
  }, [route]);

  const value = useMemo<Ctx>(() => ({
    state,
    deviceId: device,
    signIn: async (email, password) => {
      const outcome = await authApi.signIn({ email, password, deviceId: device ?? await deviceId() });
      // A bearer client receives the pair in the body only on `authenticated`;
      // every other outcome is for the screen to route.
      if (outcome.outcome === 'authenticated' && outcome.accessToken && outcome.refreshToken && outcome.principal) {
        await adopt({ accessToken: outcome.accessToken, refreshToken: outcome.refreshToken, principal: outcome.principal });
      }
      return outcome;
    },
    adopt,
    refreshStatus: async (known) => {
      if (stored.current) await route(stored.current, known);
    },
    signOut: async () => {
      // Best effort: the server revokes the session; if it cannot be reached,
      // the tokens are still dropped here and the access token lapses on its own.
      try { await authApi.signOut(); } catch { /* signing out must always work */ }
      await forget();
    },
  }), [state, device, adopt, route, forget]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession() outside <SessionProvider>');
  return ctx;
}
