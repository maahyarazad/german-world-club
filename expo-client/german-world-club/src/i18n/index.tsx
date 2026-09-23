import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { PROBLEMS } from '@gwc/contracts/errors';

import { ApiError } from '@/api/client';
import { loadLocale, saveLocale } from '@/session/storage';

import { de } from './de';
import { en, type Catalogue } from './en';

/**
 * Interface strings, read through `useTranslations()` — never by importing a
 * catalogue directly, which would hard-code a language into a component and
 * survive every switch silently (the same rule the web client enforces).
 *
 * The language follows the device until the member picks one, and the choice
 * is remembered on the device. Server text is never shown: problems are
 * translated from their `type` below, because the server deliberately emits no
 * localised prose.
 */

export const LOCALES = { en, de } as const;
export type Locale = keyof typeof LOCALES;

const deviceLocale = (): Locale => {
  const tag = Intl.DateTimeFormat().resolvedOptions().locale ?? 'en';
  return tag.toLowerCase().startsWith('de') ? 'de' : 'en';
};

type Ctx = {
  locale: Locale;
  t: Catalogue;
  setLocale: (locale: Locale) => void;
  /** `{name}` placeholders, filled from `values`. */
  format: (template: string, values: Record<string, string | number>) => string;
  formatMoney: (cents: number, currency: string) => string;
  formatDate: (iso: string, withTime?: boolean) => string;
  problemMessage: (error: unknown) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(deviceLocale);

  useEffect(() => {
    loadLocale().then((stored) => {
      if (stored === 'en' || stored === 'de') setLocaleState(stored);
    });
  }, []);

  const value = useMemo<Ctx>(() => {
    const t = LOCALES[locale];
    // Formatting follows the interface language too: English labels next to
    // "1.240,50 €" is the half-done version of a translation.
    const tag = locale === 'de' ? 'de-DE' : 'en-GB';
    return {
      locale,
      t,
      setLocale: (next) => {
        setLocaleState(next);
        void saveLocale(next);
      },
      format: (template, values) =>
        template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match)),
      formatMoney: (cents, currency) =>
        new Intl.NumberFormat(tag, { style: 'currency', currency }).format(cents / 100),
      formatDate: (iso, withTime = false) =>
        new Intl.DateTimeFormat(tag, {
          dateStyle: 'medium',
          ...(withTime ? { timeStyle: 'short' } : {}),
        }).format(new Date(iso)),
      problemMessage: (error) => problemMessage(t, error),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslations() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useTranslations() outside <I18nProvider>');
  return ctx;
}

/** Problem `type` → message. Clients branch on `type`, never on `detail`. */
const PROBLEM_KEYS: Record<string, keyof Catalogue['problems']> = {
  [PROBLEMS.INVALID_CREDENTIALS.type]: 'invalidCredentials',
  [PROBLEMS.INVALID_OTP.type]: 'invalidOtp',
  [PROBLEMS.OTP_EXPIRED.type]: 'otpExpired',
  [PROBLEMS.OTP_ATTEMPTS_EXCEEDED.type]: 'otpAttemptsExceeded',
  [PROBLEMS.RATE_LIMITED.type]: 'rateLimited',
  [PROBLEMS.ACCOUNT_LOCKED.type]: 'accountLocked',
  [PROBLEMS.ACCOUNT_INACTIVE.type]: 'accountInactive',
  [PROBLEMS.MEMBERSHIP_ENDED.type]: 'membershipEnded',
  [PROBLEMS.APPLICATION_DENIED.type]: 'applicationDenied',
  [PROBLEMS.APPROVAL_PENDING.type]: 'approvalPending',
  [PROBLEMS.VALIDATION_FAILED.type]: 'validation',
  [PROBLEMS.EVENT_FULL.type]: 'eventFull',
  [PROBLEMS.REGISTRATION_CLOSED.type]: 'registrationClosed',
  [PROBLEMS.ALREADY_REGISTERED.type]: 'alreadyRegistered',
  [PROBLEMS.CONFLICT.type]: 'conflict',
  [PROBLEMS.NOT_FOUND.type]: 'notFound',
  [PROBLEMS.SERVICE_UNAVAILABLE.type]: 'unavailable',
  [PROBLEMS.REQUEST_DEADLINE_EXCEEDED.type]: 'unavailable',
};

function problemMessage(t: Catalogue, error: unknown) {
  if (error instanceof ApiError) {
    const key = error.type ? PROBLEM_KEYS[error.type] : undefined;
    if (key) return t.problems[key];
    if (error.status === 429) return t.problems.rateLimited;
    if (error.status >= 500) return t.problems.unavailable;
    return t.problems.generic;
  }
  // fetch rejects only when no response arrived at all.
  if (error instanceof TypeError) return t.problems.network;
  return t.problems.generic;
}
