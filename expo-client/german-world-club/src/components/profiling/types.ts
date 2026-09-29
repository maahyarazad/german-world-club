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
  /** null on the first step. */
  back: (() => void) | null;
};

export const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
