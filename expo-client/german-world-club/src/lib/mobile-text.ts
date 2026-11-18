import type { MobileProblem } from '@gwc/contracts/mobile';

/** The message for a mobile-number problem (feature 031); the reasons come from the shared `checkMobile`. */
export function mobileErrorText(
  v: { mobile: string; mobileTooShort: string; mobileTooLong: string; mobileInvalid: string },
  reason: MobileProblem,
): string {
  switch (reason) {
    case 'empty': return v.mobile;
    case 'too-short': return v.mobileTooShort;
    case 'too-long': return v.mobileTooLong;
    default: return v.mobileInvalid;
  }
}
