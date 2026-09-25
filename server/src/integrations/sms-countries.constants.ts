// Hand-maintained constants for the outbound SMS country allowlist.
//
// Converted from the originating project's smsCountries.constants.js, where
// specs/004-sms-country-allowlist/ records the decisions behind these two sets.
// The approved dialing codes themselves are NOT here - they are generated into
// sms-countries.generated.ts from the business's accepted-zone list.

// --------------------------------------------------------------------------
// NANP area codes assigned to the UNITED STATES only.
//
// US-ONLY, NOT US+CANADA. Canada is absent from the accepted-zone list
// (research.md R12) but shares dialing code +1 with the USA, so the dialing
// code alone cannot separate them - only the area code can. Every Canadian
// area code (416, 604, 905, 647, 613, ...) is therefore deliberately absent,
// as are the Caribbean NANP codes (research.md R9) and the toll-free /
// premium ranges.
//
// US territories ARE included - Puerto Rico (787, 939), US Virgin Islands
// (340), Guam (671), American Samoa (684), Northern Mariana Islands (670) -
// per research.md R3.
//
// Fail-closed by design: a +1 number whose area code is not in this set is
// refused. NANP assigns new area codes a few times a year, so a stale set
// blocks a legitimate new-area-code user rather than admitting a bad one.
// Refresh when the block logs show nanp_area_not_allowed for a US number.
export const NANP_US_AREA_CODES: ReadonlySet<string> = new Set([
  '201', '202', '203', '205', '206', '207', '208', '209', '210', '212', '213', '214',
  '215', '216', '217', '218', '219', '220', '223', '224', '225', '227', '228', '229',
  '231', '234', '239', '240', '251', '252', '253', '254', '256', '260', '262', '267',
  '269', '270', '272', '274', '276', '279', '281', '301', '302', '303', '304', '305',
  '307', '308', '309', '310', '312', '313', '314', '315', '316', '317', '318', '319',
  '320', '321', '323', '324', '325', '326', '327', '329', '330', '331', '332', '334',
  '336', '337', '339', '340', '341', '346', '347', '350', '351', '352', '360', '361',
  '363', '364', '380', '385', '386', '401', '402', '404', '405', '406', '407', '408',
  '409', '410', '412', '413', '414', '415', '417', '419', '423', '424', '425', '430',
  '432', '434', '435', '436', '440', '442', '443', '445', '447', '448', '458', '463',
  '464', '469', '470', '475', '478', '479', '480', '484', '501', '502', '503', '504',
  '505', '507', '508', '509', '510', '512', '513', '515', '516', '517', '518', '520',
  '530', '531', '534', '539', '540', '541', '551', '557', '559', '561', '562', '563',
  '564', '567', '570', '571', '572', '573', '574', '575', '580', '582', '585', '586',
  '601', '602', '603', '605', '606', '607', '608', '609', '610', '612', '614', '615',
  '616', '617', '618', '619', '620', '623', '626', '628', '629', '630', '631', '636',
  '640', '641', '645', '646', '650', '651', '656', '657', '659', '660', '661', '662',
  '667', '669', '670', '671', '678', '679', '680', '681', '682', '684', '689', '701',
  '702', '703', '704', '706', '707', '708', '712', '713', '714', '715', '716', '717',
  '718', '719', '720', '724', '725', '726', '727', '730', '731', '732', '734', '737',
  '740', '743', '747', '754', '757', '760', '762', '763', '765', '769', '770', '772',
  '773', '774', '775', '779', '781', '785', '786', '787', '801', '802', '803', '804',
  '805', '806', '808', '810', '812', '813', '814', '815', '816', '817', '818', '820',
  '826', '828', '830', '831', '832', '835', '838', '839', '840', '843', '845', '847',
  '848', '850', '854', '856', '857', '858', '859', '860', '862', '863', '864', '865',
  '870', '872', '878', '901', '903', '904', '906', '907', '908', '909', '910', '912',
  '913', '914', '915', '916', '917', '918', '919', '920', '924', '925', '928', '929',
  '930', '931', '934', '936', '937', '938', '939', '940', '941', '943', '945', '947',
  '948', '949', '951', '952', '954', '956', '959', '970', '971', '972', '973', '978',
  '979', '980', '983', '984', '985', '986', '989',
])

// --------------------------------------------------------------------------
// Dialing codes that are refused regardless of anything else.
//
// All four appear IN the business's accepted-zone list. They are there because
// they are inexpensive - the list was assembled from a price sheet, which
// carries no view on sanctions. Excluded here on legal grounds, not cost.
//
// PENDING LEGAL/COMPLIANCE SIGN-OFF (research.md R10). Override at runtime with
// SMS_BLOCKED_COUNTRIES without a deploy; that variable REPLACES this seed.
export const BLOCKED_DIALING_CODES: ReadonlySet<string> = new Set([
  '850', // North Korea  (0.133 AED in the accepted list)
  '53', //  Cuba         (0.417)
  '963', // Syria        (0.421)
  '98', //  Iran         (0.190)
])
