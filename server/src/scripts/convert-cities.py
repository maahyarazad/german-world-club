#!/usr/bin/env python3
"""
One-off: turn the InterNations workbook into the committed JSON the server loads.

    python3 server/src/scripts/convert-cities.py

Reads  server/data/source/400_Cities_160_Countries.xlsx  (sheet "Cities")
Writes server/data/internations-cities.json

The workbook names countries in English, not by ISO code, so each name is
mapped through packages/contracts/src/countries.ts (the same list both clients
offer) plus ALIASES for the names the workbook spells differently. Any name
that maps to neither stops the script: a silently dropped country would be a
country whose members can never pick a city.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'server/data/source/400_Cities_160_Countries.xlsx'
TARGET = ROOT / 'server/data/internations-cities.json'
COUNTRIES_TS = ROOT / 'packages/contracts/src/countries.ts'

# Workbook name -> ISO 3166-1 alpha-2, for the names CLDR spells differently.
ALIASES = {
    'Bosnia and Herzegovina': 'BA',
    'Czech Republic': 'CZ',
    "Côte d'Ivoire": 'CI',
    'DR Congo': 'CD',
    'Myanmar': 'MM',
    'Republic of the Congo': 'CG',
    'Trinidad and Tobago': 'TT',
    'Turkey': 'TR',
}

codes = dict((en, code) for code, en in re.findall(r'code:\s*"([A-Z]{2})",\s*en:\s*"([^"]+)"', COUNTRIES_TS.read_text()))
codes.update(ALIASES)

rows = list(openpyxl.load_workbook(SOURCE, read_only=True)['Cities'].iter_rows(values_only=True))[1:]
out, unmapped = [], set()
for _, city, country, region, kind in rows:
    code = codes.get(country)
    if code is None:
        unmapped.add(country)
        continue
    out.append({'country': code, 'city': city.strip(), 'region': region, 'capital': kind == 'Capital'})

if unmapped:
    sys.exit(f'unmapped country names: {sorted(unmapped)}')

# Country, capital first, then alphabetical: the order a dropdown wants.
out.sort(key=lambda e: (e['country'], not e['capital'], e['city'].lower()))
TARGET.write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(f'{len(out)} cities, {len({e["country"] for e in out})} countries -> {TARGET.relative_to(ROOT)}')
