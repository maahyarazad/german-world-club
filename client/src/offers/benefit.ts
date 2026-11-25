import type { BenefitKind } from '@gwc/contracts/offers'
import { formatMoney, formatNumber } from '../lib/format'
import type { Locale } from '../i18n/locales'
import type { Catalogue } from '../i18n/index'

/** The offer's headline, in words: "20 % Rabatt", "Gratis-Zugabe", "Eins kaufen, eins gratis". */
export function benefitText(
  t: Catalogue,
  benefit: { kind: BenefitKind; value: number | null },
  currency: string,
  locale: Locale,
): string {
  const template = t.clubOffers.benefits[benefit.kind]
  if (benefit.value === null) return template
  const value = benefit.kind === 'percentage' ? formatNumber(benefit.value, locale) : formatMoney(Math.round(benefit.value * 100), currency, locale)
  return template.replace('{value}', value)
}
