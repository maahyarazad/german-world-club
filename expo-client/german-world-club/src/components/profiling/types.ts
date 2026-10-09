import type { ProfilingAnswers } from '@gwc/contracts/profiling';
import type { useTranslations } from '@/i18n';

export type Copy = ReturnType<typeof useTranslations>['t']['profiling'];
export type Locale = 'en' | 'de';

export type StepCtx = {
  copy: Copy;
  locale: Locale;
  answers: ProfilingAnswers;
  busy: boolean;
  /** Saves and lets the wizard decide where to go next. */
  save: (body: object) => void;
  /** Moves on without saving anything (an information screen). */
  next: () => void;
  /** null on the first step. */
  back: (() => void) | null;
};

export const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));

/**
 * A template's literal text either side of `{key}`, so that text can be styled
 * apart from the value in any word order. No placeholder: all of it is "before".
 */
export const splitTemplate = (template: string, key: string): [before: string, after: string] => {
  const marker = `{${key}}`;
  const at = template.indexOf(marker);
  return at === -1 ? [template, ''] : [template.slice(0, at), template.slice(at + marker.length)];
};
