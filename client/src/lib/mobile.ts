import type { MobileProblem } from '@gwc/contracts/mobile'

/**
 * The message for a mobile-number problem (feature 031). The reasons come from
 * `checkMobile`, the one rule the server and both clients share; only the words
 * live here, in the console's catalogue.
 */
export type MobileErrorCopy = {
  mobile: string
  mobileTooShort: string
  mobileTooLong: string
  mobileInvalid: string
}

export function mobileErrorText(copy: MobileErrorCopy, reason: MobileProblem): string {
  switch (reason) {
    case 'empty': return copy.mobile
    case 'too-short': return copy.mobileTooShort
    case 'too-long': return copy.mobileTooLong
    default: return copy.mobileInvalid
  }
}
