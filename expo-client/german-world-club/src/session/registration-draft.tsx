import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { RegisterRequest } from '@gwc/contracts/onboarding';

/**
 * The registration form, carried across its two screens (details, then
 * country) and submitted once. Held in memory only: it contains a password,
 * and nothing about a half-filled form is worth writing to disk.
 */
export type RegistrationDraft = Partial<Omit<RegisterRequest, 'deviceId'>>;

type Ctx = {
  draft: RegistrationDraft;
  update: (changes: RegistrationDraft) => void;
  clear: () => void;
};

const DraftContext = createContext<Ctx | null>(null);

export function RegistrationDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<RegistrationDraft>({});
  const value = useMemo<Ctx>(() => ({
    draft,
    update: (changes) => setDraft((current) => ({ ...current, ...changes })),
    clear: () => setDraft({}),
  }), [draft]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useRegistrationDraft() {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error('useRegistrationDraft() outside <RegistrationDraftProvider>');
  return ctx;
}
