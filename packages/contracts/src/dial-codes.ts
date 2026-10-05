import { countryByCode } from './countries.ts'

/**
 * International calling codes by ISO 3166-1 alpha-2 country, digits only (no
 * `+`). Offered next to the mobile number field on both faces, so an
 * applicant picks a country instead of typing a prefix.
 *
 * Countries with no resident population or no telephone service (Antarctica,
 * Bouvet Island, Heard Island, South Georgia, French Southern Territories,
 * US Minor Outlying Islands) are absent, which is why the picker's list is
 * shorter than the residence list.
 *
 * The North American Numbering Plan countries all share `1`; the area code is
 * the first three digits of the number the applicant types.
 */
export const DIAL_CODES: Readonly<Record<string, string>> = Object.freeze({
  AD: '376', AE: '971', AF: '93', AG: '1', AI: '1', AL: '355', AM: '374', AO: '244', AR: '54', AS: '1',
  AT: '43', AU: '61', AW: '297', AX: '358', AZ: '994', BA: '387', BB: '1', BD: '880', BE: '32', BF: '226',
  BG: '359', BH: '973', BI: '257', BJ: '229', BL: '590', BM: '1', BN: '673', BO: '591', BQ: '599', BR: '55',
  BS: '1', BT: '975', BW: '267', BY: '375', BZ: '501', CA: '1', CC: '61', CD: '243', CF: '236', CG: '242',
  CH: '41', CI: '225', CK: '682', CL: '56', CM: '237', CN: '86', CO: '57', CR: '506', CU: '53', CV: '238',
  CW: '599', CX: '61', CY: '357', CZ: '420', DE: '49', DJ: '253', DK: '45', DM: '1', DO: '1', DZ: '213',
  EC: '593', EE: '372', EG: '20', EH: '212', ER: '291', ES: '34', ET: '251', FI: '358', FJ: '679', FK: '500',
  FM: '691', FO: '298', FR: '33', GA: '241', GB: '44', GD: '1', GE: '995', GF: '594', GG: '44', GH: '233',
  GI: '350', GL: '299', GM: '220', GN: '224', GP: '590', GQ: '240', GR: '30', GT: '502', GU: '1', GW: '245',
  GY: '592', HK: '852', HN: '504', HR: '385', HT: '509', HU: '36', ID: '62', IE: '353', IL: '972', IM: '44',
  IN: '91', IO: '246', IQ: '964', IR: '98', IS: '354', IT: '39', JE: '44', JM: '1', JO: '962', JP: '81',
  KE: '254', KG: '996', KH: '855', KI: '686', KM: '269', KN: '1', KP: '850', KR: '82', KW: '965', KY: '1',
  KZ: '7', LA: '856', LB: '961', LC: '1', LI: '423', LK: '94', LR: '231', LS: '266', LT: '370', LU: '352',
  LV: '371', LY: '218', MA: '212', MC: '377', MD: '373', ME: '382', MF: '590', MG: '261', MH: '692', MK: '389',
  ML: '223', MM: '95', MN: '976', MO: '853', MP: '1', MQ: '596', MR: '222', MS: '1', MT: '356', MU: '230',
  MV: '960', MW: '265', MX: '52', MY: '60', MZ: '258', NA: '264', NC: '687', NE: '227', NF: '672', NG: '234',
  NI: '505', NL: '31', NO: '47', NP: '977', NR: '674', NU: '683', NZ: '64', OM: '968', PA: '507', PE: '51',
  PF: '689', PG: '675', PH: '63', PK: '92', PL: '48', PM: '508', PN: '64', PR: '1', PS: '970', PT: '351',
  PW: '680', PY: '595', QA: '974', RE: '262', RO: '40', RS: '381', RU: '7', RW: '250', SA: '966', SB: '677',
  SC: '248', SD: '249', SE: '46', SG: '65', SH: '290', SI: '386', SJ: '47', SK: '421', SL: '232', SM: '378',
  SN: '221', SO: '252', SR: '597', SS: '211', ST: '239', SV: '503', SX: '1', SY: '963', SZ: '268', TC: '1',
  TD: '235', TG: '228', TH: '66', TJ: '992', TK: '690', TL: '670', TM: '993', TN: '216', TO: '676', TR: '90',
  TT: '1', TV: '688', TW: '886', TZ: '255', UA: '380', UG: '256', US: '1', UY: '598', UZ: '998', VA: '39',
  VC: '1', VE: '58', VG: '1', VI: '1', VN: '84', VU: '678', WF: '681', WS: '685', XK: '383', YE: '967',
  YT: '262', ZA: '27', ZM: '260', ZW: '263',
})

/** The countries a mobile number can be for, in `COUNTRIES` order. */
export const hasDialCode = (code: string) => code in DIAL_CODES

/** Shared codes resolve to the country most people mean when they see only `+code`. */
const PREFERRED: Readonly<Record<string, string>> = Object.freeze({
  '1': 'US', '7': 'RU', '39': 'IT', '44': 'GB', '47': 'NO', '61': 'AU', '64': 'NZ', '212': 'MA',
  '262': 'RE', '358': 'FI', '590': 'GP', '599': 'CW',
})

const BY_DIAL: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>()
  for (const [country, dial] of Object.entries(DIAL_CODES)) {
    if (!map.has(dial) || PREFERRED[dial] === country) map.set(dial, country)
  }
  return map
})()

/**
 * Builds the E.164 number from a country and what the person typed. A number
 * typed with its own `+` is already international and wins over the country;
 * otherwise spaces, dashes and brackets go, and so does the leading zero of a
 * national number (`0151…` dials as `+49151…`).
 */
export function toE164(country: string, typed: string): string {
  const cleaned = typed.replace(/[\s\-().]/g, '')
  if (cleaned.startsWith('+')) return cleaned
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`
  const dial = DIAL_CODES[country]
  return dial ? `+${dial}${cleaned.replace(/^0+/, '')}` : cleaned
}

/** The inverse, for restoring a saved number into the picker and field. Longest calling code wins. */
export function splitE164(number: string): { country: string; national: string } | null {
  if (!number.startsWith('+')) return null
  const digits = number.slice(1)
  for (let length = 3; length >= 1; length -= 1) {
    const country = BY_DIAL.get(digits.slice(0, length))
    if (country) return { country, national: digits.slice(length) }
  }
  return null
}

/** `Germany (+49)`, in the interface language. */
export const dialLabel = (code: string, locale: 'en' | 'de') =>
  `${countryByCode(code)?.[locale] ?? code} (+${DIAL_CODES[code] ?? ''})`
